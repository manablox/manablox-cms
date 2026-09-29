<script setup lang="ts">
import IconButton from '@manablox/admin-sdk/components/ui/IconButton.vue';
import { useFieldContext } from '@manablox/admin-sdk/lib/field-context';
import type { JSONContent } from '@tiptap/core';
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, shallowRef, watch } from 'vue';
import type { Editor } from '~/features/content/tiptap';
import type { FieldInputProps } from '~/lib/field-input';

/** Tiptap editor emitting ProseMirror JSON; the editor code loads on mount. */
const props = defineProps<FieldInputProps>();
const emit = defineEmits<{ 'update:modelValue': [JSONContent] }>();

const context = useFieldContext();

const toolbar = computed(() => (props.settings.toolbar as string[]) ?? ['bold', 'italic', 'link']);

const EditorContent = defineAsyncComponent(() =>
  import('~/features/content/tiptap').then((module) => module.EditorContent),
);
const editor = shallowRef<Editor>();
let unmounted = false;

onMounted(async () => {
  const tiptap = await import('~/features/content/tiptap');
  if (unmounted) return;
  editor.value = new tiptap.Editor({
    content: (props.modelValue as JSONContent) ?? { type: 'doc', content: [] },
    editable: !context.value.readOnly,
    extensions: tiptap.richTextExtensions(),
    editorProps: {
      attributes: { class: 'prose prose-sm max-w-none focus:outline-none min-h-32 p-3' },
    },
    onUpdate: ({ editor: instance }) => {
      lastEmitted = instance.getJSON();
      emit('update:modelValue', lastEmitted);
    },
  });
});

/** Identity check skips the deep compare for our own echoed updates. */
let lastEmitted: JSONContent | null = null;

watch(
  () => props.modelValue,
  (next) => {
    if (!editor.value || next === lastEmitted) return;
    const current = JSON.stringify(editor.value.getJSON());
    if (current !== JSON.stringify(next)) {
      editor.value.commands.setContent((next as JSONContent) ?? { type: 'doc', content: [] }, {
        emitUpdate: false,
      });
    }
  },
);

watch(
  () => context.value.readOnly,
  (readOnly) => editor.value?.setEditable(!readOnly, false),
);

onBeforeUnmount(() => {
  unmounted = true;
  editor.value?.destroy();
});

/** Toolbar actions, keyed by the `toolbar` setting's names. */
const actions = [
  {
    key: 'bold',
    label: 'Bold',
    icon: 'bold',
    run: () => editor.value?.chain().focus().toggleBold().run(),
    active: () => editor.value?.isActive('bold'),
  },
  {
    key: 'italic',
    label: 'Italic',
    icon: 'italic',
    run: () => editor.value?.chain().focus().toggleItalic().run(),
    active: () => editor.value?.isActive('italic'),
  },
  {
    key: 'strike',
    label: 'Strikethrough',
    icon: 'strikethrough',
    run: () => editor.value?.chain().focus().toggleStrike().run(),
    active: () => editor.value?.isActive('strike'),
  },
  {
    key: 'heading',
    label: 'Heading',
    icon: 'heading-2',
    run: () => editor.value?.chain().focus().toggleHeading({ level: 2 }).run(),
    active: () => editor.value?.isActive('heading', { level: 2 }),
  },
  {
    key: 'bulletList',
    label: 'Bulleted list',
    icon: 'list',
    run: () => editor.value?.chain().focus().toggleBulletList().run(),
    active: () => editor.value?.isActive('bulletList'),
  },
  {
    key: 'orderedList',
    label: 'Numbered list',
    icon: 'list-ordered',
    run: () => editor.value?.chain().focus().toggleOrderedList().run(),
    active: () => editor.value?.isActive('orderedList'),
  },
  {
    key: 'blockquote',
    label: 'Quote',
    icon: 'quote',
    run: () => editor.value?.chain().focus().toggleBlockquote().run(),
    active: () => editor.value?.isActive('blockquote'),
  },
  {
    key: 'codeBlock',
    label: 'Code block',
    icon: 'code',
    run: () => editor.value?.chain().focus().toggleCodeBlock().run(),
    active: () => editor.value?.isActive('codeBlock'),
  },
  {
    key: 'link',
    label: 'Link',
    icon: 'link',
    run: () => setLink(),
    active: () => editor.value?.isActive('link'),
  },
  {
    key: 'alignLeft',
    label: 'Align left',
    icon: 'align-left',
    run: () => editor.value?.chain().focus().setTextAlign('left').run(),
    active: () => editor.value?.isActive({ textAlign: 'left' }),
  },
  {
    key: 'alignCenter',
    label: 'Align centre',
    icon: 'align-center',
    run: () => editor.value?.chain().focus().setTextAlign('center').run(),
    active: () => editor.value?.isActive({ textAlign: 'center' }),
  },
  {
    key: 'alignRight',
    label: 'Align right',
    icon: 'align-right',
    run: () => editor.value?.chain().focus().setTextAlign('right').run(),
    active: () => editor.value?.isActive({ textAlign: 'right' }),
  },
  {
    key: 'horizontalRule',
    label: 'Divider',
    icon: 'minus',
    run: () => editor.value?.chain().focus().setHorizontalRule().run(),
    active: () => false,
  },
  {
    key: 'code',
    label: 'Code',
    icon: 'code',
    run: () => editor.value?.chain().focus().toggleCode().run(),
    active: () => editor.value?.isActive('code'),
  },
];

function setLink() {
  const instance = editor.value;
  if (!instance) return;
  const current = instance.getAttributes('link').href as string | undefined;
  const href = window.prompt('Link address', current ?? 'https://');
  if (href === null) return;
  if (!href.trim() || href === 'https://') {
    instance.chain().focus().unsetLink().run();
    return;
  }
  instance.chain().focus().extendMarkRange('link').setLink({ href: href.trim() }).run();
}

const visibleActions = computed(() =>
  actions.filter((action) => toolbar.value.includes(action.key)),
);
</script>

<template>
  <div class="overflow-hidden rounded-control border border-surface-300 bg-surface-0 focus-within:border-brand-500 focus-within:ring-3 focus-within:ring-brand-500/20 dark:border-surface-700 dark:bg-surface-900">
    <div class="flex flex-wrap gap-0.5 border-b border-surface-200 mb-surface-inset p-1.5 dark:border-surface-800">
      <IconButton
        v-for="action in visibleActions"
        :key="action.key"
        :icon="action.icon"
        :label="action.label"
        :class="action.active() ? 'bg-surface-200 text-brand-700 dark:bg-surface-700 dark:text-brand-100' : ''"
        :aria-pressed="Boolean(action.active())"
        :disabled="context.readOnly"
        @click="action.run()"
      />
    </div>
    <EditorContent v-if="editor" :id="id" :editor="editor" />
  </div>
</template>
