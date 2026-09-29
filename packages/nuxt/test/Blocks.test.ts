// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createApp, defineComponent, h } from 'vue';
import Blocks from '../src/runtime/components/Blocks.vue';

const BlockTeaser = defineComponent({
  props: { headline: String },
  setup: (props) => () => h('section', { class: 'teaser' }, props.headline),
});

describe('<ManabloxBlocks>', () => {
  it('renders each block with the component named after its type', () => {
    const root = document.createElement('div');
    const app = createApp(Blocks, {
      blocks: { blocks: [{ blockId: 'b1', typeName: 'teaser', headline: 'Autumn menu' }] },
    });
    app.component('BlockTeaser', BlockTeaser);
    app.mount(root);

    const teaser = root.querySelector('section.teaser');
    expect(teaser?.textContent).toBe('Autumn menu');
    expect(teaser?.getAttribute('data-manablox-field')).toBeTruthy();
    app.unmount();
  });

  it('splits the type name like the SDK does', () => {
    const root = document.createElement('div');
    const app = createApp(Blocks, {
      blocks: { blocks: [{ blockId: 'b1', type: 'hero.banner', headline: 'Welcome' }] },
    });
    app.component('BlockHeroBanner', BlockTeaser);
    app.mount(root);

    expect(root.querySelector('section.teaser')?.textContent).toBe('Welcome');
    app.unmount();
  });
});
