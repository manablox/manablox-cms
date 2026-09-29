import type { Scope } from '@manablox/core';
import { keepChosen } from '../transfer/format.js';
import type { DataProviderContext, TransferDataProvider } from './provider.js';

/** What `rowsSection` builds a transfer section from. */
export interface RowsSectionSpec<R extends { id: string }, E extends { id: string }> {
  /** The rows of a scope the section exports: production for the dialog, the export's scope. */
  list(context: DataProviderContext, scope: Scope): Promise<R[]>;
  /**
   * How many rows `list` gives for the space's production, best without loading them;
   * `list(...).length` by default.
   */
  count?(context: DataProviderContext, spaceId: string): Promise<number>;
  /** A row's name in the transfer dialog, which lists the rows to pick one by one. */
  label(row: R): string;
  /** A row as its export entry, which keeps the row's id. */
  toExported(row: R): E;
}

/**
 * `count`, `entries`, `export` and `ids` of a transfer section whose entries are rows picked
 * one by one; spread it into `transfer` and add the rest.
 */
export function rowsSection<R extends { id: string }, E extends { id: string }>(
  spec: RowsSectionSpec<R, E>,
): Pick<TransferDataProvider<E>, 'count' | 'entries' | 'export' | 'ids'> {
  return {
    count: async (context) =>
      spec.count
        ? spec.count(context, context.spaceId)
        : (await spec.list(context, context.spaceId)).length,
    entries: async (context) =>
      (await spec.list(context, context.spaceId)).map((row) => ({
        id: row.id,
        label: spec.label(row),
      })),
    export: async (context) =>
      keepChosen(await spec.list(context, context.scope), context.picked).map(spec.toExported),
    ids: (entries) => entries.map((entry) => entry.id),
  };
}
