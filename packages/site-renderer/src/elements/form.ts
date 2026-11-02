import type { ContentTypeDefinition } from '@manablox/core';
import {
  BUTTON_CLASS,
  BUTTON_VARIANTS,
  buttonClass,
  FORM_ERROR_CLASS,
  type FormElement,
  HONEYPOT_CLASS,
  INPUT_CLASS,
  isFormField,
  LABEL_CLASS,
} from '@manablox/site';
import { h, type VNodeChild } from 'vue';
import { resolveBinding } from '../bindings.js';
import { type Frame, fieldDefs, findDef, nodeRef, type RenderContext } from '../context.js';
import type { ElementRenderer } from '../renderer.js';
import type { FieldDef } from '../types.js';
import { ISLAND_ATTRIBUTE } from '../types.js';
import { isRecord, pathOf, smallHash } from '../util.js';
import { empty, formAction, text } from './shared.js';

/** Names of the fields the site adds to every form; the form endpoint strips them. */
export const FORM_FIELDS = {
  /** Render time in ms, for the minimum fill time. */
  timestamp: '_mb_ts',
  /** Must stay empty. */
  honeypot: '_mb_hp',
  locale: '_mb_locale',
  /** Path to redirect back to. */
  page: '_mb_page',
  consent: '_mb_consent',
  /** Set by the form island: milliseconds between load and submit. */
  elapsed: '_mb_elapsed',
  /** Signed databag type of a form bound to a field. */
  databag: '_mb_databag',
} as const;

/** Marks the element that shows a form's result; the form island fills it. */
export const FORM_MESSAGE_ATTRIBUTE = 'data-mb-form-message';

const DEFAULT_ERROR = 'Sorry, that did not work. Please check the form and try again.';

const INPUTS = ['text', 'textarea', 'email', 'number', 'checkbox', 'select', 'date', 'datetime'];

function inputFor(type: string, settings: Record<string, unknown>, name: string): string {
  switch (type) {
    case 'number':
      return 'number';
    case 'boolean':
      return 'checkbox';
    case 'select':
      return 'select';
    case 'date':
      return settings.mode === 'date' ? 'date' : 'datetime';
    default:
      if (/e-?mail/i.test(name)) return 'email';
      return settings.editor === 'textarea' ? 'textarea' : 'text';
  }
}

/** Fields a form may fill: supported inputs, not role-gated. */
function fillableDefs(type: ContentTypeDefinition | undefined): FieldDef[] {
  const open = new Set(
    (type?.fields ?? [])
      .filter(
        (field) => isFormField(field) && !field.readRoles?.length && !field.writeRoles?.length,
      )
      .map((field) => field.id),
  );
  return fieldDefs(type).filter((def) => open.has(def.id));
}

/** A databag type a form may store entries in. */
function databagType(ctx: RenderContext, typeId: unknown): ContentTypeDefinition | undefined {
  const type = typeof typeId === 'string' && typeId ? ctx.types.get(typeId) : undefined;
  return type?.id === typeId && type?.kind === 'data' && !type.isSystem ? type : undefined;
}

/** `mb-form-<hash>`, suffixed when the same form shows more than once on the page. */
function formId(ctx: RenderContext, ref: string): string {
  const base = `mb-form-${smallHash(ref)}`;
  let id = base;
  for (let n = 2; ctx.formIds.has(id); n++) id = `${base}-${n}`;
  ctx.formIds.add(id);
  return id;
}

const form: ElementRenderer = ({ node, frame, ctx, attrs, render }) => {
  const bound = node.bind !== undefined;
  const type = bound
    ? databagType(ctx, resolveBinding(node.bind, frame, ctx)?.value)
    : ctx.types.get(typeof node.props?.databagTypeId === 'string' ? node.props.databagTypeId : '');
  // A bound form without a picked databag type has nothing to ask for.
  if (bound && !type) return empty(ctx, attrs, 'div', 'Form');
  // A bound form's results belong to its databag type, so other instances keep theirs.
  const ref = bound ? `${nodeRef(frame, node)}@${type?.id}` : nodeRef(frame, node);
  const id = formId(ctx, ref);
  const success = text(ctx, node.props?.successMessage) || 'Thank you!';
  const result = ctx.options.formResult;
  const errors = result && !result.ok && result.form === ref ? (result.errors ?? {}) : {};
  const inner: Frame = {
    ...frame,
    form: {
      ref,
      id,
      defs: fieldDefs(type),
      each: bound ? fillableDefs(type) : null,
      successMessage: success,
      errors,
    },
  };
  if (!ctx.canvas) ctx.islands.add('form');
  const token =
    bound && type && !ctx.canvas ? ctx.options.formToken?.(nodeRef(frame, node), type.id) : null;

  const content: VNodeChild[] = [];
  let consent: VNodeChild = null;
  if (node.props?.consent === true) {
    const error = fieldError(`${id}-consent`, errors[FORM_FIELDS.consent]);
    consent = h('div', { class: 'mb-e-form-field mb-form-consent' }, [
      h('label', { class: LABEL_CLASS }, [
        h('input', {
          type: 'checkbox',
          name: FORM_FIELDS.consent,
          value: 'true',
          required: true,
          ...error.attrs,
        }),
        ' ',
        text(ctx, node.props?.consentText) || 'I agree to the processing of my data.',
      ]),
      error.node,
    ]);
  }
  // The consent checkbox goes before the first submit button, else at the end.
  for (const child of node.children ?? []) {
    if (consent && child.el === 'formSubmit') {
      content.push(consent);
      consent = null;
    }
    const rendered = render(child, inner, ctx);
    if (rendered !== null && rendered !== undefined) content.push(rendered);
  }
  if (consent) content.push(consent);

  return h(
    'form',
    {
      ...attrs,
      id,
      method: 'post',
      action: formAction(ctx, frame.kind, frame.key, node.id),
      'accept-charset': 'utf-8',
      [ISLAND_ATTRIBUTE]: 'form',
    },
    [
      h('input', { type: 'hidden', name: FORM_FIELDS.timestamp, value: String(ctx.now) }),
      h('input', { type: 'hidden', name: FORM_FIELDS.locale, value: ctx.locale }),
      h('input', { type: 'hidden', name: FORM_FIELDS.page, value: pathOf(ctx.input.url) ?? '/' }),
      token ? h('input', { type: 'hidden', name: FORM_FIELDS.databag, value: token }) : null,
      h('div', { class: HONEYPOT_CLASS, 'aria-hidden': 'true' }, [
        h('label', [
          'Leave this field empty',
          h('input', {
            type: 'text',
            name: FORM_FIELDS.honeypot,
            tabindex: '-1',
            autocomplete: 'off',
          }),
        ]),
      ]),
      ...content,
    ],
  );
};

function optionsOf(settings: Record<string, unknown>): Array<{ value: string; label: string }> {
  const options = Array.isArray(settings.options) ? settings.options : [];
  return options
    .filter(
      (entry): entry is Record<string, unknown> =>
        isRecord(entry) && typeof entry.value === 'string',
    )
    .map((entry) => ({
      value: entry.value as string,
      label: typeof entry.label === 'string' && entry.label ? entry.label : (entry.value as string),
    }));
}

/** Marks an input invalid after a post without JavaScript, with its message below it. */
function fieldError(
  inputId: string,
  message: string | undefined,
): { attrs: Record<string, string>; node: VNodeChild; id: string | undefined } {
  if (message === undefined) return { attrs: {}, node: null, id: undefined };
  if (!message) return { attrs: { 'aria-invalid': 'true' }, node: null, id: undefined };
  const id = `${inputId}-error`;
  return {
    attrs: { 'aria-invalid': 'true', 'aria-describedby': id },
    node: h('p', { class: FORM_ERROR_CLASS, id }, message),
    id,
  };
}

const numberAttr = (value: unknown): string | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? String(value) : undefined;

const formField: ElementRenderer = (args) => {
  const { node, frame, ctx, attrs } = args;
  const formFrame = frame.form;
  // In a bound form the input repeats for every field of the picked databag type.
  if (formFrame?.each) {
    if (formFrame.each.length === 0) return empty(ctx, attrs, 'div', 'Form field');
    return formFrame.each.map((def) => fieldInput(args, def, `${node.id}-${def.name}`, false));
  }
  const fieldId = typeof node.props?.fieldId === 'string' ? node.props.fieldId : '';
  const def = formFrame ? findDef(formFrame.defs, fieldId) : null;
  if (!formFrame || !def) return empty(ctx, attrs, 'div', 'Form field');
  return fieldInput(args, def, node.id, true);
};

/** One input for a field; `own` uses the node's texts and input choice. */
function fieldInput(
  { node, frame, ctx, attrs }: Parameters<ElementRenderer>[0],
  def: FieldDef,
  key: string,
  own: boolean,
): VNodeChild {
  const formFrame = frame.form as NonNullable<Frame['form']>;
  const settings = def.settings ?? {};
  const kind =
    own && INPUTS.includes(node.props?.input as string)
      ? (node.props?.input as string)
      : inputFor(def.type, settings, def.name);
  const id = `${formFrame.id}-${key}`;
  const label = (own && text(ctx, node.props?.label)) || def.label || def.name;
  const help = own ? text(ctx, node.props?.help) : '';
  const helpId = help ? `${id}-help` : undefined;
  const required = def.required === true;
  const error = fieldError(id, formFrame.errors[def.name]);
  const describedBy = [helpId, error.id].filter(Boolean).join(' ') || undefined;
  const common = {
    id,
    name: def.name,
    required,
    class: INPUT_CLASS,
    'aria-describedby': describedBy,
    'aria-invalid': error.attrs['aria-invalid'],
  };
  const placeholder = (own && text(ctx, node.props?.placeholder)) || undefined;

  let input: VNodeChild;
  switch (kind) {
    case 'textarea':
      input = h('textarea', {
        ...common,
        rows: 5,
        placeholder,
        minlength: numberAttr(settings.min),
        maxlength: numberAttr(settings.max),
      });
      break;
    case 'select': {
      const multiple = settings.multiple === true;
      input = h('select', { ...common, multiple }, [
        ...(multiple ? [] : [h('option', { value: '' }, placeholder ?? '')]),
        ...optionsOf(settings).map((option) => h('option', { value: option.value }, option.label)),
      ]);
      break;
    }
    case 'checkbox':
      return h('div', attrs, [
        h('label', { class: LABEL_CLASS, for: id }, [
          h('input', { ...common, type: 'checkbox', value: 'true', class: undefined }),
          ' ',
          label,
        ]),
        help ? h('p', { class: 'mb-form-help', id: helpId }, help) : null,
        error.node,
      ]);
    case 'number':
      input = h('input', {
        ...common,
        type: 'number',
        placeholder,
        min: numberAttr(settings.min),
        max: numberAttr(settings.max),
        step: numberAttr(settings.step) ?? (settings.integer === true ? '1' : 'any'),
      });
      break;
    default:
      input = h('input', {
        ...common,
        type: kind === 'datetime' ? 'datetime-local' : kind,
        placeholder,
        autocomplete: kind === 'email' ? 'email' : undefined,
        ...(kind === 'text' || kind === 'email'
          ? { minlength: numberAttr(settings.min), maxlength: numberAttr(settings.max) }
          : {}),
      });
  }
  return h('div', attrs, [
    h('label', { class: LABEL_CLASS, for: id }, label),
    input,
    help ? h('p', { class: 'mb-form-help', id: helpId }, help) : null,
    error.node,
  ]);
}

const formSubmit: ElementRenderer = ({ node, ctx, attrs }) => {
  const variant = (BUTTON_VARIANTS as readonly unknown[]).includes(node.props?.variant)
    ? (node.props?.variant as 'primary')
    : 'primary';
  return h(
    'button',
    { ...attrs, class: [...attrs.class, BUTTON_CLASS, buttonClass(variant)], type: 'submit' },
    text(ctx, node.props?.text) || 'Send',
  );
};

const formMessage: ElementRenderer = ({ node, frame, ctx, attrs }) => {
  const formFrame = frame.form;
  const success = text(ctx, node.props?.text) || formFrame?.successMessage || 'Thank you!';
  const result = ctx.options.formResult;
  const shown = result && formFrame && result.form === formFrame.ref ? result : null;
  return h(
    'div',
    {
      ...attrs,
      role: 'status',
      'aria-live': 'polite',
      [FORM_MESSAGE_ATTRIBUTE]: '',
      'data-success': success,
      'data-error': DEFAULT_ERROR,
      'data-state': shown ? (shown.ok ? 'success' : 'error') : undefined,
      // The canvas shows the message so it can be styled.
      hidden: !shown && !ctx.canvas,
    },
    shown ? (shown.ok ? success : shown.message || DEFAULT_ERROR) : ctx.canvas ? success : '',
  );
};

export const formElements: Record<FormElement, ElementRenderer> = {
  form,
  formField,
  formSubmit,
  formMessage,
};
