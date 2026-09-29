import { ManabloxError } from '@manablox/core';
import type { Repositories } from '@manablox/db';
import { describe, expect, it } from 'vitest';
import { UserService } from '../src/user.service.js';

describe('seats limit', () => {
  it('checks the instance seats before an account is created', async () => {
    const created: unknown[] = [];
    const repos = {
      users: { create: async (row: unknown) => created.push(row) },
      audit: { record: async () => {} },
    } as unknown as Repositories;
    const checks: unknown[] = [];
    const users = new UserService(repos, {
      controls: () => ({
        assertLimit: async (spaceId, key) => {
          checks.push([spaceId, key]);
          throw ManabloxError.conflict('control.limit', { limit: key });
        },
      }),
    });

    await expect(
      users.create({
        name: 'New',
        email: 'new@example.test',
        password: 'x'.repeat(12),
        role: 'editor',
      }),
    ).rejects.toMatchObject({ key: 'control.limit' });
    expect(checks).toEqual([[null, 'seats']]);
    expect(created).toEqual([]);
  });
});
