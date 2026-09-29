import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isUniqueViolation } from '../src/errors.js';
import { createRepositoryContext, type RepositoryTestContext } from './helpers/repository.js';

let ctx: RepositoryTestContext;

beforeAll(async () => {
  ctx = await createRepositoryContext('user');
});
afterAll(async () => {
  await ctx?.close();
});

const stamp = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

describe('UserRepository.create', () => {
  it('writes the credential the way better-auth 1.7 looks it up', async () => {
    const { accounts } = ctx.handle.tables;
    const user = await ctx.repos.users.create({
      name: 'Sam',
      email: `sam-${stamp()}@example.com`,
      role: 'editor',
      passwordHash: '$argon2id$hash',
    });

    const rows = await ctx.handle.db.select().from(accounts).where(eq(accounts.userId, user.id));
    expect(rows).toHaveLength(1);
    // Sign-in matches on all three.
    expect(rows[0]).toMatchObject({
      providerId: 'credential',
      issuer: 'local:credential',
      accountId: user.id,
      password: '$argon2id$hash',
    });
  });

  it('refuses a second account on the same email', async () => {
    const email = `dup-${stamp()}@example.com`;
    const make = () =>
      ctx.repos.users.create({ name: 'A', email, role: 'editor', passwordHash: 'x' });
    await make();
    await expect(make()).rejects.toSatisfy((error: unknown) => isUniqueViolation(error, 'email'));
  });
});

describe('UserRepository passwords and sessions', () => {
  it('replaces the credential rather than adding a second one', async () => {
    const { accounts } = ctx.handle.tables;
    const user = await ctx.repos.users.create({
      name: 'Pat',
      email: `pat-${stamp()}@example.com`,
      role: 'editor',
      passwordHash: 'old',
    });
    await ctx.repos.users.setPasswordHash(user.id, 'new');

    const rows = await ctx.handle.db.select().from(accounts).where(eq(accounts.userId, user.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.password).toBe('new');
  });

  it('revokes every session of one user and nobody else', async () => {
    const { sessions } = ctx.handle.tables;
    const [a, b] = await Promise.all(
      ['a', 'b'].map((n) =>
        ctx.repos.users.create({
          name: n,
          email: `${n}-${stamp()}@example.com`,
          role: 'editor',
          passwordHash: 'x',
        }),
      ),
    );
    const expiresAt = new Date(Date.now() + 60_000);
    await ctx.handle.db.insert(sessions).values([
      { userId: a!.id, token: `a1-${stamp()}`, expiresAt },
      { userId: a!.id, token: `a2-${stamp()}`, expiresAt },
      { userId: b!.id, token: `b1-${stamp()}`, expiresAt },
    ]);

    await ctx.repos.users.revokeSessions(a!.id);

    expect(
      await ctx.handle.db.select().from(sessions).where(eq(sessions.userId, a!.id)),
    ).toHaveLength(0);
    expect(
      await ctx.handle.db.select().from(sessions).where(eq(sessions.userId, b!.id)),
    ).toHaveLength(1);
  });
});

describe('UserRepository.delete', () => {
  it('takes the credential and the memberships with it', async () => {
    const { accounts, memberships } = ctx.handle.tables;
    const user = await ctx.repos.users.create({
      name: 'Gone',
      email: `gone-${stamp()}@example.com`,
      role: 'editor',
      passwordHash: 'x',
    });
    await ctx.repos.users.grant(user.id, ctx.spaceId, 'viewer');
    expect(await ctx.repos.users.listMembershipsWithSpaces(user.id)).toMatchObject([
      { role: 'viewer', space: { id: ctx.spaceId } },
    ]);

    await ctx.repos.users.delete(user.id);

    expect(await ctx.repos.users.findById(user.id)).toBeNull();
    expect(
      await ctx.handle.db.select().from(accounts).where(eq(accounts.userId, user.id)),
    ).toHaveLength(0);
    expect(
      await ctx.handle.db.select().from(memberships).where(eq(memberships.userId, user.id)),
    ).toHaveLength(0);
  });
});

describe('UserRepository.countByRole', () => {
  it('counts the instance role', async () => {
    const before = await ctx.repos.users.countByRole('superadmin');
    await ctx.repos.users.create({
      name: 'Root',
      email: `root-${stamp()}@example.com`,
      role: 'superadmin',
      passwordHash: 'x',
    });
    expect(await ctx.repos.users.countByRole('superadmin')).toBe(before + 1);
  });
});
