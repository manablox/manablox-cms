/** A plugin with tables, for the plugin migration tests. */
import { fileURLToPath } from 'node:url';
import { definePlugin, type ManabloxPlugin, type Scope } from '@manablox/core';
import { asc, eq } from 'drizzle-orm';
import { boolean, id, table, text, timestamp, uuid } from '../../../src/definitions/define.js';
import { environmentId } from '../../../src/definitions/scoped.js';
import { spaces } from '../../../src/definitions/spaces.js';
import { type BuiltTables, buildTables } from '../../../src/plugin-tables.js';
import {
  type DatabaseContext,
  Repository,
  type ScopedWrite,
} from '../../../src/repositories/base.js';

const notesItems = table('notes_items', {
  id: id(),
  spaceId: uuid()
    .notNull()
    .references(() => spaces, 'id', { onDelete: 'cascade' }),
  environmentId: environmentId(),
  body: text().notNull(),
  pinned: boolean().notNull().default(false),
  createdAt: timestamp().notNull().defaultNow(),
});

const tables = { notesItems };

export const folder = (name: string) => fileURLToPath(new URL(name, import.meta.url));

/** The fixture plugin, id `acme.notes`; `migrations` replaces both dialects' folders. */
export function notesPlugin(migrations?: string): ManabloxPlugin {
  return definePlugin({
    name: '@acme/Notes',
    db: {
      tables,
      migrations: {
        postgres: migrations ?? folder('migrations'),
        sqlite: migrations ?? folder('migrations-sqlite'),
      },
    },
  });
}

type NotesTables = BuiltTables<typeof tables>;

export class NotesRepository extends Repository<NotesTables> {
  constructor(context: DatabaseContext) {
    super(context, buildTables(tables, context.dialect.name));
  }

  async create(scope: ScopedWrite, body: string) {
    const [row] = await this.db
      .insert(this.t.notesItems)
      .values({ spaceId: scope.spaceId, environmentId: this.environmentOf(scope), body })
      .returning();
    if (!row) throw new Error('note not inserted');
    return row;
  }

  list(scope: Scope) {
    const { notesItems: n } = this.t;
    return this.db.select().from(n).where(this.inEnvironment(n, scope)).orderBy(asc(n.createdAt));
  }

  findById(id: string) {
    return this.findOne(this.t.notesItems, id);
  }

  async pin(id: string) {
    const { notesItems: n } = this.t;
    const [row] = await this.db.update(n).set({ pinned: true }).where(eq(n.id, id)).returning();
    return row ?? null;
  }

  remove(id: string) {
    return this.removeOne(this.t.notesItems, id);
  }

  /** Runs `fn` after the transaction the repository is bound to commits. */
  later(fn: () => void) {
    this.afterCommit(fn);
  }
}
