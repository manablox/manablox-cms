import { blocksOf } from '@manablox/public-sdk';
import { Blocks } from '../components/Blocks.js';
import { contentRenderers } from '../components/content/index.js';
import type { PageData } from '../lib/load.js';

/** One document: its title, its summary and its blocks. */
export function Page({
  data,
  path,
  error,
}: {
  data: PageData | null;
  path: string;
  error: unknown;
}) {
  if (error) {
    return (
      <div className="state">
        <h1>Something went wrong</h1>
        <p>{error instanceof Error ? error.message : String(error)}</p>
      </div>
    );
  }

  const page = data?.page;
  if (!page) {
    return (
      <div className="state">
        <h1>Not found</h1>
        <p>Nothing is published at {path}.</p>
        <p>
          <a href="/">Back to the start</a>
        </p>
      </div>
    );
  }

  // A content type with a component of its own renders through it; any other as the
  // generic article below.
  const Content = contentRenderers[page.type];
  if (Content) return <Content node={page} />;

  const fields = page.fields;
  const summary = typeof fields.summary === 'string' ? fields.summary : null;

  return (
    <article>
      <h1>{page.title || 'Untitled'}</h1>
      {summary && <p className="lead">{summary}</p>}
      <Blocks
        blocks={blocksOf(fields.components)}
        path={['components']}
        value={fields.components}
      />
    </article>
  );
}
