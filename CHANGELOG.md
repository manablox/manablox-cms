# Changelog

All `@manablox/*` packages of this repository share one version number and are released
together.

## 0.50.0 - 2026-09-30

Manablox is a headless CMS: you write and organise your content in a web admin, and your website or app fetches it over an API. It is free and open source (MIT), and it runs on your own server or with a hosting provider.

### Getting started

- **One command to a new project.** `manablox create` asks a few questions and writes a complete project that runs right away, with Docker or on your own machine, and optional HTTPS through Caddy.
- **Pick your features.** Choose workflows, webhooks, AI or the website designer when you create a project, and add or remove them later with `manablox plugin install` and `manablox plugin uninstall`.
- **A head start for new spaces.** A new space can start from a template (business, landing page, portfolio, blog) or completely empty.
- **A starter website.** `manablox frontend` writes a small website in Astro, React or Vue, or without a framework, that already shows your pages and supports live preview.
- **Handy commands.** Create accounts and spaces, update the database and back up an SQLite database, all from the terminal.

### Building your content model

- **Content types.** Describe what your content looks like, like a blog post with a title, a picture and a text. Build types by clicking in the admin or write them in code.
- **Fifteen field types.** Text, rich text, numbers, yes/no, dates, choices, links, images and files, references to other content or users, blocks, repeating groups and more.
- **Blocks and layouts.** Build pages from reusable blocks and arrange them in a grid, with separate layouts for desktop, tablet and phone.
- **Templates.** Save a set of blocks once and reuse it on many pages.
- **Automatic lists.** A field can fill itself, for example with "the three newest blog posts".
- **Pages in a tree.** Organise pages in folders. Their web addresses follow from the tree, and one page is the home page.
- **Databags.** Simple lists outside the page tree, for things like contact form entries or team members.

### Writing and publishing

- **Drafts and publishing.** Saving keeps a draft. Your website only changes when you press Publish.
- **Scheduled publishing.** Set a date and time for a page to go live or to be taken down.
- **Version history.** Every save is kept, and you can go back to any earlier version.
- **Approvals.** Authors can ask for a review. A reviewer publishes the page or sends it back with a note.
- **No lost work.** If a colleague saved the same page in the meantime, Manablox tells you instead of silently overwriting their changes.
- **Several languages.** Translate your content per language, and choose which fields are translated and which stay the same everywhere.
- **Live preview.** See your changes on the real website while you type.

### Images and files

- **Media library.** Upload images and files, give them names and alt texts, and tag them.
- **Image editing.** Crop, rotate, mirror, set a focal point and adjust colours. The original file stays untouched.
- **Right sizes automatically.** Manablox makes smaller versions of your images when they are needed and keeps them for next time.
- **Storage.** Keep files on the server's disk or in S3-compatible cloud storage.

### Getting content to your website

- **REST and GraphQL.** Two ways for your website to read content. Both show only published content.
- **SDK for JavaScript.** `@manablox/public-sdk` reads pages, menus, lists and images for you, and can create TypeScript types from your content model.
- **Nuxt module.** `@manablox/nuxt` connects a Nuxt website in a few lines, live preview included.
- **Fast answers.** Answers are cached, and publishing refreshes exactly the pages that changed.
- **One API for many spaces.** Every space can have its own API address.
- **Menus, tags and redirects.** Edit your site's menus in the admin, tag your content, and keep old links working: moving a page creates a redirect by itself.

### Teams and security

- **Invitations.** Invite people by email and give them a role: owner, admin, editor, author or viewer. You can also create your own roles.
- **Two-factor sign-in.** Protect accounts with a code from an authenticator app, with backup codes. You can make it required.
- **Single sign-on.** Let your team sign in with your company account over OpenID Connect or SAML.
- **API keys.** Give other programs access to chosen spaces only, and revoke a key at any time.
- **Activity log.** See who changed what and when. The log is protected against tampering.
- **Notifications.** Get told about approvals and other events in the admin, by email or as a browser notification.

### Spaces, staging and backups

- **Spaces.** Run several websites or projects from one installation, each with its own content, languages and team.
- **Staging.** Copy a space, try out changes there, see what would change and move them over in one step.
- **Snapshots.** Back up a space by hand or every day, and restore it next to the original or in its place.
- **Export and import.** Move a space, or parts of it, to another installation as a single file.

### Automation

- **Workflows.** Automate tasks on a drag-and-drop canvas: when a page is published, on a timetable or when another service calls in, Manablox can send emails, call other services, create content and more.
- **Webhooks.** Tell other services when content changes, and see a log of every call.

### The admin

- **A clear dashboard.** Your numbers, what waits for your approval, and your latest edits at a glance.
- **Keyboard shortcuts.** Press `?` to see them all, for example `/` to search and `Ctrl+S` to save.
- **Light and dark.** Pick your theme. The admin also works on small screens.

### For hosting providers

- **Plans for your customers.** Switch features on or off and set limits, like the number of spaces, users, documents or the storage size, for the whole installation or per customer.
- **Usage you can bill.** API requests, bandwidth, workflow runs, emails and uploads are counted per space and month, with a warning when a limit is near.
- **Remote control.** A control API lets your hosting panel or billing system manage installations, show messages in the admin, and make an installation read-only or pause it.

### Running Manablox

- **Postgres or SQLite.** Start small with SQLite and move to Postgres later with `manablox migrate-db`, history included.
- **Email your way.** Send email through SMTP, Gmail, Microsoft, Resend, SendGrid, Postmark or Mailgun.
- **Logs.** Readable logs while developing, JSON logs or a log service in production.
- **Safe database access.** On Postgres, Manablox can run with an account that is not allowed to change the tables or rewrite the activity log.

### Extending Manablox

- **Plugins.** Add your own field types, workflow steps, admin screens, database tables, permissions and commands. Workflows and webhooks are built as plugins too.
- **Hooks.** Run your own code when something happens, for example before a page is published.
- **Testing helpers.** Ready-made test databases, a test license and a mocked admin make plugin tests quick to write.
- **Reference docs.** `manablox docs generate` writes the API, error and hook reference for your installation, plugins included.

### Premium plugins

- **AI and the website designer.** Two optional plugins, installed like any other. Try them for free on your own computer. A live website needs a subscription.
