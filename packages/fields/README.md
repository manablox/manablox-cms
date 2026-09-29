# `@manablox/fields`

The field types Manablox comes with. A field type decides what an editor can enter, how
it is checked, how it is stored and how it appears in the APIs.

| Type | What it holds |
| --- | --- |
| `string` | Short or long plain text |
| `richtext` | Formatted text with headings, lists, links and images |
| `number` | A number, with optional minimum and maximum |
| `boolean` | Yes or no |
| `date` | A date, or a date and time |
| `select` | One or more choices from a list you define |
| `link` | A link to a document in the space, or to an address elsewhere |
| `asset` | One or more images or files from the media library |
| `content` | A reference to other documents |
| `user` | A reference to a user |
| `block`, `blocks` | One block, or a list of blocks laid out on a grid |
| `template` | A content template to reuse |
| `repeater` | A list of items that all have the same few fields |
| `databag` | The choice of a databag type, for form blocks |

## Do I need to install it?

Usually not. `@manablox/server` installs and uses it for you. You only import it
directly when you build your own server setup or a plugin that needs it.

## Usage

```ts
// manablox.config.ts
import { defineConfig } from '@manablox/core';
import { manabloxFields } from '@manablox/fields';

export default defineConfig({
  // ...
  plugins: [manabloxFields()],
});
```

## Main exports

- `manabloxFields()`: a plugin that adds all built-in field types. Add it to `plugins` in your config.
- `builtinFieldTypes`: the list of all built-in field types.
- `stringField`, `richTextField`, `numberField`, ...: each field type on its own, for example to build a similar custom type.
