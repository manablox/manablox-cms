/**
 * `@manablox/plugin-website/cli`: the website plugin's part of the `manablox` CLI. The help
 * imports this module, so it only describes; the work is imported when it runs.
 */
import type { CliCommand, CliCommandContext, CliContribution, CliOption } from '@manablox/core';

/** The starter themes by group, as the help lists them; a test holds them to the catalog. */
export const THEMES_HELP = [
  'professional: neutral (default), corporate, minimal, practice',
  'creative: bold, studio, playful, noir',
  'personal: editorial, journal, blossom, terminal',
];

/** The design presets by group, as the help lists them; a test holds them to the catalog. */
export const DESIGNS_HELP = [
  'professional: atlas, harbor, ledger, summit',
  'creative: spotlight, gallery, poster, stage',
  'personal: journal, sunny, readme, postcard',
];

const SPACE: CliOption = {
  name: 'space',
  arg: '<name>',
  help: 'the space, by technical name or id (needed with several)',
};

/** A command whose work lives in `commands.ts`. */
function command(words: string, described: Omit<CliCommand, 'run'>): CliCommand {
  return {
    ...described,
    run: async (context: CliCommandContext) => {
      const { commandRuns } = await import('./commands.js');
      const run = commandRuns[words];
      if (!run) throw new Error(`no website command '${words}'`);
      return run(context);
    },
  };
}

const contribution: CliContribution = {
  summary: 'designed websites, served by the site process',
  options: {
    'space create': {
      options: [
        {
          name: 'website',
          arg: 'designed|external',
          help: "designed: apply --theme, switch to a designed site and claim the URL's host as its domain (default: external)",
        },
        { name: 'theme', arg: '<id>', help: THEMES_HELP },
        {
          name: 'design',
          arg: '<id>|none',
          help: [
            'designed: a complete site design of layout, menus and',
            'page and section designs, published at once (default:',
            "the first of the theme's group); any design works with",
            'any theme; none keeps the theme alone:',
            ...DESIGNS_HELP,
          ],
        },
      ],
      check: async (values) => {
        (await import('./space.js')).websiteSpaceData(values);
      },
      apply: async (_space, values) => (await import('./space.js')).websiteSpaceData(values),
      report: (data, space) => {
        const { theme, preset } = data as { theme: string; preset: string | null };
        const name = theme.replace(/^builtin:/, '');
        const look = preset ? `the ${name} theme and the ${preset} design` : `the ${name} theme`;
        return [
          space.warnings.length || !space.url
            ? `a designed site with ${look}`
            : `a designed site with ${look}, answering on ${new URL(space.url).hostname}`,
        ];
      },
    },
    create: {
      options: [
        {
          name: 'space-website',
          arg: 'designed|external',
          help: [
            'designed: a theme, served by the site process',
            '(default); external: your own frontend',
          ],
        },
        {
          name: 'space-theme',
          arg: '<id>',
          help: 'designed: the starter theme (default: neutral); see --theme under manablox space create for the list',
        },
        {
          name: 'space-design',
          arg: '<id>|none',
          help: "designed: the site design (default: the theme's first); see --design under manablox space create for the list",
        },
        {
          name: 'site-port',
          arg: '<port>',
          help: 'without a proxy: the site process port (default: 3200)',
        },
      ],
      check: async (values) => (await import('./create.js')).checkCreate(values),
      apply: async (context, values) => (await import('./create.js')).applyCreate(context, values),
    },
  },
  commands: {
    'publish-all': command('publish-all', {
      description: "publish every design draft of a space, as the admin's Publish all does",
      options: [SPACE],
    }),
    'domains list': command('domains list', {
      description: "list a space's site domains and their verification",
      options: [SPACE],
    }),
    'domains add': command('domains add', {
      description: 'add a site domain to a space',
      args: '<hostname>',
      options: [
        SPACE,
        { name: 'primary', type: 'switch', help: 'make it the primary domain (default: no)' },
      ],
    }),
    'domains verify': command('domains verify', {
      description: "check a site domain's DNS records now",
      args: '<hostname>',
      options: [SPACE],
    }),
    'domains remove': command('domains remove', {
      description: 'remove a site domain from a space',
      args: '<hostname>',
      options: [SPACE],
    }),
  },
  templates: async (context) => (await import('./templates.js')).websiteTemplates(context),
  install: async (context) => (await import('./create.js')).applyInstall(context),
};

export default contribution;
