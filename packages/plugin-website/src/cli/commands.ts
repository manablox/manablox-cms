import type { CliCommandContext } from '@manablox/core';
import type { WebsiteServices } from '../server/services/index.js';
import { text } from './catalog.js';

/** The plugin's services and the space `--space` names, or the only one. */
async function target(context: CliCommandContext) {
  const { plugin } = await context.runtime<WebsiteServices>();
  const wanted = text(context.values.space);
  const spaces = await plugin.repos.spaces.list();
  const space = wanted
    ? spaces.find((entry) => entry.machineName === wanted || entry.id === wanted)
    : spaces.length === 1
      ? spaces[0]
      : undefined;
  if (!space) {
    throw new Error(
      wanted
        ? `no space '${wanted}'`
        : `pass --space <name>; there are ${spaces.length} spaces: ${spaces.map((entry) => entry.machineName).join(', ') || 'none'}`,
    );
  }
  return { services: plugin.services, space };
}

/** One positional hostname. */
function hostname(context: CliCommandContext, words: string): string {
  const [host, ...rest] = context.positionals;
  if (!host || rest.length) throw new Error(`usage: manablox website ${words} <hostname>`);
  return host.toLowerCase();
}

/** The space's domain with that hostname. */
async function domainOf(services: WebsiteServices, spaceId: string, host: string) {
  const domain = (await services.domains.list(spaceId)).find((entry) => entry.hostname === host);
  if (!domain) throw new Error(`the space has no domain ${host}`);
  return domain;
}

/** Each command's work, by its words. */
export const commandRuns: Record<string, (context: CliCommandContext) => Promise<number>> = {
  'publish-all': async (context) => {
    const { services, space } = await target(context);
    const { published, revision } = await services.designs.publishAll(space.id, null);
    context.out.write(
      `manablox: published ${published.length} designs of ${space.machineName} (revision ${revision})\n`,
    );
    return 0;
  },
  'domains list': async (context) => {
    const { services, space } = await target(context);
    const domains = await services.domains.list(space.id);
    if (!domains.length) context.out.write(`manablox: ${space.machineName} has no domains\n`);
    for (const domain of domains) {
      const flags = [domain.isPrimary ? 'primary' : '', domain.verification.status]
        .filter(Boolean)
        .join(', ');
      context.out.write(`${domain.hostname}  ${flags}\n`);
    }
    return 0;
  },
  'domains add': async (context) => {
    const host = hostname(context, 'domains add');
    const { services, space } = await target(context);
    const created = await services.domains.create(space.id, {
      hostname: host,
      isPrimary: context.values.primary === true,
    });
    context.out.write(`manablox: added ${created.hostname} to ${space.machineName}\n`);
    if (created.verification.txtValue) {
      context.out.write(
        `  verify it with the TXT record ${created.verification.txtName} = ${created.verification.txtValue}\n`,
      );
    }
    return 0;
  },
  'domains verify': async (context) => {
    const host = hostname(context, 'domains verify');
    const { services, space } = await target(context);
    const domain = await domainOf(services, space.id, host);
    const checked = await services.domains.verify(space.id, domain.id);
    context.out.write(`manablox: ${host} is ${checked.verification.status}\n`);
    return checked.verification.status === 'verified' ? 0 : 2;
  },
  'domains remove': async (context) => {
    const host = hostname(context, 'domains remove');
    const { services, space } = await target(context);
    const domain = await domainOf(services, space.id, host);
    await services.domains.delete(space.id, domain.id);
    context.out.write(`manablox: removed ${host} from ${space.machineName}\n`);
    return 0;
  },
};
