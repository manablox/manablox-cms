import type {
  CliCreateContext,
  CliCreateResult,
  CliInstallContext,
  CliInstallResult,
  CliValues,
} from '@manablox/core';
import {
  defaultTheme,
  designFor,
  oneOf,
  SPACE_WEBSITES,
  type SpaceWebsite,
  spaceDesigns,
  spaceThemes,
  text,
  validDesign,
  validPort,
  validTheme,
} from './catalog.js';

/** What `templates` gets back. */
export interface WebsiteCreateValues {
  sitePort: number;
}

export const DEFAULT_SITE_PORT = 3200;

interface Given {
  website?: SpaceWebsite;
  theme?: string;
  design?: string | null;
  sitePort?: number;
}

function given(values: CliValues): Given {
  const website = text(values['space-website']);
  const theme = text(values['space-theme']);
  const design = text(values['space-design']);
  const port = text(values['site-port']);
  return {
    ...(website !== undefined ? { website: oneOf('space-website', website, SPACE_WEBSITES) } : {}),
    ...(theme !== undefined ? { theme: validTheme('space-theme', theme) } : {}),
    ...(design !== undefined ? { design: validDesign('space-design', design) } : {}),
    ...(port !== undefined ? { sitePort: validPort('site-port', port) } : {}),
  };
}

/** Where the site process answers: by domain behind a proxy, else its port. */
export function siteUrl(byDomain: boolean, sitePort: number): string {
  return byDomain ? '' : `http://localhost:${sitePort}`;
}

/** The site process's port: given, asked without a proxy, else the default. */
async function sitePortOf(
  { instance, prompter }: Pick<CliInstallContext, 'instance' | 'prompter'>,
  given: number | undefined,
): Promise<number> {
  if (given !== undefined || !prompter || instance.byDomain) return given ?? DEFAULT_SITE_PORT;
  const raw = await prompter.text({
    message: 'Port of the site process',
    defaultValue: String(DEFAULT_SITE_PORT),
    validate: (value) => {
      try {
        validPort('site-port', value);
        return undefined;
      } catch (error) {
        return (error as Error).message;
      }
    },
  });
  return validPort('site-port', raw);
}

/** The local preset's line about starting the site process. */
function devSiteStep(url: string, started: boolean): string {
  return started
    ? `pnpm dev:site                # in another terminal: designed sites at ${url}`
    : `pnpm dev:site                # designed sites at ${url}, once a space has a domain`;
}

/** `manablox plugin install website`: the site port, given as `--site-port` or asked as `create` asks it. */
export async function applyInstall(context: CliInstallContext): Promise<CliInstallResult> {
  const picked = given(context.values);
  const [space] = (['space-website', 'space-theme', 'space-design'] as const).filter(
    (name) => context.values[name] !== undefined,
  );
  if (space)
    throw new Error(
      `--${space} is about the first space of manablox create; plugin install makes none`,
    );
  const sitePort = await sitePortOf(context, picked.sitePort);
  const url = siteUrl(context.instance.byDomain, sitePort);
  return {
    values: { sitePort } satisfies WebsiteCreateValues,
    nextSteps: context.instance.preset === 'local' ? [devSiteStep(url, false)] : [],
  };
}

/** Resolves the options, asking for missing ones with a prompter. */
export async function applyCreate(
  { instance, prompter }: CliCreateContext,
  values: CliValues,
): Promise<CliCreateResult> {
  const picked = given(values);
  const sitePort = await sitePortOf({ instance, prompter }, picked.sitePort);

  let website = picked.website ?? 'designed';
  let theme = picked.theme ?? defaultTheme();
  let design = picked.design;
  if (instance.space && prompter) {
    if (picked.website === undefined) {
      website = await prompter.select<SpaceWebsite>({
        message: 'How is its website built?',
        options: [
          {
            value: 'designed',
            label: 'Designed site',
            hint: 'designed in the admin with a theme, served by the site process',
          },
          {
            value: 'external',
            label: 'Own frontend',
            hint: 'a website you build reads the content through the public API',
          },
        ],
        initialValue: 'designed',
      });
    }
    if (website === 'designed' && picked.theme === undefined) {
      theme = await prompter.select({
        message: 'Which theme does the site start with?',
        options: spaceThemes().map((entry) => ({
          value: entry.id,
          label: `${entry.name} (${entry.category})`,
          hint: entry.description,
        })),
        initialValue: defaultTheme(),
      });
    }
    if (website === 'designed' && picked.design === undefined) {
      const category = spaceThemes().find((entry) => entry.id === theme)?.category;
      const answer = await prompter.select({
        message: 'Which design does the site start with?',
        options: [
          // Any design fits any theme; the theme's own category comes first.
          ...spaceDesigns()
            .sort((a, b) => Number(b.category === category) - Number(a.category === category))
            .map((entry) => ({
              value: entry.id,
              label: `${entry.name} (${entry.category})`,
              hint: entry.description,
            })),
          { value: 'none', label: 'Theme only', hint: 'plain generated designs for every page' },
        ],
        initialValue: designFor(theme),
      });
      design = answer === 'none' ? null : answer;
    }
  }

  const designed = instance.space !== null && website === 'designed';
  const url = siteUrl(instance.byDomain, sitePort);
  const local = instance.preset === 'local';
  return {
    ...(designed
      ? {
          spaceArgs: [
            '--website',
            'designed',
            '--theme',
            theme,
            '--design',
            (design === undefined ? designFor(theme) : design) ?? 'none',
          ],
          spaceUrl: instance.byDomain ? 'https://www.example.com' : url,
        }
      : {}),
    nextSteps: ({ started }) => (local ? [devSiteStep(url, started)] : []),
    values: { sitePort } satisfies WebsiteCreateValues,
  };
}

/** Refuses a bad value before any question. */
export function checkCreate(values: CliValues): void {
  given(values);
}
