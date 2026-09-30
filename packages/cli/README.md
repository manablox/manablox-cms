# `@manablox/cli`

The `manablox` command. You use it to create a new Manablox CMS, to create a starter
website for it, to update the database and to start the server.

## Install

You do not need to install anything to create a new project:

```sh
npx @manablox/cli create my-cms
# or: pnpm dlx @manablox/cli create my-cms
```

A new project gets the features you pick, none by default: designed websites
(`@manablox/plugin-website`), AI assistance (`@manablox/plugin-ai`), workflows
(`@manablox/plugin-workflows`) and webhooks (`@manablox/plugin-webhooks`). The CLI needs a
picked plugin while it creates the project. They are not dependencies of the CLI: when one
is not installed next to it, `create` installs the picked ones with npm, in one run, into
`~/.cache/manablox/plugins/cli-<version>/` (or under `XDG_CACHE_HOME`). If that fails, for
example without network access, the command stops and prints what to run instead:

```sh
pnpm dlx --package @manablox/cli --package @manablox/plugin-website manablox create my-cms
npx -p @manablox/cli -p @manablox/plugin-website manablox create my-cms
```

A plugin you do not pick is never needed.

A project created this way already lists `@manablox/cli` as a dependency, so inside the
project you run the command as `pnpm exec manablox ...` or through the scripts in its
`package.json` (`pnpm dev`, `pnpm migrate`, `pnpm push-keys`, ...).

## Commands at a glance

| Command | What it does |
| --- | --- |
| `manablox create [dir]` | Creates a new CMS project in a folder |
| `manablox plugin <command>` | Lists, installs, uninstalls, enables and disables the plugins of a project |
| `manablox frontend [dir]` | Creates a starter website that shows the content of a space |
| `manablox migrate` | Updates the database tables to the latest version |
| `manablox backup <file>` | Copies a SQLite database into a file while the CMS runs |
| `manablox migrate-db --to <url>` | Moves a SQLite database into a Postgres database |
| `manablox sync` | Saves the things your config declares (workflows, webhooks, templates, credentials) into the database |
| `manablox user create` | Creates an account, for example the first administrator |
| `manablox space create` | Creates a space, with starter content and a designed site if you like |
| `manablox <plugin> ...` | Commands a plugin adds, such as `manablox website ...` of the website plugin (see below) |
| `manablox license ...` | License keys of the premium plugins: buy, add, status (see below) |
| `manablox start` | Starts the CMS server |
| `manablox push-keys` | Prints a key pair for web push notifications |
| `manablox docs generate --out <dir>` | Writes the reference pages derived from the code (errors, HTTP API, hooks) |
| `manablox --help` | Prints the help text |

## Options every command understands

| Option | Meaning |
| --- | --- |
| `-h`, `--help` | Print the help text and exit |
| `--name=value` | Every option with a value can also be written with `=` |

An unknown option stops the command with an error, so a typo never goes unnoticed.

## `manablox start`

Starts the CMS: the APIs, the admin (if `server.admin` is set in your config), uploads and
background jobs.

```sh
manablox start
manablox start --watch                 # restart on every change, for development
manablox start --mode public --port 3100
manablox start --config manablox.site.config.ts
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--config <file>` | `manablox.config.ts` | The config file to load |
| `--mode <mode>` | `management` | `management` runs the admin and the full API. `public` runs the read-only API for your website. A plugin can add its own mode: `website` (the website plugin) renders the spaces you designed in the admin as websites, by domain. Overrides `server.mode` |
| `--port <port>` | from the config | The port to listen on. Overrides `server.port` |
| `--host <host>` | from the config | The address to listen on, e.g. `0.0.0.0`. Overrides `server.host` |
| `--watch` | off | Restart the server when the config or any file it imports changes |

## `manablox migrate`

Creates or updates the database tables. Run it once after installing and after every
update of the `@manablox/*` packages.

```sh
manablox migrate
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--config <file>` | `manablox.config.ts` | The config file that holds the database address |

On Postgres you can keep two database accounts apart: set `MIGRATION_DATABASE_URL` to the
account that owns the tables, and `DATABASE_URL` to the account the CMS uses. `migrate`
then works through the owner account and gives the CMS account exactly the rights it
needs, so the CMS cannot change tables or delete audit entries.

## `manablox backup <file>`

Writes a consistent copy of the database into a new file, while the CMS keeps running.
It works for SQLite only; for Postgres it stops with an error, use `pg_dump` there. It
never overwrites a file: if the file exists, it stops. Missing folders are created.

```sh
manablox backup backups/cms-2026-01-31.db
```

To restore, stop the CMS, replace the database file with the copy (and delete the
`-wal` and `-shm` files next to it), then start the CMS again.

| Option | Default | Meaning |
| --- | --- | --- |
| `--config <file>` | `manablox.config.ts` | The config file that holds the database address |

## `manablox migrate-db --to <url>`

Moves everything from the SQLite database of your config into a Postgres database, for
when the CMS outgrows one file. It creates the tables in Postgres, copies every row, then
checks the copy: the number of rows in each table, the audit log's chain, and a random
sample of rows field by field. It prints the setting to change afterwards.

```sh
manablox migrate-db --to postgres://manablox:secret@db.example.com:5432/manablox
```

Before you run it, make the CMS read-only (the control API's `PUT /control/v1/instance/state`
with `{"status":"readOnly"}`) or stop it. The command stops with an error while the CMS
is in its normal state, so no edit gets lost. The Postgres database must be empty.

| Option | Default | Meaning |
| --- | --- | --- |
| `--to <url>` | none, required | The Postgres database to fill |
| `--replace` | off | Delete everything in the Postgres database first, when it is not empty |
| `--force-offline` | off | Skip the read-only check, because you stopped the CMS yourself |
| `--app-role <role>` | the accounts that had rights before | The database account the CMS will use, when `--to` is the owner account; it gets the same rights `migrate` gives it |
| `--config <file>` | `manablox.config.ts` | The config file that holds the SQLite address |

If the copy fails halfway, Postgres keeps the empty tables and you can run the command
again. If the check finds a difference, the command lists it and exits with code `2`.

## `manablox sync`

Your config (and its plugins) can declare workflows, webhooks, content templates and
credential slots in code (workflows and webhooks with the workflows and webhooks plugins). `sync` writes them into the database, so they show up in the
admin. It prints one line per change.

```sh
manablox sync
manablox sync --dry-run          # only show what would change
manablox sync --space blog       # only the space "blog"
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--config <file>` | `manablox.config.ts` | The config file to load |
| `--space <name>` | all spaces | Only sync this space, by its machine name |
| `--dry-run` | off | Show what would change and write nothing. Exits with code 2 if anything would change, so a deploy script can stop |
| `--prune` | off | Delete things that are no longer declared. Without it they are only switched off |

## `manablox push-keys`

Prints a new VAPID key pair. Put the two keys into `PUSH_VAPID_PUBLIC_KEY` and
`PUSH_VAPID_PRIVATE_KEY` in your `.env` to allow web push notifications in workflows.
Create them once and keep them: changing them later breaks existing subscriptions.

```sh
manablox push-keys
```

This command has no options.

## `manablox docs generate --out <dir>`

Writes the reference pages that are derived from the code into a folder, as Markdown with
frontmatter:

- `reference/errors.md`: every error key of the core and of the config's plugins
- `reference/http-api.md`: every management and delivery endpoint, and every plugin procedure
- `extending/hooks.md`: every hook, its payload and context

It loads the config (`--config`, else `manablox.config.ts`) to find the plugins, including
premium plugins you installed, but does not boot the instance: no database is needed. The
developer documentation runs it against an instance with every plugin installed.

```sh
manablox docs generate --out docs
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--out <dir>` | required | The folder to write into; existing pages are replaced |
| `--config <file>` | `manablox.config.ts` | The instance config whose plugins the pages list |

## `manablox user create`

Creates an account that signs in to the admin with email and password. Run it after
`manablox migrate`. The first account is always a superadmin (it may do everything, in
every space) and becomes the owner of every space that exists already. Once an account
exists, the admin shows its sign-in page instead of the setup assistant.

The password is never an option, so it cannot end up in your shell history. The command
reads it from the `MANABLOX_USER_PASSWORD` environment variable, or asks for it twice in
the terminal. It needs at least 12 characters. If an account with the email exists
already, the command does nothing and still succeeds.

```sh
manablox user create --email you@example.com --name "Your Name"
MANABLOX_USER_PASSWORD='a long secret password' manablox user create --email ci@example.com
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--email <email>` | required | The email to sign in with |
| `--name <name>` | `Administrator` | The name shown in the admin |
| `--role <role>` | `superadmin` | `superadmin` or `editor`. The first account is a superadmin either way |
| `--config <file>` | see below | The config file to read |

## `manablox space create`

Creates a space in the database your config points at, the same way the admin does. Run
it after `manablox migrate`. With `--owner` that account owns it; without, the first
account you create becomes the owner of every space. If a space with the same technical
name exists already, the command does nothing and still succeeds, so a setup script can
run it again.

```sh
manablox space create --name "My site"
manablox space create --name "Acme Blog" --template blog --website designed --theme editorial --design journal
manablox space create --name Docs --locales en,de --url https://docs.example.com
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--name <name>` | required | The name of the space |
| `--machine-name <name>` | made from the name | The technical name: a lowercase letter first, then letters, digits, `-` or `_`. The public API and GraphQL use it |
| `--url <url>` | `http://localhost:3200` | The address of the website |
| `--locales <list>` | `en` | The languages, comma separated. The first one is the default language |
| `--template <id>` | none | Fill the space as a website type: `business` (company website with services, a team, testimonials, questions and a contact form), `landing` (product or landing page with features, numbers, pricing and questions), `portfolio` (projects, a project grid, a gallery and a contact form), `blog` (posts, pages and a blogroll), `basic` (Page and Article types with a Teaser block) or `custom` (the sections from `--blocks`). Every type adds published example pages and a main menu |
| `--blocks <list>` | `hero,text,media-text,gallery,quote,call-to-action` | The sections of the `custom` type, comma separated, and implies it: `hero`, `text`, `media-text`, `image`, `gallery`, `quote`, `features`, `stats`, `faq`, `pricing`, `testimonials`, `team`, `contact`, `call-to-action`. The site designs have a design for each |
| `--starter`, `--no-starter` | `--no-starter` | The same as `--template basic`, or an empty space |
| `--plan <file>` | none | A JSON file with content types to add after the template: `{ "types": [...] }`, types that reference each other by name, as `contentTypes.applyPlan` takes them. The file is checked before anything is written; a type that fails stops the create, and no space is made |
| `--owner <email>` | none | The account that owns the space. It must exist |
| `--plugin-data <id>=<json>` | none | Data for a plugin that takes part in creating spaces: the plugin's id, `=`, then its data as JSON, for example `--plugin-data 'hello={"greeting":"Hi"}'`. Give it once per plugin. The plugin checks the data and writes its part together with the space; an unknown plugin, a plugin that is switched off or data it refuses stops the create, and no space is made. A plugin's own options (such as `--website designed`) and `--plugin-data` for the same plugin cannot be combined |
| `--config <file>` | see below | The config file to read |

Plugins in your config can add their own options here; `manablox --help` lists them per
plugin. The website plugin (in projects with designed websites) adds these:

| Option | Default | Meaning |
| --- | --- | --- |
| `--website <kind>` | `external` | `designed`: apply the theme from `--theme`, switch the space to a designed site and use the host of `--url` as its domain. `external`: you build the website yourself on the public API |
| `--theme <id>` | `neutral` | With `--website designed`. Professional: `neutral`, `corporate`, `minimal`, `practice`. Creative: `bold`, `studio`, `playful`, `noir`. Personal: `editorial`, `journal`, `blossom`, `terminal` |
| `--design <id>` | the theme group's first | With `--website designed`: a complete site design (layout, menus, sections and page layouts), published at once. Any design works with any theme. Professional: `atlas`, `harbor`, `ledger`, `summit`. Creative: `spotlight`, `gallery`, `poster`, `stage`. Personal: `journal`, `sunny`, `readme`, `postcard`. `none` keeps only the theme |

## `manablox create [dir]`

Creates a complete, runnable CMS project: config files, a `.env` file with fresh random
secrets, and a Docker Compose setup. Every option you leave out is asked for in the
terminal. With `--yes`, or when there is no terminal (for example in CI), the defaults
are used.

```sh
manablox create my-cms
manablox create my-cms --yes
manablox create my-cms --preset docker --proxy caddy --admin-domain cms.example.com --public-domain api.example.com
```

There are two presets:

- `local` (the default): Docker only runs Postgres and Valkey, and the CMS runs on your computer with `pnpm dev`. Good for trying Manablox and for development.
- `docker`: everything runs in containers. You get a Dockerfile, a compose file with Postgres, Valkey, the CMS, the public API (and with designed websites the site process) and a web server in front, plus backup scripts. Good for a server. With Caddy, every domain you add to a designed space gets its HTTPS certificate on the first visit.

Then the features, asked in one list with nothing ticked, or given with `--features`:

| Feature | Id | What it adds |
| --- | --- | --- |
| Designed websites | `website` | The visual designer in the admin and the site process that serves the spaces you design as websites |
| AI assistance | `ai` | Text, image and model generation with your own provider keys |
| Workflows | `workflows` | Automations started by content changes, schedules and incoming webhooks |
| Webhooks | `webhooks` | Calls to other systems when content changes, and endpoints they call |

Without any, the project is the core CMS. The feature plugins are listed in the generated
`manablox.plugins.ts`; each one's parts of the project files sit between
`manablox:plugin <id> >>>` and `<<<` comments, so `manablox plugin` can add and remove
them later.

And two databases:

- `postgres` (the default): a Postgres server, run by Docker in both presets. The CMS uses two database users, created when Postgres starts for the first time: an owner that runs `migrate`, and an app user the CMS logs in as, which cannot change tables or delete audit entries. `.env` gets a generated password for each. The public API and the site process connect with their own read-only database user.
- `sqlite`: the whole database is one file (`data/manablox.db`, or the `database` volume in the docker preset), so no database server runs at all. SQLite allows one writer, so run only one management instance. The backup scripts use `manablox backup`.

| Option | Default | Meaning |
| --- | --- | --- |
| `[dir]`, `--dir <dir>` | asked, else `my-cms` | The folder to create the project in |
| `--name <name>` | the folder name | The package name and the Docker Compose project name |
| `--preset <preset>` | `local` | `local` or `docker`, see above |
| `--proxy <proxy>` | `caddy` | Docker preset only; giving it without `--preset` picks `docker`. `caddy`: web server with automatic HTTPS certificates. `nginx`: web server that uses your own certificates. `none`: no web server, the ports are published for one you run yourself |
| `--database <database>` | `postgres` | `postgres` or `sqlite`, see above |
| `--public`, `--no-public` | `--public` | Add (or leave out) the separate, read-only public API for your website |
| `--features <list>` | asked, else none | The features, exactly these, comma separated: `website`, `ai`, `workflows`, `webhooks`, or `none`. Not together with the switches below |
| `--website`, `--ai`, `--workflows`, `--webhooks` (and `--no-...`) | not picked | Pick (or leave out) one feature at a time |
| `--admin-domain <host>` | `cms.example.com` | Caddy and nginx: the domain of the admin and the management API |
| `--public-domain <host>` | `content.example.com` | Caddy and nginx: the domain of the public API |
| `--acme-email <email>` | `ops@example.com` | Caddy: the email address for certificate notices |
| `--admin-port <port>` | `3000` | Without a web server: the port of the admin and the management API |
| `--public-port <port>` | `3100` | Without a web server: the port of the public API |
| `--postgres-port <port>` | `5432` | Local preset with Postgres: the port Postgres is reachable on |
| `--valkey-port <port>` | `6379` | Local preset: the port Valkey is reachable on |
| `--storage <driver>` | `local` | Where uploaded files are saved: `local` (a folder) or `s3` (an S3-compatible bucket; the keys go into `.env`) |
| `--mail <driver>` | `mailpit` (local), `none` (docker) | How emails are sent: `smtp`, `mailpit`, `gmail`, `microsoft`, `resend`, `sendgrid`, `postmark`, `mailgun` or `none` |
| `--admin`, `--no-admin` | `--admin` | Create the first account, a superadmin. With `--start` it is created right after the database is ready; otherwise the next steps show the `manablox user create` command to run |
| `--admin-email <email>` | `admin@example.com` | The email of the first account. Giving `--admin-email` or `--admin-name` means `--admin` |
| `--admin-name <name>` | `Administrator` | Its name. With `--start` the password is asked in the terminal, read from `MANABLOX_USER_PASSWORD`, or, without either, generated and shown once at the end. It is never written to a file |
| `--space`, `--no-space` | `--space` | Create a first space. With `--start` it is created right after the database is ready; otherwise the next steps show the `manablox space create` command to run |
| `--space-name <name>` | `My site` | The name of the first space. Giving any `--space-...` option means `--space`. With `--admin` the administrator owns it |
| `--space-url <url>` | the site process, or `http://localhost:3005` | The address of the website. A designed site answers on its host. Behind Caddy or nginx the default is `https://www.example.com` |
| `--space-locales <list>` | `en` | The languages of the first space, comma separated. The first one is the default |
| `--space-template <id>` | `basic` | The first space's website type: `business`, `landing`, `portfolio`, `blog`, `basic` or `custom` |
| `--space-blocks <list>` | none | The sections of the `custom` type, as `--blocks` of `manablox space create` |
| `--space-starter`, `--no-space-starter` | `--space-starter` | The basic template, or an empty space |
| `--manablox-version <range>` | this CLI's version | The version range of the `@manablox/*` packages to install |
| `--install`, `--no-install` | `--install` | Run `pnpm install` after writing the files |
| `--git`, `--no-git` | `--git` | Run `git init` after writing the files |
| `--start`, `--no-start` | `--no-start` | Start the project right away. Docker builds and starts all containers; local starts Postgres (not with SQLite) and Valkey, migrates and runs `pnpm dev`. Both create the administrator and the first space before they finish. Needs the install |
| `--force` | off | Write into a folder that is not empty |
| `--yes` | off | Ask nothing and use the defaults for everything not given |

The website plugin's options:

| Option | Default | Meaning |
| --- | --- | --- |
| `--website`, `--no-website` | not picked | Include (or leave out) the website plugin and its site process. The site process turns the spaces you design in the admin (Design in the sidebar) into websites, picked by the domain a visitor opens. Forms on those sites work out of the box: the secret they need is generated into `.env` |
| `--site-port <port>` | `3200` | Without a web server: the port of the site process |
| `--space-website <kind>` | `designed` | `designed`: a website you design in the admin, shown by the site process. `external`: your own website on the public API |
| `--space-theme <id>` | `neutral` | With a designed site: the theme it starts with, any `--theme` id of `manablox space create` |
| `--space-design <id>` | the theme group's first | With a designed site: any `--design` id of `manablox space create`, or `none` |

Without the website picked, giving any of the other website options is an error.

The new project has its own `README.md` that explains every file and the next steps.

## `manablox plugin <command>`

Adds, removes and switches the plugins of the project in the current folder.

```sh
manablox plugin list
manablox plugin install ai workflows
manablox plugin uninstall webhooks --yes
manablox plugin disable ai --space blog
```

| Command | What it does |
| --- | --- |
| `list` | The first-party plugins, the installed ones (dependencies with a `manablox` field) and the configured ones, with their migration status and instance flag when the database answers. The `premium` column names the product a premium plugin sells (`ai`, `website`), `license` its license state (`active`, `development`, `missing`, ...; `?` while the database does not answer). Library plugins, dependencies without a `manablox` field such as `@manablox/fields`, are left out |
| `install <id\|package>...` | A first-party id (`website`, `ai`, `workflows`, `webhooks`) at the version of the project's other `@manablox/*` packages, or an npm package that declares itself a plugin. Asks the plugin's questions, adds the dependency, writes the plugin's marked parts, installs with the project's package manager (by its lockfile, the `packageManager` field, or the tool you ran) and migrates when the database answers. Says so for an installed plugin |
| `uninstall <id>...` | Removes the marked parts, the plugin's files, scripts and dependency. Refused while another installed plugin requires it. The data stays in the database, and installing again brings it back |
| `enable <id>`, `disable <id>` | Writes `features.plugins.<id>` for the whole instance, or with `--space <name>` for one space |

| Option | Default | Meaning |
| --- | --- | --- |
| `--yes` | off | `install`: ask nothing. `uninstall`: do not ask to confirm (needed without a terminal) |
| `--install`, `--no-install` | `--install` | Run the package manager |
| `--migrate`, `--no-migrate` | `--migrate` | `install`: migrate when the database answers from here (the docker preset migrates on the next `docker compose up`) |
| `--strict` | off | Exit with 1 when a file lacks the anchor a part needs. Either way that file is not written and the part is printed |
| `--site-port <port>` and other `create` options of a first-party plugin | asked | `install`: the answer to the plugin's question, e.g. `manablox plugin install website --site-port 3300 --yes`. An option of a plugin not being installed is refused |

In the docker preset the command runs on the host and needs the project's `node_modules`
there (`pnpm install` once). An instance that loads a plugin by hand, without the marker
comments, counts it as not configured: `install` prints its parts again, which the files
already have.
| `--space <name>` | none | `enable`, `disable`: the space, by technical name |
| `--config <file>` | `manablox.config.ts` | The config file |

Only whole marked parts are ever changed. Afterwards restart the CMS (`pnpm dev` restarts
on its own); in the docker preset run `./scripts/lockfile.sh` and `docker compose up -d --build`.

`ai` and `website` are premium plugins. They run without a license key on a development
instance (not `NODE_ENV=production`, every URL and domain private, such as `localhost`); a
production instance needs a subscription. When no license covers one after `install`, it
asks once: start a 14-day trial (`manablox license buy --trial`) or buy a subscription
(`buy`), enter a key you have (`manablox license add`), or later. On a local setup the
question says that the plugin works there without a key and that production needs a
subscription, and its default is "Continue without a key (development)", in place of later.
The plugin is installed either way; on a production instance it stays locked until a license
covers it. A migrated instance is asked for its license states (a product in the
`development` state counts as local); before the first migration any key in
`MANABLOX_LICENSE_KEYS` counts, a local setup is told by `.env` (`PUBLIC_URL` and
`PUBLIC_API_URL` private, no `NODE_ENV=production` or `MANABLOX_LICENSE_KIND=production`, not
the docker preset), and a new key only goes to `.env`, activated when the instance starts.
With `--yes` or without a terminal it prints the commands instead. `manablox create` asks the
same once at the end, for all premium plugins picked, before the instance first starts; the
local preset counts as a local setup.

## Plugin commands

A plugin can add commands of its own, `manablox <plugin> <command>`, such as
`manablox website ...` of the website plugin (its README describes them). `manablox --help`
lists the commands of the plugins your config includes.

## `manablox license <command>`

License keys for the premium plugins (`@manablox/plugin-license`, which `ai` and `website`
bring along). Keys are secrets: the commands keep them in `MANABLOX_LICENSE_KEYS` in `.env`,
never in the config. A development instance needs none: the premium plugins run there on
private hosts without a key (the `development` state). A key on it activates as development
unless `--production` says otherwise.

```sh
manablox license buy --plugins ai,website --yearly
manablox license buy --plugins ai --trial --monthly
manablox license add MBX-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX
manablox license status
manablox license remove XXXXX
```

| Command | What it does |
| --- | --- |
| `buy` | Asks for the plugins (both are the bundle) and monthly or yearly billing, with the prices and trials of the license server's catalogue ("price on request" where it has none). Then it opens the portal in the browser with a code to confirm, and waits until the purchase is done (up to 30 minutes; Ctrl-C stops waiting, exit code 130). The key arrives by itself and continues as `add`. Whether a trial applies, the portal decides |
| `add <key>` | Checks the key offline, adds it to `MANABLOX_LICENSE_KEYS` in `.env` (once; without a `.env` it asks whether to create one or to print the line for the deployment's environment) and activates it, printing the products, the kind and when the period or trial ends. When every production seat is taken it lists the instances holding them and offers to deactivate one, to activate this one as development, or to stop |
| `status` | A table of every key: products, kind, state, period end, lease expiry, last refresh and error, then each product's state: `development` for one that runs without a license on a development instance, with the buy link for production. Exit code 1 while a premium plugin of the config is `lapsed` or `missing` (not `development`), for CI and health checks. `--json` prints the overview as JSON |
| `activate [<keyId>]` | Activates one key again, or every key: after a conflict (a copy of the instance refreshed it) or a restore |
| `refresh` | Refreshes every lease now |
| `remove <keyId>` | Frees the key's activation on the license server and takes it out of `.env`; a key added in the admin is removed from the database |
| `open [billing]` | Opens the portal's subscriptions, or with `billing` the account |

| Option | Default | Meaning |
| --- | --- | --- |
| `--plugins <list>` | asked | `buy`: `ai`, `website`, `ai,website` or `bundle`. Needed without a terminal |
| `--yearly`, `--monthly` | asked | `buy`: the billing interval. Needed without a terminal |
| `--trial` | off | `buy`: ask for the 14-day trial. The portal leads with it when the plan has one, and still checks that the trial is free (the install and create prompts' "Start a 14-day trial" sets it) |
| `--dev`, `--production` | by the hostnames | `add`, `activate`: activate as development (no seat, private hostnames only) or production |
| `--name <name>` | the admin's hostname and the instance id's first 6 characters, `localhost (3f9a2c)` | `add`: the instance's name in the portal; without an admin URL, the first public hostname |
| `--no-activate` | activate | `buy`, `add`: only write the key to `.env`; the instance activates it when it starts. Nothing boots |
| `--no-browser` | open it | `buy`, `open`: only print the address. Also without a terminal and over SSH |
| `--json` | off | `status`: print JSON |
| `--yes` | off | Ask nothing; the questions' answers must be given as options |
| `--config <file>` | `manablox.config.ts` | The config file |

`status`, `activate`, `refresh` and `remove` boot the instance, so they need its database.
`buy` and `open` talk to `MANABLOX_LICENSE_SERVER` (default
`https://licenses.manablox.io/api`), and the portal is its origin.

## `manablox frontend [dir]`

Creates a starter website that reads content from the public API. It already has
routing by URL (permalink), a component per block type, a `/preview` route for the
visual editor in the admin, and typed content through `pnpm types`. No API key is
needed.

```sh
manablox frontend my-site
manablox frontend my-site --framework vue-ssr --url https://api.example.com
manablox frontend my-site --model delivery --types page,teaser --yes
```

| Option | Default | Meaning |
| --- | --- | --- |
| `[dir]`, `--dir <dir>` | asked, else `my-site` | The folder to create the website in |
| `--framework <name>` | `astro` | `plain`: Vite and TypeScript, rendered in the browser. `astro`: Astro, rendered on the server. `react-ssr`: Vite and React, rendered on the server. `vue-ssr`: Vite and Vue, rendered on the server |
| `--name <name>` | the folder name | The package name |
| `--url <url>` | `http://localhost:3100` | The public API to read content from |
| `--editor-origin <url>` | `http://localhost:3000` | The address of the admin. The preview only accepts messages from there |
| `--space-id <id>` | none | Only needed when `--url` points at a management API instead of a public one |
| `--port <port>` | 3003 plain, 3005 astro, 3006 vue-ssr, 3007 react-ssr | The port of the development server |
| `--manablox-version <range>` | this CLI's version | The version range of the `@manablox/*` packages to install |
| `--install`, `--no-install` | `--install` | Run `pnpm install` after writing the files |
| `--git`, `--no-git` | `--git` | Run `git init` after writing the files |
| `--force` | off | Write into a folder that is not empty |
| `--yes` | off | Ask nothing and use the defaults for everything not given |

### Components for your own content types

The command can also write one component for each content type and block type of your
space, so the website shows your real fields from the start. It reads the types from a
running CMS:

| Option | Default | Meaning |
| --- | --- | --- |
| `--model <source>` | asked (`none` without a terminal) | `management`: read from the management API with an API key. `delivery`: read from the public API at `--url`, no key needed. `none`: only write the example teaser block |
| `--api-url <url>` | `http://localhost:3000` | The management API, for `--model management` |
| `--api-key <key>` | none | An API key that may read the space. Setting it implies `--model management` |
| `--space <name>` | none | The space, by machine name or id. Needed when the key can read several spaces |
| `--types <list>` | `all` | Which types to write components for, comma separated (`page,teaser`), or `all` |

## Config file and `.env`

`start`, `migrate`, `migrate-db`, `backup`, `sync` and `docs generate` look for the first of `manablox.config.ts`,
`manablox.config.mts`, `manablox.config.js` and `manablox.config.mjs` in the current
folder, unless you pass `--config`. A `.env` file next to the config is loaded first.
Variables that are already set in your shell or by Docker win over the file.

The config may be written in TypeScript; the command loads it without a build step.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success |
| `1` | Error, or an unknown command or option; `license status`: a premium plugin is locked |
| `2` | `sync --dry-run` found changes, or `migrate-db` found a difference in the copy |
| `130` | Cancelled with Ctrl+C: a question, or `license buy` while it waits |
