import { describe, expect, it } from 'vitest';
import {
  emptyRedirectForm,
  normaliseRedirectPath,
  redirectFormIssues,
  redirectFormOf,
  redirectInput,
} from '~/features/redirects/model';

describe('redirect form', () => {
  it('normalises paths like the server', () => {
    expect(normaliseRedirectPath(' /old//page/ ')).toBe('/old/page');
    expect(normaliseRedirectPath('/')).toBe('/');
    expect(normaliseRedirectPath('old')).toBeNull();
    expect(normaliseRedirectPath('/a?b=1')).toBeNull();
    expect(normaliseRedirectPath('/a b')).toBeNull();
  });

  it('accepts a path, an absolute URL or a document', () => {
    const form = { ...emptyRedirectForm(), fromPath: '/old', toPath: '/new' };
    expect(redirectFormIssues(form)).toEqual({});
    expect(redirectFormIssues({ ...form, toPath: 'https://example.com/x' })).toEqual({});
    expect(
      redirectFormIssues({ ...form, target: 'document', toPath: '', toContentId: 'loc-1' }),
    ).toEqual({});
  });

  it('flags a missing or malformed source and target', () => {
    expect(redirectFormIssues(emptyRedirectForm())).toEqual({
      fromPath: 'Enter the old path.',
      toPath: 'Enter a path like /new-page or a full https:// address.',
    });
    const form = { ...emptyRedirectForm(), fromPath: 'old', toPath: 'new' };
    expect(Object.keys(redirectFormIssues(form))).toEqual(['fromPath', 'toPath']);
    expect(redirectFormIssues({ ...form, fromPath: '/old', toPath: '/old/' }).toPath).toMatch(
      /its own path/,
    );
    expect(
      redirectFormIssues({ ...form, fromPath: '/old', target: 'document', toContentId: null })
        .toPath,
    ).toMatch(/Pick the document/);
  });

  it('sends only the chosen target', () => {
    const form = {
      ...emptyRedirectForm(),
      fromPath: ' /old ',
      toPath: '/stale',
      target: 'document' as const,
      toContentId: 'loc-1',
      status: 302 as const,
      locale: 'de',
    };
    expect(redirectInput(form)).toEqual({
      fromPath: '/old',
      toPath: null,
      toContentId: 'loc-1',
      status: 302,
      locale: 'de',
    });
    expect(
      redirectFormOf({
        fromPath: '/a',
        toPath: '/b',
        toContentId: null,
        status: 301,
        locale: null,
      }),
    ).toEqual({ ...emptyRedirectForm(), fromPath: '/a', toPath: '/b' });
  });
});
