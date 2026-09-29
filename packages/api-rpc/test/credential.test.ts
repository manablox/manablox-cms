import { fixedId, ids } from '@manablox/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { credentialRouter } from '../src/routers/credential.js';
import { failure, invoke, principal, stubContext } from './helpers/rpc.js';

function vault() {
  return { page: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() };
}

/** The stored credential's id. */
const credentialId = fixedId(21);

const input = { spaceId: ids.space, name: 'Mailer', kind: 'bearer' as const, data: { token: 't' } };

describe('credentials.list', () => {
  it('pages the vault with the default page when none is given', async () => {
    const credentials = vault();
    const empty = { items: [], total: 0, limit: 100, offset: 0 };
    credentials.page.mockResolvedValue(empty);
    const ctx = stubContext({ credentials: credentials as never });
    expect(await invoke(credentialRouter.list, { spaceId: ids.space }, ctx)).toEqual(empty);
    expect(credentials.page).toHaveBeenCalledWith(ids.space, { limit: 100, offset: 0 });
    expect(
      await failure(
        invoke(credentialRouter.list, { spaceId: ids.space, pagination: { limit: 501 } }, ctx),
      ),
    ).toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('needs credential:read, which an editor holds and a viewer lacks', async () => {
    const credentials = vault();
    credentials.page.mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 });
    const editor = stubContext({
      credentials: credentials as never,
      principal: principal({ spaces: { [ids.space]: 'editor' } }),
    });
    await invoke(credentialRouter.list, { spaceId: ids.space }, editor);
    const viewer = { ...editor, principal: principal({ spaces: { [ids.space]: 'viewer' } }) };
    expect(
      await failure(invoke(credentialRouter.list, { spaceId: ids.space }, viewer)),
    ).toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('credentials.create / update / delete', () => {
  it('need credential:write, which an editor lacks and an admin holds', async () => {
    const credentials = vault();
    credentials.create.mockResolvedValue({ id: credentialId });
    credentials.update.mockResolvedValue({ id: credentialId });
    const editor = stubContext({
      credentials: credentials as never,
      principal: principal({ spaces: { [ids.space]: 'editor' } }),
    });
    expect(await failure(invoke(credentialRouter.create, input, editor))).toMatchObject({
      code: 'FORBIDDEN',
    });

    const admin = { ...editor, principal: principal({ spaces: { [ids.space]: 'admin' } }) };
    expect(await invoke(credentialRouter.create, input, admin)).toEqual({ id: credentialId });
    expect(credentials.create).toHaveBeenCalledWith(ids.space, {
      name: 'Mailer',
      kind: 'bearer',
      data: { token: 't' },
    });

    await invoke(credentialRouter.update, { ...input, id: credentialId }, admin);
    expect(credentials.update).toHaveBeenCalledWith(ids.space, credentialId, {
      name: 'Mailer',
      kind: 'bearer',
      data: { token: 't' },
    });

    expect(
      await invoke(credentialRouter.delete, { spaceId: ids.space, id: credentialId }, admin),
    ).toEqual({ ok: true });
    expect(credentials.delete).toHaveBeenCalledWith(ids.space, credentialId);
  });
});
