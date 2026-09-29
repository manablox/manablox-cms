import { describe, expect, it } from 'vitest';
import { useDerivedName } from '~/composables/useDerivedName';

/** A trailing hyphen is kept while focused and trimmed on blur. */
function field(initial = '') {
  let value = initial;
  return {
    get: () => value,
    derived: (options: Partial<Parameters<typeof useDerivedName>[0]> = {}) =>
      useDerivedName({
        read: () => value,
        write: (next) => {
          value = next;
        },
        ...options,
      }),
  };
}

describe('a technical name derived from a label', () => {
  it('follows the label until the name is typed into', () => {
    const target = field();
    const derived = target.derived({});

    derived.onLabelInput('Blog Post');
    expect(target.get()).toBe('blog-post');

    derived.onNameInput('article');
    expect(target.get()).toBe('article');
    expect(derived.touched.value).toBe(true);

    // The name stops following the label.
    derived.onLabelInput('News Item');
    expect(target.get()).toBe('article');
  });

  it('keeps a trailing hyphen while the field has focus and drops it on blur', () => {
    const target = field();
    const derived = target.derived({});

    derived.onLabelInput('Blog ');
    expect(target.get()).toBe('blog-');

    derived.onNameBlur();
    expect(target.get()).toBe('blog');
  });

  it('starts detached for a row whose name is already its identity', () => {
    const target = field('existing');
    const derived = target.derived({ detached: true });

    derived.onLabelInput('Something Else');
    expect(target.get()).toBe('existing');

    // Reused for a new row, it attaches again.
    derived.reset();
    derived.onLabelInput('Something Else');
    expect(target.get()).toBe('something-else');
  });

  it("takes a caller's own rule, and hands it whether the name was typed into", () => {
    const target = field();
    let saved = false;
    const derived = target.derived({ follows: (touched: boolean) => !touched && !saved });

    derived.onLabelInput('Draft Title');
    expect(target.get()).toBe('draft-title');

    saved = true;
    derived.onLabelInput('Renamed');
    expect(target.get()).toBe('draft-title');
    expect(derived.follows()).toBe(false);
  });
});
