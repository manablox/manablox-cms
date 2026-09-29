import type {
  ContentBeforeListHookContext,
  ContentListRequest,
  ContentReadManyHookContext,
} from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type { ContentRow } from '@manablox/db';
import type { Actor, ContentHookContext } from './types.js';

export interface ReadScope {
  actor: Actor | null;
  spaceId: string | null;
  environmentId?: string | null | undefined;
  published: boolean;
}

/** `content:beforeList` when registered; a throw refuses the read. */
export async function runBeforeList(
  manablox: Manablox,
  request: ContentListRequest,
  context: Omit<ContentBeforeListHookContext, 'manablox'>,
): Promise<void> {
  if (!manablox.hooks.has('content:beforeList')) return;
  await manablox.hooks.run('content:beforeList', request, { manablox, ...context });
}

/** Whether any read hook is registered, so callers can skip the pass. */
export function hasReadHooks(manablox: Manablox, list = false): boolean {
  const { hooks } = manablox;
  return (
    hooks.has('field:afterRead') ||
    hooks.has('content:afterRead') ||
    hooks.has('content:afterReadMany') ||
    (list && hooks.has('content:afterList'))
  );
}

/**
 * Every read passes here: `field:afterRead` and `content:afterRead` per row, then
 * `content:afterReadMany` once, then `content:afterList` for a list page.
 */
export async function runReadHooks(
  manablox: Manablox,
  rows: ContentRow[],
  scope: ReadScope,
  options: { list?: boolean } = {},
): Promise<ContentRow[]> {
  const { hooks } = manablox;
  const fieldHooks = hooks.has('field:afterRead');
  const rowHooks = hooks.has('content:afterRead');
  let kept = rows;
  if (fieldHooks || rowHooks) {
    kept = [];
    for (const row of rows) {
      const contentType = manablox.contentTypes.tryGet(row.typeId);
      if (!contentType) {
        kept.push(row);
        continue;
      }
      const context: ContentHookContext = {
        manablox,
        contentType,
        actor: scope.actor,
        spaceId: row.spaceId,
        environmentId: row.environmentId,
        previous: null as never,
      };
      const read = fieldHooks ? await readFields(manablox, row, context) : row;
      const result = rowHooks
        ? ((await hooks.run('content:afterRead', read as never, context)) as ContentRow | null)
        : read;
      if (result) kept.push(result);
    }
  }
  const context: ContentReadManyHookContext = {
    manablox,
    actor: scope.actor,
    spaceId: scope.spaceId,
    ...(scope.environmentId ? { environmentId: scope.environmentId } : {}),
    published: scope.published,
  };
  if (hooks.has('content:afterReadMany')) {
    kept = (await hooks.run('content:afterReadMany', kept, context)) as ContentRow[];
  }
  if (options.list && hooks.has('content:afterList')) {
    kept = (await hooks.run('content:afterList', kept, context)) as ContentRow[];
  }
  return kept;
}

/** `field:afterRead` for each top-level field the row holds. */
async function readFields(
  manablox: Manablox,
  row: ContentRow,
  context: ContentHookContext,
): Promise<ContentRow> {
  const fields = { ...row.fields };
  for (const field of context.contentType.fields) {
    if (!(field.name in fields)) continue;
    fields[field.name] = await manablox.hooks.run('field:afterRead', fields[field.name], {
      ...context,
      field,
    } as never);
  }
  return { ...row, fields };
}
