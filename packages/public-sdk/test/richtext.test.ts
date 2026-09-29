import { describe, expect, it } from 'vitest';
import { isRichTextEmpty, richTextToHtml, richTextToText } from '../src/richtext.js';

describe('richTextToHtml', () => {
  const doc = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Hello' }] },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Some ' },
          { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
          { type: 'text', text: ' and ' },
          { type: 'text', text: 'both', marks: [{ type: 'bold' }, { type: 'italic' }] },
        ],
      },
    ],
  };

  it('keeps marks', () => {
    expect(richTextToHtml(doc)).toBe(
      '<h2>Hello</h2><p>Some <strong>bold</strong> and <em><strong>both</strong></em></p>',
    );
  });

  it('renders the block types the toolbar offers', () => {
    const html = richTextToHtml({
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }],
            },
          ],
        },
        {
          type: 'orderedList',
          attrs: { start: 3 },
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'b' }] }],
            },
          ],
        },
        {
          type: 'blockquote',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'q' }] }],
        },
        {
          type: 'codeBlock',
          attrs: { language: 'ts' },
          content: [{ type: 'text', text: 'x < y' }],
        },
        { type: 'horizontalRule' },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'l1' },
            { type: 'hardBreak' },
            { type: 'text', text: 'l2' },
          ],
        },
      ],
    });
    expect(html).toBe(
      '<ul><li><p>a</p></li></ul>' +
        '<ol start="3"><li><p>b</p></li></ol>' +
        '<blockquote><p>q</p></blockquote>' +
        '<pre><code class="language-ts">x &lt; y</code></pre>' +
        '<hr>' +
        '<p>l1<br>l2</p>',
    );
  });

  it('escapes text so content cannot inject markup', () => {
    const html = richTextToHtml({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '<script>alert("x")</script>' }] },
      ],
    });
    expect(html).toBe('<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</p>');
  });

  it('keeps safe links and drops unsafe ones', () => {
    const link = (href: string, extra: Record<string, unknown> = {}) =>
      richTextToHtml({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'go', marks: [{ type: 'link', attrs: { href, ...extra } }] },
            ],
          },
        ],
      });

    expect(link('https://example.com/?a=1&b=2')).toBe(
      '<p><a href="https://example.com/?a=1&amp;b=2">go</a></p>',
    );
    expect(link('/about')).toBe('<p><a href="/about">go</a></p>');
    expect(link('mailto:hi@example.com')).toBe('<p><a href="mailto:hi@example.com">go</a></p>');
    expect(link('https://example.com', { target: '_blank' })).toBe(
      '<p><a href="https://example.com" target="_blank" rel="noopener">go</a></p>',
    );
    expect(link('javascript:alert(1)')).toBe('<p>go</p>');
    expect(link('data:text/html,hi')).toBe('<p>go</p>');
  });

  it('keeps the alignment of a paragraph or heading', () => {
    const html = richTextToHtml({
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2, textAlign: 'center' },
          content: [{ type: 'text', text: 'Hi' }],
        },
        { type: 'paragraph', attrs: { textAlign: 'left' }, content: [{ type: 'text', text: 'a' }] },
        {
          type: 'paragraph',
          attrs: { textAlign: 'right' },
          content: [{ type: 'text', text: 'b' }],
        },
      ],
    });
    expect(html).toBe(
      '<h2 style="text-align: center">Hi</h2><p>a</p><p style="text-align: right">b</p>',
    );
  });

  it('renders an unknown node as its text rather than nothing', () => {
    const html = richTextToHtml({
      type: 'doc',
      content: [
        {
          type: 'callout',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }],
        },
      ],
    });
    expect(html).toBe('<p>hi</p>');
  });

  it('renders anything that is not a document as an empty string', () => {
    expect(richTextToHtml(null)).toBe('');
    expect(richTextToHtml(undefined)).toBe('');
    expect(richTextToHtml('text')).toBe('');
    expect(richTextToHtml({})).toBe('');
  });
});

describe('richTextToText', () => {
  it('flattens to text', () => {
    expect(
      richTextToText({
        type: 'doc',
        content: [
          { type: 'heading', content: [{ type: 'text', text: 'Hello' }] },
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'a' },
              { type: 'text', text: 'b', marks: [{ type: 'bold' }] },
            ],
          },
        ],
      }),
    ).toBe('Hello a b');
  });

  it('tells an empty document apart from one with text', () => {
    expect(isRichTextEmpty({ type: 'doc', content: [] })).toBe(true);
    expect(isRichTextEmpty({ type: 'doc', content: [{ type: 'paragraph' }] })).toBe(true);
    expect(
      isRichTextEmpty({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }],
      }),
    ).toBe(false);
    expect(isRichTextEmpty(null)).toBe(true);
  });
});
