import { validPort, validUrl } from '../args.js';
import { validPackageName } from '../create/options.js';
import { askInstallAndGit, askParsed, type Prompter } from '../ui.js';
import type { Framework, FrontendOptions, PartialFrontendOptions } from './options.js';

/** Asks for open options; `afterUrls` reads the model before the space id is asked. */
export async function askMissingFrontend(
  given: PartialFrontendOptions,
  defaults: FrontendOptions,
  prompter: Prompter,
  afterUrls?: (sofar: FrontendOptions) => Promise<Partial<FrontendOptions>>,
): Promise<FrontendOptions> {
  const options: FrontendOptions = { ...defaults, ...given };

  const ask = <T>(message: string, fallback: string, parse: (raw: string) => T) =>
    askParsed(prompter, message, fallback, parse);

  if (given.name === undefined) {
    options.name = await ask('Project name', defaults.name, validPackageName);
  }

  if (given.url === undefined) {
    options.url = await ask('URL of the delivery API', defaults.url, (raw) => validUrl('url', raw));
  }

  if (given.editorOrigin === undefined) {
    options.editorOrigin = await ask(
      "The admin's origin, for the visual editor's preview channel",
      defaults.editorOrigin,
      (raw) => validUrl('editor-origin', raw),
    );
  }

  if (afterUrls) Object.assign(options, await afterUrls(options));

  if (given.spaceId === undefined) {
    options.spaceId = (
      await prompter.text({
        message: 'Space id (only needed against a management instance; empty for a public one)',
        defaultValue: options.spaceId,
      })
    ).trim();
  }

  if (given.port === undefined) {
    options.port = await ask('Port of the dev server', String(defaults.port), (raw) =>
      validPort('port', raw),
    );
  }

  Object.assign(options, await askInstallAndGit(prompter, given, defaults));

  return options;
}

/** Asked before building defaults, which depend on it. */
export async function askFramework(prompter: Prompter, initial: Framework): Promise<Framework> {
  return prompter.select<Framework>({
    message: 'What should the frontend be built with?',
    options: [
      {
        value: 'plain',
        label: 'Vite + TypeScript',
        hint: 'no framework, rendered in the browser; a static bundle on any CDN',
      },
      {
        value: 'astro',
        label: 'Astro',
        hint: 'server-rendered on Node, zero JavaScript on the page by default',
      },
      {
        value: 'react-ssr',
        label: 'Vite + React, server-rendered',
        hint: 'rendered on the server, hydrated in the browser',
      },
      {
        value: 'vue-ssr',
        label: 'Vite + Vue, server-rendered',
        hint: 'rendered on the server, hydrated in the browser',
      },
    ],
    initialValue: initial,
  });
}
