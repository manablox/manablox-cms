import { OpenAPIGenerator } from '@orpc/openapi';
import { ZodToJsonSchemaConverter } from '@orpc/zod/zod4';
import type { Context } from 'hono';

type GenerateOptions = Parameters<OpenAPIGenerator['generate']>[1];
type OpenApiDocument = Awaited<ReturnType<OpenAPIGenerator['generate']>>;

/** An OpenAPI document, generated on first request and cached. */
export function openApiDocument(router: object, options: GenerateOptions) {
  let cached: Promise<OpenApiDocument> | null = null;

  return async (c: Context) => {
    cached ??= generateOpenApiDocument(router, options);
    return c.json((await cached) as object);
  };
}

/** Generates a router's OpenAPI document, with the shared error responses on every operation. */
export async function generateOpenApiDocument(
  router: object,
  options: GenerateOptions,
): Promise<OpenApiDocument> {
  const generator = new OpenAPIGenerator({ schemaConverters: [new ZodToJsonSchemaConverter()] });
  return withErrorResponses(await generator.generate(router as never, options));
}

const ERROR_RESPONSES: Record<string, string> = {
  '400': 'The request cannot be acted on as stated.',
  '401': 'No principal.',
  '403': 'The principal lacks the permission.',
  '404': 'Not found, or not visible to the caller.',
  '409': 'The write collides with the current state.',
  '422': 'The input failed validation; the details say where.',
  '429': 'Too many requests; wait for the `retry-after` header.',
  '500': 'Unexpected error; masked as `internal.error`.',
};

const ERROR_SCHEMA = {
  type: 'object',
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['key', 'kind', 'status', 'message', 'details'],
      properties: {
        key: { type: 'string', description: 'The error key, e.g. `content.notFound`.' },
        kind: {
          type: 'string',
          enum: [
            'validation',
            'not_found',
            'conflict',
            'forbidden',
            'unauthorized',
            'bad_request',
            'too_large',
            'rate_limited',
            'locked',
            'unavailable',
            'internal',
          ],
        },
        status: { type: 'integer' },
        message: { type: 'string' },
        details: {
          type: 'array',
          items: {
            type: 'object',
            required: ['key'],
            properties: {
              key: { type: 'string' },
              path: { type: 'array', items: { type: ['string', 'integer'] } },
              params: { type: 'object', additionalProperties: true },
            },
          },
        },
      },
    },
  },
};

/** Adds the `Error` schema and one shared response per error status to every operation. */
function withErrorResponses(document: OpenApiDocument): OpenApiDocument {
  const components = document.components ?? {};
  document.components = components;
  components.schemas = { ...components.schemas, Error: ERROR_SCHEMA as never };
  components.responses = {
    ...components.responses,
    ...Object.fromEntries(
      Object.entries(ERROR_RESPONSES).map(([status, description]) => [
        `Error${status}`,
        {
          description,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
      ]),
    ),
  };

  for (const item of Object.values(document.paths ?? {})) {
    for (const method of ['get', 'put', 'post', 'delete', 'patch'] as const) {
      const operation = item?.[method];
      if (!operation) continue;
      const responses = operation.responses ?? {};
      operation.responses = responses;
      for (const status of Object.keys(ERROR_RESPONSES)) {
        responses[status] ??= { $ref: `#/components/responses/Error${status}` };
      }
    }
  }
  return document;
}
