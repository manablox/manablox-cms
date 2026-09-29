# `@manablox/live-preview`

Lets editors see their changes on your real website while they type in the admin.

## How it works

1. The admin opens your website's preview page inside a frame.
2. While the editor types, the admin sends the draft to the frame.
3. Your site renders the draft with its normal components.
4. Clicks on the page are sent back, so the admin jumps to the matching field. Blocks get a toolbar to move, resize, add and delete them, and text can be edited right on the page with a double click.

It works with any framework. For Nuxt, `@manablox/nuxt` does all of this for you.

## Install

```sh
npm install @manablox/live-preview
```

## Usage

```ts
import { connectPreview, fieldAttribute } from '@manablox/live-preview';

const disconnect = connectPreview({
  editorOrigin: 'https://cms.example.com', // the admin's address, required
  clickToEdit: true,
  onDocument: (document) => render(document.title, document.fields),
});
```

Mark the elements that show a field, so clicks and inline editing know which field they
belong to:

```ts
// { 'data-manablox-field': 'title' }
const attrs = fieldAttribute(['title']);
```

## `connectPreview` options

| Option | Meaning |
| --- | --- |
| `editorOrigin` | The address of the admin. Required. Messages from anywhere else are ignored |
| `onDocument(document, meta)` | Called with every new draft. Render it here |
| `onHighlight(path)` | Called when the editor focuses a field, or with `null` |
| `clickToEdit` | Clicking a marked element selects its field in the admin |
| `blockControls` | Show the block toolbar. Defaults to `clickToEdit` |
| `inlineEditing` | Allow editing text on the page. Defaults to `clickToEdit` |
| `plugins` | Names of the plugin channels this page handles, reported to the admin |
| `post(message)` | Sends a message to the admin. Defaults to the parent window |

It returns a function that disconnects the preview again. The function also has
`plugin(id)`, which opens a plugin channel (see below).

## Other functions

- `fieldAttribute(path)`, `listAttribute(path)`: the HTML attributes that mark a field or a list of blocks.
- `requestBlockMove(editorOrigin, list, from, to)`: asks the admin to move a block, for a button of your own.
- `breakpointFor(width)`: `desktop`, `tablet` or `mobile` for a screen width.
- `createEditorChannel(options)`: the admin side of the connection. The Manablox admin uses it.
- `insertionIndex(elements, x, y)`: where a dragged item would land among `elements`.

## Inline editing

A double click on a marked text field makes the element editable as plain text. A rich
text field gets a [Tiptap](https://tiptap.dev) editor on the element, with the same schema
as the admin's rich text field, so what is typed on the page is stored exactly as if it
had been typed in the admin. Undo, redo and pasting work as in any editor, and the toolbar
shows the tools the field allows.

Tiptap is loaded with a dynamic import when the first rich text edit starts, so pages
that are never edited do not download it. Your bundler needs to support dynamic imports
(Vite, Nuxt, Astro and other modern bundlers do).

The schema itself is exported for editors of your own:

```ts
import { richTextExtensions } from '@manablox/live-preview/rich-text';
```

## Plugin channels

A plugin can send its own messages between its admin screen and its preview page. Each
message belongs to one plugin (`id`) and has a `name` and a `payload`:

```ts
import { connectPreview, type PluginChannelMap } from '@manablox/live-preview';

interface Hello extends PluginChannelMap {
  toPreview: { greet: { name: string } };
  toEditor: { clicked: { id: string } };
}

const connection = connectPreview({ editorOrigin, onDocument, plugins: ['hello'] });
const hello = connection.plugin<Hello>('hello');
const off = hello.on('greet', ({ name }) => show(name));
hello.send('clicked', { id: 'button' });
```

In the admin, `createEditorChannel(options).plugin<Hello>('hello')` has the same `send` and
`on`, in the other direction:

- `send(name, payload)` before the page is ready waits, keeping only the last payload of each name.
- The page lists its channels in `plugins`; the admin drops messages for any channel not listed.
- `on(name, handler)` returns a function that stops listening.

Every message carries the connection's version, 1; a message of another version is ignored,
and so is one of a kind a side does not know.

Both sides check where every message comes from, so no other page can send drafts to your
site.
