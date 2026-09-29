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
import { asc, eq, inArray } from 'drizzle-orm';

/** A greeting of one space environment; `migrations/` creates it. */
const helloGreetings = table(
  'hello_greetings',
  {
    id: id(),
    spaceId: uuid()
      .notNull()
      .references(() => spaces, 'id', { onDelete: 'cascade' }),
    environmentId: environmentId(),
    message: text().notNull(),
    createdAt: timestamp().notNull().defaultNow(),
  },
  (t) => [index('hello_greetings_environment_idx').on(t.environmentId, t.createdAt)],
);

export const helloTables = { helloGreetings };

type HelloTables = BuiltTables<typeof helloTables>;

export type HelloGreetingRow = HelloTables['helloGreetings']['$inferSelect'];
type HelloGreetingInsert = HelloTables['helloGreetings']['$inferInsert'];

export class HelloGreetingRepository extends Repository<HelloTables> {
  constructor(context: DatabaseContext) {
    super(context, buildTables(helloTables, context.dialect.name));
  }

  async create(scope: ScopedWrite, message: string): Promise<HelloGreetingRow> {
    const { helloGreetings: g } = this.t;
    const [row] = await this.db
      .insert(g)
      .values({ spaceId: scope.spaceId, environmentId: this.environmentOf(scope), message })
      .returning();
    if (!row) throw new Error('greeting not inserted');
    return row;
  }

  /** Writes rows as given, ids included. */
  async insert(rows: readonly HelloGreetingInsert[]): Promise<void> {
    if (rows.length) await this.db.insert(this.t.helloGreetings).values([...rows]);
  }

  list(scope: Scope): Promise<HelloGreetingRow[]> {
    const { helloGreetings: g } = this.t;
    return this.db
      .select()
      .from(g)
      .where(this.inEnvironment(g, scope))
      .orderBy(asc(g.createdAt), asc(g.id));
  }

  findById(id: string): Promise<HelloGreetingRow | null> {
    return this.findOne(this.t.helloGreetings, id);
  }

  async update(id: string, message: string): Promise<HelloGreetingRow | null> {
    const { helloGreetings: g } = this.t;
    const [row] = await this.db.update(g).set({ message }).where(eq(g.id, id)).returning();
    return row ?? null;
  }

  remove(id: string): Promise<boolean> {
    return this.removeOne(this.t.helloGreetings, id);
  }

  /** Greetings of a space across its environments. */
  countBySpace(spaceId: string): Promise<number> {
    const { helloGreetings: g } = this.t;
    return this.db.$count(g, eq(g.spaceId, spaceId));
  }

  /** Greetings of the spaces, or of every space. */
  async countForSpaces(spaceIds: readonly string[] | 'all'): Promise<number> {
    const { helloGreetings: g } = this.t;
    if (spaceIds === 'all') return this.db.$count(g);
    if (spaceIds.length === 0) return 0;
    return this.db.$count(g, inArray(g.spaceId, [...spaceIds]));
  }
}

/** The plugin's repositories on the connection or transaction `repos` is bound to. */
export const helloRepos = pluginRepos((context) => ({
  greetings: new HelloGreetingRepository(context),
}));
