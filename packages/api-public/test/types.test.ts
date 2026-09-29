import { Manablox } from '@manablox/core/node';
import { builtinFieldTypes } from '@manablox/fields';
import { call } from '@orpc/server';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PublicContext } from '../src/context.js';
import { publicRouter } from '../src/router.js';

let manablox: Manablox;

beforeAll(async () => {
  manablox = new Manablox({
    database: { url: 'postgres://unused' },
    auth: { secret: 'test' },
    fieldTypes: builtinFieldTypes,
    logLevel: 'silent',
    contentTypes: [
      {
        name: 'faq',
        fields: [
          {
            name: 'entries',
            type: 'repeater',
            settings: {
              fields: [
                { name: 'question', type: 'string', required: true },
                { name: 'icon', type: 'asset' },
                {
                  name: 'notes',
                  type: 'repeater',
                  settings: { fields: [{ name: 'text', type: 'string' }] },
                },
              ],
            },
          },
        ],
      },
    ],
  });
  await manablox.init();
});

describe('/v1/types', () => {
  it('describes repeater sub-fields recursively', async () => {
    const result = await call(publicRouter.types, undefined, {
      context: { manablox, spaceId: null } as unknown as PublicContext,
    });
    const faq = result.types.find((type) => type.name === 'faq');
    expect(faq?.fields).toEqual([
      {
        name: 'entries',
        type: 'repeater',
        required: false,
        list: true,
        kind: 'items',
        fields: [
          {
            name: 'question',
            type: 'string',
            required: true,
            list: false,
            kind: 'scalar',
            scalar: 'String',
          },
          {
            name: 'icon',
            type: 'asset',
            required: false,
            list: false,
            kind: 'ref',
            target: 'asset',
          },
          {
            name: 'notes',
            type: 'repeater',
            required: false,
            list: true,
            kind: 'items',
            fields: [
              {
                name: 'text',
                type: 'string',
                required: false,
                list: false,
                kind: 'scalar',
                scalar: 'String',
              },
            ],
          },
        ],
      },
    ]);
  });
});
