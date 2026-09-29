import type { ParsedArgs } from '../args.js';

/** Writes code-declared resources via the full runtime, so hooks, versions and the vault apply. */
export async function sync(args: ParsedArgs): Promise<number> {
  const { bootstrap, loadConfig, requireManagement } = await import('@manablox/server');
  const { config } = await loadConfig(args.options.config);
  const dryRun = args.flags['dry-run'] === true;

  // Manual apply, or bootstrap would reconcile first and leave the report empty.
  const runtime = requireManagement(
    await bootstrap({
      ...config,
      resources: { ...config.resources, apply: 'manual' },
      server: { ...config.server, mode: 'management' },
    }),
  );

  try {
    const wanted = args.options.space;
    let spaceIds: string[] | undefined;
    if (wanted) {
      const space = await runtime.repos.spaces.findByMachineName(wanted);
      if (!space) {
        process.stderr.write(`manablox: no space with the machine name '${wanted}'\n`);
        return 1;
      }
      spaceIds = [space.id];
    }

    const report = await runtime.codeResources.sync({
      ...(spaceIds ? { spaceIds } : {}),
      ...(args.flags.prune ? { prune: true } : {}),
      ...(dryRun ? { dryRun: true } : {}),
    });
    process.stdout.write(formatSyncReport(report));
    // Exit 2 when a dry run would change something, so deploys can gate on it.
    return dryRun && report.changes.some((change) => change.action !== 'unchanged') ? 2 : 0;
  } finally {
    await runtime.shutdown();
  }
}

/** One line per change, plus a count of unchanged resources. */
export function formatSyncReport(report: {
  dryRun: boolean;
  spaces: number;
  changes: Array<{ kind: string; slug: string; space: string; action: string; reason?: string }>;
}): string {
  const marks: Record<string, string> = {
    created: '+',
    updated: '~',
    deleted: '-',
    disabled: 'o',
    released: 'o',
    skipped: '!',
  };
  const moved = report.changes.filter((change) => change.action !== 'unchanged');
  const width = Math.max(0, ...moved.map((change) => change.kind.length));

  const lines = [
    `manablox sync${report.dryRun ? ' (dry run, nothing written)' : ''}: ${report.spaces} space(s)`,
  ];
  for (const change of moved) {
    const detail = change.reason ? `  - ${change.reason}` : '';
    lines.push(
      `  ${marks[change.action] ?? '?'} ${change.kind.padEnd(width)} ${change.slug}` +
        `  [${change.space}] ${change.action}${detail}`,
    );
  }
  if (moved.length === 0) lines.push('  nothing to do');
  const unchanged = report.changes.length - moved.length;
  if (unchanged) lines.push(`  ${unchanged} unchanged`);
  return `${lines.join('\n')}\n`;
}
