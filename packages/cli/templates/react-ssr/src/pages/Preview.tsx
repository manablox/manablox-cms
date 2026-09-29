import { connectPreview, fieldAttribute, type PreviewDocument } from '@manablox/live-preview';
import { blocksOf, normaliseFields } from '@manablox/public-sdk';
import { useEffect, useState } from 'react';
import { Blocks } from '../components/Blocks.js';
import { contentRenderers } from '../components/content/index.js';

/**
 * The visual editor's canvas. It renders in the browser only, because the document
 * arrives over the channel after the page has loaded, and needs no API key: nothing here
 * fetches a draft.
 */
export function Preview({ editorOrigin }: { editorOrigin: string }) {
  const [document, setDocument] = useState<PreviewDocument | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);

  useEffect(() => {
    // The origin check is not optional: without it any page could drive the preview.
    return connectPreview({
      editorOrigin,
      clickToEdit: true,
      onDocument: setDocument,
      onHighlight: (path) => setHighlighted(path ? path.join('.') : null),
    });
  }, [editorOrigin]);

  if (!document) return <p className="state">Waiting for the editor...</p>;

  // The editor sends fields in storage shape; normalising them gives the shape the SDK
  // returns, so the same <Blocks> and <Teaser> render the preview and the live page.
  const fields = normaliseFields(document.fields);
  const summary = typeof fields.summary === 'string' ? fields.summary : null;
  const Content = contentRenderers[document.typeName];

  if (Content) {
    return (
      <div data-manablox-highlight={highlighted ?? ''}>
        <Content node={{ title: document.title, fields }} />
      </div>
    );
  }

  return (
    <div data-manablox-highlight={highlighted ?? ''}>
      <article>
        <h1 {...fieldAttribute(['title'])}>{document.title || 'Untitled'}</h1>
        {summary && (
          <p className="lead" {...fieldAttribute(['summary'])}>
            {summary}
          </p>
        )}
        <Blocks
          blocks={blocksOf(fields.components)}
          path={['components']}
          value={fields.components}
        />
      </article>
    </div>
  );
}
