import {
  hasMessage,
  messageFor,
  messageForKey,
  registerPluginMessages,
} from '@manablox/admin-sdk/lib/messages';
import { ORPCError } from '@orpc/client';
import { describe, expect, it } from 'vitest';

describe('GraphQL refusal messages', () => {
  it('has a sentence for each refusal key, with its limit filled in', () => {
    expect(hasMessage('graphql.introspection.disabled')).toBe(true);
    expect(hasMessage('graphql.persisted.required')).toBe(true);
    expect(hasMessage('graphql.persisted.notFound')).toBe(true);
    expect(messageForKey('graphql.query.tooDeep', { maxDepth: 8 })).toContain('8 levels');
    expect(messageForKey('graphql.query.tooComplex', { maxComplexity: 1000 })).toContain(
      'limit 1000',
    );
  });
});

describe('count limit messages', () => {
  it('names what the limit counts and where it applies', () => {
    const limit = (params: Record<string, unknown>) => messageForKey('control.limit', params);
    expect(limit({ limit: 'documents', scope: 'space:s1', used: 50, max: 50 })).toBe(
      'The limit of 50 documents in this space is reached - remove some before adding more.',
    );
    expect(limit({ limit: 'seats', scope: 'group:g1', used: 1, max: 1 })).toContain(
      '1 user for this group of spaces',
    );
    expect(limit({ limit: 'localesPerSpace', scope: 'instance', used: 3, max: 3 })).toContain(
      '3 locales per space',
    );
    expect(
      limit({ limit: 'storageBytes', scope: 'instance', used: 0, max: 2 * 1024 ** 3 }),
    ).toContain('2 GB of storage on this instance');
    expect(limit({ limit: 'apiKeys', scope: 'instance', message: 'API keys are on Pro' })).toBe(
      'API keys are on Pro',
    );
  });
});

describe('plugin messages', () => {
  it("uses the server's sentence for a plugin key, then the registered one", () => {
    const refusal = new ORPCError('FORBIDDEN', {
      data: {
        key: 'plugins.hello.shoutingOff',
        kind: 'forbidden',
        status: 403,
        message: 'Greetings in capitals are switched off in this space.',
        details: [{ key: 'plugins.hello.shoutingOff' }],
      },
    });
    expect(messageFor(refusal)).toBe('Greetings in capitals are switched off in this space.');
    expect(hasMessage('plugins.hello.tooLong')).toBe(false);
    registerPluginMessages([
      {
        errors: { 'plugins.hello.tooLong': 'At most {max} characters.' },
        nouns: { 'plugins.hello.greetings': ['greeting', 'greetings'] },
      },
    ]);
    expect(messageForKey('plugins.hello.tooLong', { max: 280 })).toBe('At most 280 characters.');
    expect(
      messageForKey('control.limit', {
        limit: 'plugins.hello.greetings',
        scope: 'space:s1',
        max: 3,
      }),
    ).toBe('The limit of 3 greetings in this space is reached - remove some before adding more.');
  });
});
