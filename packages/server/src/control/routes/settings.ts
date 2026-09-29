import { CONTROL_CATALOGUE_VERSION, describeControls } from '@manablox/core';
import { z } from 'zod';
import { base } from '../base.js';
import { scopedSettings, scopeParam, settings } from '../schemas.js';

export const catalogue = base
  .route({
    method: 'GET',
    path: '/catalogue',
    summary: 'Every control key with kind, default and allowed scopes',
    tags: ['settings'],
  })
  .output(
    z.object({
      version: z.string(),
      controls: z.array(
        z.object({
          key: z.string(),
          kind: z.string(),
          scopes: z.array(z.enum(['instance', 'group', 'space'])),
          default: z.unknown(),
          description: z.string(),
          restrictsByDefault: z.boolean(),
          pattern: z.boolean(),
        }),
      ),
    }),
  )
  .handler(() => ({
    version: CONTROL_CATALOGUE_VERSION,
    controls: describeControls().map((control) => ({ ...control, scopes: [...control.scopes] })),
  }));

/** A plugin ceiling's feature value, by stored key. */
const ceilings = z
  .record(
    z.string(),
    z.object({
      enabled: z.boolean(),
      presentation: z.enum(['hidden', 'locked']).optional(),
      message: z.string().optional(),
      link: z.string().optional(),
    }),
  )
  .describe('Features plugins cap above every scope, by key; read-only.');

export const settingsRoutes = {
  get: base
    .route({
      method: 'GET',
      path: '/settings',
      summary: 'Stored values of one scope, or of every scope, and the ceilings',
      description:
        'The features plugins cap above every scope are listed read-only under `ceilings`; no scope can switch them back on.',
      tags: ['settings'],
    })
    .input(z.object({ scope: scopeParam.optional() }))
    .output(
      z.union([
        scopedSettings.extend({ ceilings }),
        z.object({ scopes: z.record(z.string(), settings), ceilings }),
      ]),
    )
    .handler(async ({ input, context }) => ({
      ...(input.scope
        ? await context.api.settings(input.scope)
        : { scopes: await context.api.allSettings() }),
      ceilings: context.api.ceilings(),
    })),

  replace: base
    .route({
      method: 'PUT',
      path: '/settings',
      summary: "Replace a scope's whole set atomically",
      tags: ['settings'],
      inputStructure: 'detailed',
    })
    .input(z.object({ query: z.object({ scope: scopeParam }), body: settings }))
    .output(scopedSettings)
    .handler(({ input, context }) => context.api.replaceSettings(input.query.scope, input.body)),

  patch: base
    .route({
      method: 'PATCH',
      path: '/settings',
      summary: 'Set the given keys, keep the others',
      tags: ['settings'],
      inputStructure: 'detailed',
    })
    .input(z.object({ query: z.object({ scope: scopeParam }), body: settings }))
    .output(scopedSettings)
    .handler(({ input, context }) => context.api.patchSettings(input.query.scope, input.body)),

  delete: base
    .route({
      method: 'DELETE',
      path: '/settings/{key}',
      summary: 'Remove one key, restoring its default at the scope',
      tags: ['settings'],
      inputStructure: 'detailed',
    })
    .input(
      z.object({
        params: z.object({ key: z.string().min(1).max(200) }),
        query: z.object({ scope: scopeParam }),
      }),
    )
    .output(z.object({ scope: z.string(), removed: z.boolean() }))
    .handler(({ input, context }) =>
      context.api.deleteSetting(input.query.scope, input.params.key),
    ),
};
