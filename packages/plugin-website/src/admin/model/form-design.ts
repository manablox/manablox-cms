import {
  type DesignNode,
  type ElementKind,
  findNode,
  generateFormNodes,
  isFormField,
  newNodeId,
  walkNodes,
} from '@manablox/site';

/** What the form inspector reads of a data type's field. */
export interface FormSourceField {
  id: string;
  name: string;
  label?: string | undefined;
  type: string;
  required?: boolean | undefined;
  settings?: Record<string, unknown> | undefined;
  readRoles?: readonly string[] | undefined;
  writeRoles?: readonly string[] | undefined;
}

export interface FormSourceType {
  id: string;
  label: string;
  fields: readonly FormSourceField[];
}

const labelOf = (field: FormSourceField) => field.label || field.name;

/** Whether a site form may fill a field: a supported input and no field roles. */
export function fillable(field: FormSourceField): boolean {
  return (
    isFormField(field as Parameters<typeof isFormField>[0]) &&
    !field.readRoles?.length &&
    !field.writeRoles?.length
  );
}

/** Why a form cannot fill a field, or `null` when it can. */
export function unfillableReason(field: FormSourceField): string | null {
  if (field.readRoles?.length || field.writeRoles?.length)
    return 'only some roles may read or change it';
  if (!fillable(field))
    return field.type === 'string'
      ? 'code fields have no form input'
      : `${field.type} fields have no form input`;
  return null;
}

/** The field a form takes its databag type from; `null` for a form with a fixed type. */
export function boundFieldOf(form: DesignNode): string | null {
  return typeof form.bind?.field === 'string' && form.bind.field ? form.bind.field : null;
}

/** The `form` node around (or at) `id`, else `null`. */
export function enclosingForm(root: DesignNode, id: string): DesignNode | null {
  const found = findNode(root, id);
  if (!found) return null;
  return [...found.path, found.node].reverse().find((node) => node.el === 'form') ?? null;
}

/** The `formField` nodes of a form, in order. */
function formFieldNodes(form: DesignNode): DesignNode[] {
  const out: DesignNode[] = [];
  walkNodes(form, ({ node }) => {
    if (node.el === 'formField') out.push(node);
    return undefined;
  });
  return out;
}

const fieldIdOf = (node: DesignNode): string | null =>
  typeof node.props?.fieldId === 'string' ? node.props.fieldId : null;

/** Field ids a form shows. */
export function placedFieldIds(form: DesignNode): Set<string> {
  return new Set(formFieldNodes(form).flatMap((node) => fieldIdOf(node) ?? []));
}

export type FormWarning =
  | { kind: 'noType' }
  | { kind: 'missingField' }
  | { kind: 'noInput' }
  | { kind: 'missingType'; typeId: string }
  | { kind: 'requiredMissing'; field: FormSourceField }
  | { kind: 'requiredUnfillable'; field: FormSourceField; reason: string }
  | { kind: 'unsupported'; nodeId: string; field: FormSourceField; reason: string }
  | { kind: 'unknownField'; nodeId: string; fieldId: string }
  | { kind: 'noSubmit' }
  | { kind: 'formsDisabled' };

/**
 * What stops a form from working: no or a missing data type, required fields the form does
 * not show (or cannot fill), inputs for fields it cannot fill or that are gone, no submit
 * button, and a management API without the forms secret.
 */
export function formWarnings(
  form: DesignNode,
  type: FormSourceType | null,
  options: {
    formsEnabled?: boolean | undefined;
    /** Fields of the design, for a form bound to one. */
    fields?: ReadonlyArray<{ id: string; type: string }> | undefined;
  } = {},
): FormWarning[] {
  const out: FormWarning[] = [];
  const bound = boundFieldOf(form);
  const typeId = typeof form.props?.databagTypeId === 'string' ? form.props.databagTypeId : '';
  if (bound) {
    const field = options.fields?.find((entry) => entry.id === bound);
    if (options.fields && field?.type !== 'databag') out.push({ kind: 'missingField' });
    if (formFieldNodes(form).length === 0) out.push({ kind: 'noInput' });
  } else if (!typeId) out.push({ kind: 'noType' });
  else if (!type) out.push({ kind: 'missingType', typeId });
  if (type && !bound) {
    const placed = placedFieldIds(form);
    for (const field of type.fields) {
      if (!field.required) continue;
      const reason = unfillableReason(field);
      if (reason) out.push({ kind: 'requiredUnfillable', field, reason });
      else if (!placed.has(field.id)) out.push({ kind: 'requiredMissing', field });
    }
    for (const node of formFieldNodes(form)) {
      const fieldId = fieldIdOf(node);
      const field = fieldId ? type.fields.find((entry) => entry.id === fieldId) : null;
      if (!field) out.push({ kind: 'unknownField', nodeId: node.id, fieldId: fieldId ?? '' });
      else {
        const reason = unfillableReason(field);
        if (reason) out.push({ kind: 'unsupported', nodeId: node.id, field, reason });
      }
    }
  }
  let submit = false;
  walkNodes(form, ({ node }) => {
    if (node.el === 'formSubmit') submit = true;
    return undefined;
  });
  if (!submit) out.push({ kind: 'noSubmit' });
  if (options.formsEnabled === false) out.push({ kind: 'formsDisabled' });
  return out;
}

/** A sentence per warning. */
export function formWarningText(warning: FormWarning): string {
  switch (warning.kind) {
    case 'noType':
      return 'Pick the databag type that stores what visitors send.';
    case 'missingType':
      return 'The databag type of this form no longer exists.';
    case 'missingField':
      return 'The field editors pick the databag type in no longer exists.';
    case 'noInput':
      return 'The form has no input, so it asks for nothing.';
    case 'requiredMissing':
      return `"${labelOf(warning.field)}" is required but has no input, so every submission fails.`;
    case 'requiredUnfillable':
      return `"${labelOf(warning.field)}" is required, but a form cannot fill it (${warning.reason}), so every submission fails.`;
    case 'unsupported':
      return `The input for "${labelOf(warning.field)}" is ignored: ${warning.reason}.`;
    case 'unknownField':
      return 'An input shows a field the databag type no longer has.';
    case 'noSubmit':
      return 'The form has no submit button.';
    case 'formsDisabled':
      return 'This installation does not accept form submissions yet: set SITE_FORMS_SECRET on the management API and SITE_FORMS_SECRET plus SITE_FORMS_API_URL on the site process.';
  }
}

/** Fields of the type a form can show, each with whether it is shown and may be hidden. */
export function formFieldRows(form: DesignNode, type: FormSourceType) {
  const placed = placedFieldIds(form);
  return type.fields.map((field) => {
    const reason = unfillableReason(field);
    return {
      field,
      shown: placed.has(field.id),
      /** Why it cannot be shown; `null` when it can. */
      reason,
      /** Required fields stay in the form. */
      locked: field.required === true && !reason && placed.has(field.id),
    };
  });
}

/** One `formField` node for a field, with an id not in `taken`. */
export function formFieldNode(
  field: FormSourceField,
  taken: Iterable<string>,
  locale: string,
): DesignNode | null {
  const form = generateFormNodes(
    {
      id: 'x',
      fields: [field as unknown as Parameters<typeof generateFormNodes>[0]['fields'][number]],
    },
    { taken, locale },
  );
  return form.children?.find((node) => node.el === 'formField') ?? null;
}

/** The form with an input for `field` added before its submit button, or with it removed. */
export function toggleFormField(
  form: DesignNode,
  field: FormSourceField,
  show: boolean,
  taken: Iterable<string>,
  locale: string,
): DesignNode {
  const children = [...(form.children ?? [])];
  if (!show) {
    const remove = (list: DesignNode[]): DesignNode[] =>
      list
        .filter((node) => !(node.el === 'formField' && node.props?.fieldId === field.id))
        .map((node) => (node.children ? { ...node, children: remove(node.children) } : node));
    return { ...form, children: remove(children) };
  }
  if (placedFieldIds(form).has(field.id)) return form;
  const node = formFieldNode(field, taken, locale);
  if (!node) return form;
  const submitAt = children.findIndex((entry) => entry.el === 'formSubmit');
  children.splice(submitAt === -1 ? children.length : submitAt, 0, node);
  return { ...form, children };
}

/**
 * The form rebuilt for its data type: one input per fillable field, a submit button and the
 * message. Its id, own props and style stay.
 */
export function regenerateForm(
  form: DesignNode,
  type: FormSourceType,
  taken: Iterable<string>,
  locale: string,
): DesignNode {
  const generated = generateFormNodes(type as unknown as Parameters<typeof generateFormNodes>[0], {
    taken,
    locale,
  });
  const children = (generated.children ?? []).filter((node) => {
    if (node.el !== 'formField') return true;
    const field = type.fields.find((entry) => entry.id === node.props?.fieldId);
    return field ? fillable(field) : false;
  });
  const { bind: _bind, ...fixed } = form;
  return {
    ...fixed,
    props: { ...form.props, databagTypeId: type.id },
    children,
  };
}

/** Form children without their inputs, at any depth. */
function withoutInputs(list: readonly DesignNode[]): DesignNode[] {
  return list
    .filter((node) => node.el !== 'formField')
    .map((node) => (node.children ? { ...node, children: withoutInputs(node.children) } : node));
}

/**
 * The form storing in the databag type editors pick in `fieldId`: one input before the
 * submit button repeats for every field of that type.
 */
export function bindForm(form: DesignNode, fieldId: string, taken: Iterable<string>): DesignNode {
  const { databagTypeId: _type, ...props } = form.props ?? {};
  const children = withoutInputs(form.children ?? []);
  const input: DesignNode = { id: newNodeId(new Set(taken)), el: 'formField' };
  const submitAt = children.findIndex((entry) => entry.el === 'formSubmit');
  children.splice(submitAt === -1 ? children.length : submitAt, 0, input);
  return { ...form, bind: { field: fieldId }, props, children };
}

/** A new form for a data type, with ids not in `taken`. */
export function newForm(type: FormSourceType, taken: Iterable<string>, locale: string): DesignNode {
  const form = generateFormNodes(type as unknown as Parameters<typeof generateFormNodes>[0], {
    taken,
    locale,
  });
  return regenerateForm(form, type, [...taken, form.id], locale);
}

/**
 * Why a form element cannot be added where the selection is, by kind: forms need a data
 * type and do not nest; their parts only go inside a form, inputs need a field left to show.
 */
export function formPaletteReasons(
  root: DesignNode | null,
  selectedId: string | null,
  types: readonly FormSourceType[],
): Partial<Record<ElementKind, string>> {
  const out: Partial<Record<ElementKind, string>> = {};
  const form = root && selectedId ? enclosingForm(root, selectedId) : null;
  if (types.length === 0)
    out.form = 'Create a databag type first; a form stores what visitors send there.';
  else if (form) out.form = 'Forms do not go inside forms.';
  if (!form) {
    const reason = 'Select a form or an element inside one first.';
    out.formField = reason;
    out.formSubmit = reason;
    out.formMessage = reason;
    return out;
  }
  if (boundFieldOf(form)) {
    if (formFieldNodes(form).length > 0)
      out.formField = 'The input of this form already asks for every field of the picked type.';
    return out;
  }
  const type = types.find((entry) => entry.id === form.props?.databagTypeId);
  const placed = placedFieldIds(form);
  if (!type?.fields.some((field) => fillable(field) && !placed.has(field.id)))
    out.formField = 'Every field this form can fill already has an input.';
  return out;
}

/** Whether a form bound to a field still lacks its one input. */
export function needsBoundInput(form: DesignNode): boolean {
  return boundFieldOf(form) !== null && formFieldNodes(form).length === 0;
}

/** The first field of the form's type that could get an input. */
export function nextFormField(
  form: DesignNode,
  types: readonly FormSourceType[],
): FormSourceField | null {
  const type = types.find((entry) => entry.id === form.props?.databagTypeId);
  const placed = placedFieldIds(form);
  return type?.fields.find((field) => fillable(field) && !placed.has(field.id)) ?? null;
}

/** Why an input may not be removed: inputs of required fields stay in their form. */
export function requiredInputError(
  root: DesignNode,
  id: string,
  types: readonly FormSourceType[],
): string | null {
  const node = findNode(root, id)?.node;
  if (node?.el !== 'formField') return null;
  const form = enclosingForm(root, id);
  if (form && boundFieldOf(form))
    return 'This input asks for every field of the picked databag type; without it the form asks for nothing.';
  const type = types.find((entry) => entry.id === form?.props?.databagTypeId);
  const field = type?.fields.find((entry) => entry.id === node.props?.fieldId);
  return field?.required
    ? 'A required field keeps its input, or no submission could be saved.'
    : null;
}
