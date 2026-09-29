import { RunError, SIGNATURE_HEADER } from '@manablox/core';
import { signBody } from '@manablox/core/node';
import { credentialHeaders } from '@manablox/services';
import { defineWorkflowAction, type WorkflowActionContext } from '../../define/action.js';
import {
  clamp,
  headerMap,
  isHttpUrl,
  keyValueRows,
  looksLikeJson,
  readResponse,
  timeoutField,
  withDeadline,
} from './shared.js';

export interface HttpConfig extends Record<string, unknown> {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  headers: Array<{ name: string; value: string }>;
  /** `event`: the run context as JSON. `custom`: `template`, rendered. `none`: no body. */
  body: { mode: 'event' | 'custom' | 'none'; template: string };
  /** When set, signs the body as `x-manablox-signature: sha256=<hmac>`. */
  secret: string | null;
  timeoutMs: number;
  /** Treat a 4xx / 5xx as a result to branch on, not a failure. */
  allowErrorStatus: boolean;
}

const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

export const httpAction = defineWorkflowAction<HttpConfig>({
  type: 'http',
  label: 'Call an API',
  description: 'An HTTP request. What it answers is available to every later node.',
  icon: 'webhook',
  tone: 'violet',
  group: 'data',
  inputs: [{ name: 'in', label: 'Anything', type: 'any' }],
  ports: [],
  output: { name: 'ok', label: 'The response', type: 'httpResponse' },
  outputPaths: [
    { path: 'status', type: 'number', hint: 'The HTTP status' },
    { path: 'ok', type: 'boolean', hint: 'Whether the status was 2xx' },
    { path: 'body', type: 'json', hint: 'The parsed response - JSON when it was JSON' },
    { path: 'text', type: 'text', hint: 'The response as text' },
    { path: 'headers', type: 'json', hint: 'Response headers, lower-cased' },
    { path: 'ms', type: 'number', hint: 'How long it took' },
  ],
  credential: { kinds: ['apiKey', 'bearer', 'basic', 'oauth2'], required: false },
  fields: [
    {
      name: 'method',
      label: 'Method',
      kind: 'select',
      width: 'half',
      options: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((value) => ({
        value,
        label: value,
      })),
    },
    timeoutField,
    { name: 'url', label: 'URL', kind: 'template', required: true, placeholder: 'https://' },
    { name: 'headers', label: 'Headers', kind: 'keyValue' },
    {
      name: 'body',
      label: 'Body',
      kind: 'json',
      hint: 'Send the whole event, a body you write, or nothing.',
    },
    {
      name: 'secret',
      label: 'Signing secret',
      kind: 'password',
      hint: 'Signs the body as x-manablox-signature, the way a webhook is signed.',
    },
    {
      name: 'allowErrorStatus',
      label: 'A 4xx or 5xx is a result, not a failure',
      kind: 'switch',
      hint: 'Leaves by "succeeded" whatever the status, so a later node can branch on it.',
    },
  ],
  defaults: () => ({
    method: 'POST',
    url: '',
    headers: [],
    body: { mode: 'event', template: '' },
    secret: null,
    timeoutMs: 10_000,
    allowErrorStatus: false,
  }),
  validate: (config, at, add) => {
    const url = config.url?.trim() ?? '';
    if (!url.includes('{{') && !isHttpUrl(url))
      add('plugins.workflows.node.http.urlInvalid', at('url'));
    if (url.includes('{{') && !/^https?:\/\//i.test(url)) {
      add('plugins.workflows.node.http.urlInvalid', at('url'));
    }
    const headers = keyValueRows(config.headers)
      .map((header) => ({ name: header.name.trim(), value: header.value }))
      .filter((header) => header.name || header.value.trim());
    for (const [index, header] of headers.entries()) {
      if (!HEADER_NAME.test(header.name)) {
        add('plugins.workflows.node.http.headerNameInvalid', at('headers', index, 'name'), {
          name: header.name,
        });
      }
    }
    return {
      method: config.method,
      url,
      headers,
      body: { mode: config.body?.mode ?? 'event', template: config.body?.template ?? '' },
      secret: config.secret?.trim() || null,
      timeoutMs: clamp(config.timeoutMs ?? 10_000, 1_000, 120_000),
      allowErrorStatus: Boolean(config.allowErrorStatus),
    };
  },
  execute: async (ctx: WorkflowActionContext<HttpConfig>) => {
    const { config } = ctx;
    const url = ctx.render(config.url);
    const headers = new Headers();
    for (const header of config.headers) headers.set(header.name, ctx.render(header.value));

    if (ctx.credential) {
      for (const [name, value] of Object.entries(
        await credentialHeaders(ctx.credential, ctx.fetch),
      )) {
        headers.set(name, value);
      }
    }

    let body: string | undefined;
    if (config.method !== 'GET' && config.body.mode !== 'none') {
      if (config.body.mode === 'event') {
        body = JSON.stringify(ctx.run);
        if (!headers.has('content-type')) headers.set('content-type', 'application/json');
      } else {
        const template = config.body.template;
        // JSON templates render as JSON so placeholders keep their types.
        const json = looksLikeJson(template);
        body = json ? ctx.renderJson(template) : ctx.render(template);
        if (!headers.has('content-type')) {
          headers.set('content-type', json ? 'application/json' : 'text/plain');
        }
      }
    }

    headers.set('x-manablox-event', ctx.run.event);
    headers.set('x-manablox-workflow', ctx.workflow.id);
    if (config.secret && body !== undefined) {
      headers.set(SIGNATURE_HEADER, signBody(config.secret, body));
    }

    const started = Date.now();
    let response: Response;
    try {
      response = await ctx.fetch(url, {
        method: config.method,
        headers,
        ...(body !== undefined ? { body } : {}),
        signal: withDeadline(ctx.signal, config.timeoutMs),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new RunError(
        'plugins.workflows.run.requestFailed',
        { method: config.method, url, reason },
        `${config.method} ${url} failed: ${reason}`,
      );
    }

    const { text, body: parsed } = await readResponse(response);
    const output = {
      url,
      method: config.method,
      ok: response.ok,
      status: response.status,
      headers: headerMap(response.headers),
      body: parsed,
      text,
      ms: Date.now() - started,
    };
    // The log gets an excerpt; the output has the full response.
    const detail = {
      url,
      method: config.method,
      status: response.status,
      ms: output.ms,
      response: text.slice(0, 500),
    };

    if (!response.ok && !config.allowErrorStatus) {
      throw new RunError(
        'plugins.workflows.run.httpStatus',
        { method: config.method, url, status: response.status },
        `${config.method} ${url} answered HTTP ${response.status}`,
        { detail },
      );
    }
    return { kind: 'ok', message: `HTTP ${response.status}`, detail, output };
  },
});
