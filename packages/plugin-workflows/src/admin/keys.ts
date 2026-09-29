import { invalidate, pluginKeys } from '@manablox/admin-sdk';

type Params = Record<string, unknown>;

const workflows = pluginKeys('workflows');

/** Query keys of the workflows plugin; `all` covers every one of a space. */
export const workflowKeys = {
  all: workflows.all,
  list: (spaceId: string | null) => workflows.scoped(spaceId, 'list'),
  page: (spaceId: string | null, params: Params) => workflows.scoped(spaceId, 'list', params),
  detail: (spaceId: string | null, id: string) => workflows.scoped(spaceId, 'detail', id),
  runHistory: (spaceId: string | null, id: string, params: Params) =>
    workflows.scoped(spaceId, 'runs', id, params),
  run: (spaceId: string | null, runId: string | null) => workflows.scoped(spaceId, 'run', runId),
  versions: (spaceId: string | null, id: string) => workflows.scoped(spaceId, 'versions', id),
  versionPage: (spaceId: string | null, id: string, page: number) =>
    workflows.scoped(spaceId, 'versions', id, 'page', page),
  version: (spaceId: string | null, id: string, version: number) =>
    workflows.scoped(spaceId, 'versions', id, version),
  catalog: (spaceId: string | null) => workflows.scoped(spaceId, 'catalog'),
};

/** A space's workflows, runs and versions, with the open activity log. */
export const invalidateWorkflows = workflows.invalidate;

/** The editor's catalogue, which lists credentials and what trigger kinds may point at. */
export function invalidateCatalog(spaceId: string | null): void {
  invalidate.own(workflowKeys.catalog(spaceId));
}
