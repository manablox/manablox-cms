# `@manablox/admin`

The Manablox admin: the web app where people work with the CMS.

- **Editors** write and publish documents, arrange blocks on a grid, upload images, see a live preview of the website, and use AI to write text or create images.
- **Designers** shape a whole website on a live canvas in **Design**, when the website plugin (`@manablox/plugin-website`) is installed; a project made with `manablox create` has it.
- **Developers** set up spaces, content types, block types, templates, menus, roles, API keys, webhooks and workflows.

It is a Vue 3 single-page app. This package contains the finished build, so you do not
need Vue or Vite to use it.

## Usage

`@manablox/server` serves the admin when you set `server.admin` in your config:

```ts
// manablox.config.ts
export default defineConfig({
  // ...
  server: { admin: true },
});
```

Open the address of your CMS in the browser. The first account you create becomes the
superadmin.

## Adding your own screens

To add pages, menu entries, field editors or panels in the admin's slots, write an admin plugin with
`@manablox/admin-plugin` and `@manablox/admin-sdk`, build it into its own bundle and name
that folder in your server plugin's `admin: { dir }`. This admin loads the bundle when it
starts; it is never rebuilt for a plugin.
