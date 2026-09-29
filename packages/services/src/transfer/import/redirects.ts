import type { Repositories } from '@manablox/db';
import type { ExportedRedirect } from '../format.js';

export async function importRedirects(
  repos: Repositories,
  spaceId: string,
  redirects: ExportedRedirect[],
  actorId: string | null,
): Promise<void> {
  for (const redirect of redirects) {
    await repos.redirects.create(spaceId, {
      locale: redirect.locale,
      fromPath: redirect.fromPath,
      toPath: redirect.toPath,
      toContentId: redirect.toContentId,
      status: redirect.status,
      source: redirect.source,
      actorId,
    });
  }
}
