import type { Scope } from '@manablox/core';
import {
  type BuiltTables,
  buildTables,
  type DatabaseContext,
  pluginRepos,
  Repository,
  type ScopedWrite,
} from '@manablox/db';
import {
  environmentId,
  id,
  index,
  spaces,
  table,
  text,
  timestamp,
  uuid,
} from '@manablox/db/definitions';
import { asc } from 'drizzle-orm';

/** A stamp on one of hello's greetings, or a loose one without; `migrations/` creates it. */
const helloExtraStamps = table(
  'hello_extra_stamps',
  {
    id: id(),
    spaceId: uuid()
      .notNull()
      .references(() => spaces, 'id', { onDelete: 'cascade' }),
    environmentId: environmentId(),
    /** A `hello_greetings` row; another plugin's table, so no foreign key. */
    greetingId: uuid(),
    label: text().notNull(),
    createdAt: timestamp().notNull().defaultNow(),
  },
  (t) => [index('hello_extra_stamps_environment_idx').on(t.environmentId, t.createdAt)],
);

export const helloExtraTables = { helloExtraStamps };

type HelloExtraTables = BuiltTables<typeof helloExtraTables>;

export type HelloExtraStampRow = HelloExtraTables['helloExtraStamps']['$inferSelect'];
type HelloExtraStampInsert = HelloExtraTables['helloExtraStamps']['$inferInsert'];

export class HelloExtraStampRepository extends Repository<HelloExtraTables> {
  constructor(context: DatabaseContext) {
    super(context, buildTables(helloExtraTables, context.dialect.name));
  }

  async create(
    scope: ScopedWrite,
    label: string,
    greetingId: string | null = null,
  ): Promise<HelloExtraStampRow> {
    const { helloExtraStamps: s } = this.t;
    const [row] = await this.db
      .insert(s)
      .values({
        spaceId: scope.spaceId,
        environmentId: this.environmentOf(scope),
        label,
        greetingId,
      })
      .returning();
    if (!row) throw new Error('stamp not inserted');
    return row;
  }

  /** Writes rows as given, ids included. */
  async insert(rows: readonly HelloExtraStampInsert[]): Promise<void> {
    if (rows.length) await this.db.insert(this.t.helloExtraStamps).values([...rows]);
  }

  list(scope: Scope): Promise<HelloExtraStampRow[]> {
    const { helloExtraStamps: s } = this.t;
    return this.db
      .select()
      .from(s)
      .where(this.inEnvironment(s, scope))
      .orderBy(asc(s.createdAt), asc(s.id));
  }
}

/** The plugin's repositories on the connection or transaction `repos` is bound to. */
export const helloExtraRepos = pluginRepos((context) => ({
  stamps: new HelloExtraStampRepository(context),
}));
