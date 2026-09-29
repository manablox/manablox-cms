import { describe, expect, it } from 'vitest';
import { foreignOptions, optionsBeyondCore, parseArgs } from '../src/args.js';
import { formatSyncReport } from '../src/commands/sync.js';

describe('manablox cli', () => {
  it('reads the command, value options and flags', () => {
    const args = parseArgs(['start', '--mode', 'public', '--port=3100', '--watch']);
    expect(args.command).toBe('start');
    expect(args.options).toEqual({ mode: 'public', port: '3100' });
    expect(args.flags).toEqual({ watch: true });
    expect(args.help).toBe(false);
  });

  it('treats -h anywhere as help', () => {
    expect(parseArgs(['migrate', '-h']).help).toBe(true);
  });

  it("reads sync's own options", () => {
    const args = parseArgs(['sync', '--space', 'marketing', '--dry-run', '--prune']);
    expect(args.command).toBe('sync');
    expect(args.options).toEqual({ space: 'marketing' });
    expect(args.flags).toEqual({ 'dry-run': true, prune: true });
  });

  it("reads migrate-db's own options", () => {
    const args = parseArgs([
      'migrate-db',
      '--to',
      'postgres://h/db',
      '--replace',
      '--force-offline',
    ]);
    expect(args.options).toEqual({ to: 'postgres://h/db' });
    expect(args.flags).toEqual({ replace: true, 'force-offline': true });
  });

  it('keeps every = after the first in a value', () => {
    const args = parseArgs([
      'frontend',
      '--url=http://x/?a=b',
      '--api-key=abc==',
      '--editor-origin',
      'http://y/?c=d=e',
    ]);
    expect(args.options).toEqual({
      url: 'http://x/?a=b',
      'api-key': 'abc==',
      'editor-origin': 'http://y/?c=d=e',
    });
  });

  it('reads options given before the command', () => {
    const args = parseArgs(['--config=manablox.public.config.ts', 'start', '--watch']);
    expect(args.command).toBe('start');
    expect(args.options).toEqual({ config: 'manablox.public.config.ts' });
    expect(args.flags).toEqual({ watch: true });
  });

  it('rejects an option the command does not take', () => {
    expect(() => parseArgs(['migrate', '--space', 'blog'])).toThrow(
      /unknown option '--space' for 'migrate'/,
    );
    expect(() => parseArgs(['start', '--wach'])).toThrow(/unknown option '--wach'/);
  });

  it("tells plugin install's plugin options apart from its own", () => {
    expect(foreignOptions(['plugin', 'install', 'website', '--yes'], 'plugin')).toBe(false);
    expect(foreignOptions(['plugin', 'install', 'website', '--site-port', '3300'], 'plugin')).toBe(
      true,
    );
    const args = {
      options: { 'site-port': '3300', space: 'blog' },
      flags: { yes: true, 'no-x': true },
      lists: {},
    };
    expect(optionsBeyondCore(args, 'plugin')).toEqual(['site-port', 'x']);
  });

  it('rejects a missing value and a value on a switch', () => {
    expect(() => parseArgs(['start', '--port'])).toThrow(/--port <value>' argument missing/);
    expect(() => parseArgs(['start', '--watch=yes'])).toThrow(/does not take an argument/);
  });
});

describe('the sync report', () => {
  const change = (overrides: Record<string, string>) => ({
    kind: 'workflow',
    slug: 'notify',
    space: 'marketing',
    action: 'created',
    ...overrides,
  });

  it('prints a line per change, with its reason, and counts the rest', () => {
    const printed = formatSyncReport({
      dryRun: false,
      spaces: 2,
      changes: [
        change({}),
        change({ kind: 'webhook', slug: 'ping', action: 'updated' }),
        change({ slug: 'old', action: 'disabled', reason: 'no declaration covers it' }),
        change({ slug: 'same', action: 'unchanged' }),
      ],
    });

    expect(printed).toContain('2 space(s)');
    expect(printed).toContain('+ workflow notify  [marketing] created');
    expect(printed).toContain('~ webhook');
    expect(printed).toContain('- no declaration covers it');
    expect(printed).toContain('1 unchanged');
  });

  it('says so when there is nothing to do', () => {
    const printed = formatSyncReport({ dryRun: true, spaces: 1, changes: [] });
    expect(printed).toContain('dry run, nothing written');
    expect(printed).toContain('nothing to do');
  });
});
