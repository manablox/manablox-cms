import { type DatabaseConfig, databaseDialect } from '@manablox/core';
import postgres from 'postgres';
import type { Sql } from './client.js';

/** Schemas the app reads and writes: core and plugin tables, and the migration journals. */
const SCHEMAS = ['public', 'drizzle'];

const ident = (name: string) => `"${name.replaceAll('"', '""')}"`;

/** The role a Postgres URL logs in as, read from the server. */
export async function roleOf(config: Pick<DatabaseConfig, 'url' | 'ssl'>): Promise<string> {
  const sql = postgres(config.url, {
    max: 1,
    ...(config.ssl ? { ssl: 'require' as const } : {}),
    onnotice: () => {},
  });
  try {
    const [row] = await sql<{ role: string }[]>`select current_user as role`;
    if (!row) throw new Error('current_user not read');
    return row.role;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Throws when `appRole` is the connected role, missing, a superuser or owns anything here. */
export async function assertAppRole(owner: Sql, appRole: string): Promise<void> {
  const [self] = await owner<{ role: string }[]>`select current_user as role`;
  if (self?.role === appRole) {
    throw new Error(`the app role ${appRole} is the migration role; give the app its own role`);
  }
  const [app] = await owner<{ superuser: boolean; owned: number }[]>`
    select r.rolsuper as superuser,
      (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where c.relowner = r.oid and n.nspname in ${owner(SCHEMAS)}) as owned
    from pg_roles r where r.rolname = ${appRole}`;
  if (!app) throw new Error(`the app role ${appRole} does not exist`);
  if (app.superuser) throw new Error(`the app role ${appRole} must not be a superuser`);
  if (app.owned > 0) {
    throw new Error(
      `the app role ${appRole} owns ${app.owned} tables; the owner role must own them`,
    );
  }
}

/**
 * Grants `appRole` what the app needs on a database the connected owner role migrated: rows
 * of every table and future table, sequences, the migration journals, and `audit_entries`
 * append-only (no UPDATE, DELETE or TRUNCATE; pruning goes through `audit_entries_prune`).
 * Idempotent. Throws as `assertAppRole` does.
 */
export async function grantAppRole(owner: Sql, appRole: string): Promise<void> {
  await assertAppRole(owner, appRole);

  const role = ident(appRole);
  await owner.begin(async (tx) => {
    await tx.unsafe(`
      revoke create on schema public from public;
      grant usage on schema public to ${role};
      grant select, insert, update, delete on all tables in schema public to ${role};
      grant usage, select on all sequences in schema public to ${role};
      alter default privileges in schema public
        grant select, insert, update, delete on tables to ${role};
      alter default privileges in schema public grant usage, select on sequences to ${role};
      revoke update, delete, truncate on audit_entries from ${role};
      revoke all on function audit_entries_prune(uuid[]) from public;
      grant execute on function audit_entries_prune(uuid[]) to ${role};
      grant usage on schema drizzle to ${role};
      grant select on all tables in schema drizzle to ${role};
      alter default privileges in schema drizzle grant select on tables to ${role};
    `);
  });
}

/** Roles other than the connected one that may append to `audit_entries` but not delete. */
export async function appRolesOf(owner: Sql): Promise<string[]> {
  const rows = await owner<{ role: string }[]>`
    select r.rolname as role from pg_roles r
    where r.rolname <> current_user
      and to_regclass('public.audit_entries') is not null
      and has_table_privilege(r.oid, 'public.audit_entries', 'insert')
      and not has_table_privilege(r.oid, 'public.audit_entries', 'delete')
      and not r.rolsuper
    order by r.rolname`;
  return rows.map((row) => row.role);
}

/**
 * The startup warning for a database setup: a production Postgres instance without an owner
 * role for migrations, or a migration URL on SQLite, which ignores it.
 */
export function databaseRoleWarning(
  config: Pick<DatabaseConfig, 'url' | 'migrationUrl'>,
  production: boolean,
): string | null {
  if (databaseDialect(config.url) === 'sqlite') {
    return config.migrationUrl ? 'MIGRATION_DATABASE_URL is ignored on SQLite' : null;
  }
  if (!production || config.migrationUrl) return null;
  return 'MIGRATION_DATABASE_URL is not set: the app role owns the schema, so it could lift the audit log guard; see the database roles guide';
}
