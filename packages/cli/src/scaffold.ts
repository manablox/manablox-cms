import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** One file of a scaffold. */
export interface ScaffoldFile {
  /** Relative to the target folder, `/` separated. */
  path: string;
  content: string;
  executable?: boolean;
}

export function writeFiles(dir: string, files: ScaffoldFile[]): void {
  for (const file of files) {
    const target = join(dir, ...file.path.split('/'));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.content, { mode: file.executable ? 0o755 : 0o644 });
  }
}

/** Runs a tool quietly; returns its exit code and combined output. */
export function runCommand(
  command: string,
  args: string[],
  cwd: string,
  env: Record<string, string> = {},
): Promise<{ code: number; output: string }> {
  return new Promise((resolvePromise) => {
    let output = '';
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env, CI: 'true' },
    });
    child.stdout.on('data', (chunk) => {
      output += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      output += String(chunk);
    });
    child.on('error', (error) =>
      resolvePromise({ code: 1, output: `could not run ${command}: ${error.message}` }),
    );
    child.on('exit', (code) => resolvePromise({ code: code ?? 1, output }));
  });
}

/** Runs a tool attached to the terminal; ignores SIGINT so the tool's exit code is reported. */
export function runAttached(command: string, args: string[], cwd: string): Promise<number> {
  return new Promise((resolvePromise) => {
    const ignore = () => {};
    process.on('SIGINT', ignore);
    const settle = (code: number) => {
      process.off('SIGINT', ignore);
      resolvePromise(code);
    };
    const child = spawn(command, args, { cwd, stdio: 'inherit' });
    child.on('error', () => settle(1));
    child.on('exit', (code, signal) => settle(code ?? (signal === 'SIGINT' ? 130 : 1)));
  });
}

/** Runs `git init`; failures are reported, not fatal. */
export async function initGit(dir: string): Promise<{ ok: boolean; message: string }> {
  const { code } = await runCommand('git', ['init', '--quiet'], dir);
  return code === 0
    ? { ok: true, message: 'Initialised a git repository' }
    : { ok: false, message: `git init exited with ${code}; the folder is not a repository` };
}
