import {
  CONTROL_CATALOGUE_VERSION,
  type ControlDescription,
  describeControls,
} from '@manablox/core';
import { generateOpenApiDocument } from '../surfaces/openapi.js';
import { controlRouter } from './router.js';

type Schema = Record<string, unknown>;

const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });
const nullable = (schema: Schema): Schema => ({ anyOf: [schema, { type: 'null' }] });

/** Value shapes the catalogue uses, as JSON Schema. */
const VALUE_SCHEMAS: Record<string, Schema> = {
  FeatureControl: {
    type: 'object',
    required: ['enabled'],
    properties: {
      enabled: { type: 'boolean' },
      presentation: { type: 'string', enum: ['hidden', 'locked'] },
      message: { type: 'string', maxLength: 500 },
      link: { type: 'string', format: 'uri' },
    },
    additionalProperties: false,
  },
  LimitControl: {
    type: 'object',
    required: ['max'],
    properties: {
      max: { type: ['integer', 'null'], minimum: 0, description: '`null` is unlimited.' },
      mode: { type: 'string', enum: ['hard', 'soft', 'off'], default: 'hard' },
      thresholds: {
        type: 'array',
        items: { type: 'integer', minimum: 1, maximum: 1000 },
        maxItems: 10,
        description: 'Percent; default `[80, 100]`.',
      },
    },
    additionalProperties: false,
  },
  RateRule: {
    type: 'object',
    required: ['max', 'windowSeconds'],
    properties: {
      max: { type: 'integer', minimum: 0 },
      windowSeconds: { type: 'integer', minimum: 1, maximum: 86_400 },
    },
    additionalProperties: false,
  },
  ConcurrencyRule: {
    type: 'object',
    required: ['max'],
    properties: { max: { type: 'integer', minimum: 0 } },
    additionalProperties: false,
  },
  StateControl: {
    type: 'object',
    required: ['status'],
    properties: {
      status: { type: 'string', enum: ['active', 'readOnly', 'suspended'] },
      message: { type: 'string', maxLength: 1000 },
    },
    additionalProperties: false,
  },
  AdminBanner: {
    type: 'object',
    required: ['id', 'level', 'text', 'dismissible', 'audience'],
    properties: {
      id: { type: 'string', minLength: 1, maxLength: 64 },
      level: { type: 'string', enum: ['info', 'warning', 'danger'] },
      text: { type: 'string', minLength: 1, maxLength: 500 },
      link: { type: 'string', format: 'uri' },
      dismissible: { type: 'boolean' },
      audience: { type: 'string', enum: ['all', 'superadmin'] },
    },
    additionalProperties: false,
  },
  AdminLinks: {
    type: 'object',
    properties: Object.fromEntries(
      ['upgrade', 'billing', 'support', 'docs'].map((name) => [
        name,
        { type: 'string', format: 'uri' },
      ]),
    ),
    additionalProperties: false,
  },
};

/** The JSON Schema of one control's value. */
function valueSchema(control: ControlDescription): Schema {
  const { key, kind } = control;
  const fallback = control.default;
  if (kind === 'feature') return ref('FeatureControl');
  if (kind === 'limit' || kind === 'usage') return ref('LimitControl');
  if (kind === 'state') return ref('StateControl');
  if (key === 'admin.banners') return { type: 'array', items: ref('AdminBanner'), maxItems: 20 };
  if (key === 'admin.links') return ref('AdminLinks');
  if (key === 'uploads.allowedMimeTypes') {
    return nullable({ type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 200 });
  }
  if (key === 'snapshots.interval') return nullable({ type: 'string', enum: ['daily', 'hourly'] });
  if (kind === 'rateLimit' && typeof fallback !== 'number') {
    return nullable(ref(/concurrency|parallel/.test(key) ? 'ConcurrencyRule' : 'RateRule'));
  }
  if (typeof fallback === 'boolean') return { type: 'boolean' };
  if (typeof fallback === 'string') return { type: 'string' };
  if (typeof fallback === 'number' || fallback === null) {
    return kind === 'retention' || kind === 'upload'
      ? nullable({ type: 'integer', minimum: 1 })
      : { type: 'integer' };
  }
  return {};
}

/** The flat body: stored keys; plugin flags match `features.plugins.<id>`. */
function settingsSchemas(): Record<string, Schema> {
  const controls = describeControls();
  const property = (control: ControlDescription): Schema => ({
    ...valueSchema(control),
    description: `${control.description} Scopes: ${control.scopes.join(', ')}.`,
    default: control.default,
  });
  const flat: Schema = {
    type: 'object',
    description: 'Stored control keys and their values.',
    properties: Object.fromEntries(
      controls
        .filter((control) => !control.pattern)
        .map((control) => [control.key, property(control)]),
    ),
    patternProperties: {
      '^features\\.plugins\\.[A-Za-z0-9][A-Za-z0-9._-]*$': ref('FeatureControl'),
    },
    additionalProperties: false,
  };

  const grouped: Record<string, Record<string, Schema>> = {};
  const top: Record<string, Schema> = {};
  for (const control of controls) {
    const dot = control.key.indexOf('.');
    if (dot < 0) {
      top[control.key] = property(control);
      continue;
    }
    if (control.pattern) continue;
    const group = control.key.slice(0, dot);
    grouped[group] = { ...grouped[group], [control.key.slice(dot + 1)]: property(control) };
  }
  const groupedSchema: Schema = {
    type: 'object',
    description:
      'The same keys grouped by their prefix: `{ "features": { "sso": ... } }` is `features.sso`.',
    properties: {
      ...top,
      ...Object.fromEntries(
        Object.entries(grouped).map(([group, properties]) => [
          group,
          {
            type: 'object',
            properties,
            ...(group === 'features'
              ? {
                  patternProperties: {
                    '^plugins\\.[A-Za-z0-9][A-Za-z0-9._-]*$': ref('FeatureControl'),
                  },
                }
              : {}),
            additionalProperties: false,
          },
        ]),
      ),
    },
  };
  return {
    ...VALUE_SCHEMAS,
    ControlSettings: flat,
    ControlSettingsGrouped: groupedSchema,
    ControlSettingsInput: {
      description: 'Flat stored keys, grouped keys, or both; a key given twice is refused.',
      anyOf: [ref('ControlSettings'), ref('ControlSettingsGrouped')],
    },
  };
}

type Document = Awaited<ReturnType<typeof generateOpenApiDocument>>;

/** The control API's OpenAPI 3.1 document: routes, catalogue schemas, bearer auth. */
export async function controlOpenApiDocument(): Promise<Document> {
  const document = await generateOpenApiDocument(controlRouter, {
    info: {
      title: 'Manablox Control API',
      version: CONTROL_CATALOGUE_VERSION,
      description:
        'Feature flags, limits, space groups and provisioning for the layer that runs the instance.',
    },
    servers: [{ url: '/control/v1' }],
  });

  const components = document.components ?? {};
  document.components = components;
  components.schemas = { ...components.schemas, ...(settingsSchemas() as Record<string, never>) };
  components.securitySchemes = {
    ...(components.securitySchemes ?? {}),
    controlKey: { type: 'http', scheme: 'bearer', description: '`CONTROL_API_KEY`.' },
  };
  document.security = [{ controlKey: [] }];

  const settingsPath = document.paths?.['/settings'];
  for (const method of ['put', 'patch'] as const) {
    const operation = settingsPath?.[method];
    if (!operation) continue;
    operation.requestBody = {
      required: true,
      content: { 'application/json': { schema: ref('ControlSettingsInput') as never } },
    };
  }

  for (const item of Object.values(document.paths ?? {})) {
    const operation = item?.post;
    if (!operation) continue;
    operation.parameters = [
      ...(operation.parameters ?? []),
      {
        name: 'Idempotency-Key',
        in: 'header',
        required: false,
        description: 'Repeats within 24 hours replay the first response.',
        schema: { type: 'string', maxLength: 255 },
      },
    ];
  }
  return document;
}
