import { describe, expect, it } from 'vitest';
import { type AuditEntry, actionLabel, targetKindLabel, targetRoute } from '~/features/audit/model';

const entry = (targetKind: string, action: string) =>
  ({ targetKind, action, targetId: 'r1', meta: null }) as unknown as AuditEntry;

describe('audit labels', () => {
  it('labels redirect rows and links them to the redirects page', () => {
    expect(targetKindLabel('redirect')).toBe('Redirect');
    expect(actionLabel('redirect.create')).toBe('Added a redirect');
    expect(targetRoute(entry('redirect', 'redirect.update'))).toBe('/redirects');
  });

  it('labels credential rows and links them to the credentials tab', () => {
    expect(targetKindLabel('credential')).toBe('Credential');
    expect(actionLabel('credential.create')).toBe('Added a credential');
    expect(actionLabel('credential.delete')).toBe('Removed a credential');
    expect(targetRoute(entry('credential', 'credential.update'))).toBe('/settings?tab=credentials');
  });

  it('shows an unknown kind and action under their keys', () => {
    expect(targetKindLabel('acmeThing' as never)).toBe('acmeThing');
    expect(actionLabel('acmeThing.create')).toBe('acmeThing.create');
  });
});
