import { describe, expect, it } from 'vitest';
import { placeholders, render, renderJson, resolvePath } from '../src/server/template.js';

const context = {
  event: 'content.updated',
  content: { title: 'Hello', fields: { tags: ['a', 'b'], count: 3, meta: { ok: true } } },
  actor: null,
  documents: [{ title: 'One' }, { title: 'Two' }],
};

describe('render', () => {
  it('substitutes paths, with objects as JSON and gaps as empty', () => {
    expect(render('{{ content.title }}!', context)).toBe('Hello!');
    expect(render('{{content.fields.count}}', context)).toBe('3');
    expect(render('{{ content.fields.tags }}', context)).toBe('["a","b"]');
    expect(render('{{ content.fields.tags[1] }}', context)).toBe('b');
    expect(render('{{ actor.email }}', context)).toBe('');
    expect(render('{{ nothing.here }}', context)).toBe('');
    expect(render('{{ documents.length }}', context)).toBe('2');
  });

  it('lists placeholders', () => {
    expect(placeholders('{{ a.b }} and {{c}}')).toEqual(['a.b', 'c']);
  });

  it('resolves array indices', () => {
    expect(resolvePath(context, 'documents.0.title')).toBe('One');
  });
});

describe('renderJson', () => {
  it('keeps types for a placeholder that stands alone', () => {
    const out = JSON.parse(
      renderJson(
        '{"title":"{{ content.title }}","n":"{{ content.fields.count }}","tags":"{{ content.fields.tags }}","text":"n={{ content.fields.count }}","missing":"{{ nope }}"}',
        context,
      ),
    );
    expect(out).toEqual({ title: 'Hello', n: 3, tags: ['a', 'b'], text: 'n=3', missing: null });
  });
});
