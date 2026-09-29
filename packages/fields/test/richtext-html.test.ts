import { describe, expect, it } from 'vitest';
import { richTextField } from '../src/richtext.js';
import { htmlToRichTextDoc } from '../src/richtext-html.js';

const text = (value: string, marks?: unknown[]) => ({
  type: 'text',
  text: value,
  ...(marks ? { marks } : {}),
});

describe('htmlToRichTextDoc', () => {
  it('reads paragraphs, headings and inline marks', () => {
    expect(
      htmlToRichTextDoc('<h2>Why</h2>\n<p>It is <strong>fast</strong> and <em>small</em>.</p>'),
    ).toEqual({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [text('Why')] },
        {
          type: 'paragraph',
          content: [
            text('It is '),
            text('fast', [{ type: 'bold' }]),
            text(' and '),
            text('small', [{ type: 'italic' }]),
            text('.'),
          ],
        },
      ],
    });
  });

  it('puts list item text in a paragraph, as the editor does', () => {
    expect(htmlToRichTextDoc('<ul>\n  <li>One</li>\n  <li><p>Two</p></li>\n</ul>')).toEqual({
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [text('One')] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [text('Two')] }] },
          ],
        },
      ],
    });
  });

  it('keeps safe links and drops unsafe ones, keeping their text', () => {
    const doc = htmlToRichTextDoc(
      '<p><a href="https://example.com" target="_blank">Site</a> <a href="javascript:alert(1)">bad</a></p>',
    );
    const [link, , unsafe] = doc.content?.[0]?.content ?? [];
    expect(link?.marks?.[0]).toMatchObject({
      type: 'link',
      attrs: { href: 'https://example.com', target: '_blank' },
    });
    expect(unsafe).toEqual(text('bad'));
  });

  it('wraps bare inline content, reads breaks, rules and entities', () => {
    expect(htmlToRichTextDoc('Tom &amp; Jerry<br>again<hr><blockquote>Quote</blockquote>')).toEqual(
      {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [text('Tom & Jerry'), { type: 'hardBreak' }, text('again')],
          },
          { type: 'horizontalRule' },
          { type: 'blockquote', content: [{ type: 'paragraph', content: [text('Quote')] }] },
        ],
      },
    );
  });

  it('keeps code blocks verbatim and drops scripts', () => {
    const doc = htmlToRichTextDoc('<pre><code>a  =  1\nb</code></pre><script>evil()</script>');
    expect(doc.content).toEqual([
      { type: 'codeBlock', attrs: { language: null }, content: [text('a  =  1\nb')] },
    ]);
  });

  it('reads a string without tags as prose', () => {
    expect(htmlToRichTextDoc('First line\nsame paragraph\n\nSecond')).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [text('First line'), { type: 'hardBreak' }, text('same paragraph')],
        },
        { type: 'paragraph', content: [text('Second')] },
      ],
    });
  });

  it('lets the rich text field take HTML as its value', async () => {
    const schema = richTextField.valueSchema({} as never, {} as never);
    const result = await schema['~standard'].validate('<p>Hello</p>');
    expect('value' in result && result.value).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [text('Hello')] }],
    });
  });
});
