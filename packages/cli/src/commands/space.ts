import { optionValues, type ParsedArgs } from '../args.js';
import type { CliPlugin } from '../plugins.js';

/** Adds a refusal's details, such as the plan field a check failed on, to its message. */
function withDetails(error: unknown): never {
  const details = (error as { details?: { key: string; path?: unknown[] }[] }).details;
  const lines = (error instanceof Error ? (details ?? []) : [])
    .filter((detail) => detail.path?.length || detail.key !== (error as Error).message)
    .map((detail) =>
      detail.path?.length ? `  ${detail.path.join('.')}: ${detail.key}` : `  ${detail.key}`,
    );
  if (lines.length) throw new Error(`${(error as Error).message}\n${lines.join('\n')}`);
  throw error;
}

/** `manablox space create`: a space as the admin creates it, owned by the first account. */
export async function space(args: ParsedArgs, plugins: readonly CliPlugin[] = []): Promise<number> {
  const action = args.positionals[0];
  if (action !== 'create') {
    process.stderr.write(
      `manablox: ${action ? `unknown space action '${action}'` : 'space needs an action'}; try manablox space create --name <name>\n`,
    );
    return 1;
  }

  const { spaceOptionsFromArgs } = await import('../space/options.js');
  const options = spaceOptionsFromArgs(args.options, args.flags, args.lists);
  const { pluginSpaceData } = await import('../space/plugins.js');
  const { plugins: pluginData, reports } = await pluginSpaceData(options, plugins, (group) =>
    optionValues(args, group.options),
  );
  const { readPlan } = await import('../space/plan.js');
  const plan = options.plan ? await readPlan(options.plan) : undefined;
  const { bootstrap, loadConfig, requireManagement } = await import('@manablox/server');
  const { applySpaceStarter } = await import('@manablox/services');
  const { SPACE_TEMPLATES } = await import('@manablox/core');
  const { config } = await loadConfig(args.options.config);
  const runtime = requireManagement(
    await bootstrap({ ...config, server: { ...config.server, mode: 'management' } }),
  );

  try {
    // Idempotent, so a setup script can run it again.
    if (await runtime.repos.spaces.findByMachineName(options.machineName)) {
      process.stdout.write(
        `manablox: the space '${options.machineName}' exists already; nothing was created\n`,
      );
      return 0;
    }
    if (!(await runtime.manablox.controls.feature(null, 'spaceCreate')).enabled) {
      process.stderr.write(
        'manablox: creating spaces is switched off on this instance (features.spaceCreate)\n',
      );
      return 1;
    }

    let ownerId: string | null = null;
    let ownerRoles: string[] = [];
    if (options.owner) {
      const { findUserId } = await import('./user.js');
      ownerId = await findUserId(runtime.repos, options.owner);
      const principal = ownerId ? await runtime.repos.users.findPrincipal(ownerId) : null;
      if (!ownerId || !principal) {
        process.stderr.write(`manablox: no account with the email ${options.owner}\n`);
        return 1;
      }
      ownerRoles = [principal.role, 'owner'];
    }

    const [defaultLocale = 'en'] = options.locales;
    const { starter } = options;
    // Without an owner, the first account to sign up becomes owner of every space.
    const created = await runtime.spaces
      .create(
        {
          name: options.name,
          machineName: options.machineName,
          url: options.url,
          defaultLocale,
          locales: options.locales,
          ...(Object.keys(pluginData).length ? { plugins: pluginData } : {}),
        },
        ownerId,
        starter || plan
          ? async (row, repos) => {
              if (starter) {
                await applySpaceStarter(
                  { ...runtime, repos },
                  row,
                  ownerId ? { userId: ownerId, roles: ownerRoles } : null,
                  starter,
                  options.blocks ?? undefined,
                );
              }
              if (plan) await runtime.contentTypes.using(repos).applyPlan(row.id, plan, ownerId);
            }
          : undefined,
        // All-space declarations apply to new spaces, after the starter so they can name its types.
        (row) =>
          runtime.codeResources.sync({
            spaceIds: [row.id],
            ...(ownerId ? { actorId: ownerId } : {}),
          }),
      )
      .catch(withDetails);
    const lines = [`manablox: created the space '${created.name}' (${created.machineName})`];
    const template = SPACE_TEMPLATES.find((entry) => entry.id === starter);
    if (template) lines.push(`  as a ${template.name.toLowerCase()}`);
    if (plan) lines.push(`  with ${plan.types.length} content types from ${options.plan}`);
    for (const report of reports) {
      for (const line of report({ url: created.url, warnings: created.warnings })) {
        lines.push(`  ${line}`);
      }
    }
    for (const warning of created.warnings) lines.push(`  ${warning}`);
    process.stdout.write(`${lines.join('\n')}\n`);
    return 0;
  } finally {
    await runtime.shutdown();
  }
}
