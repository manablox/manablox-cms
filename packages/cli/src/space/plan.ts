import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ContentTypePlan } from '@manablox/core';

/** Reads and validates a content type plan file (`--plan`), relative to the working directory. */
export async function readPlan(file: string, cwd = process.cwd()): Promise<ContentTypePlan> {
  let raw: string;
  try {
    raw = await readFile(resolve(cwd, file), 'utf8');
  } catch {
    throw new Error(`--plan: cannot read ${file}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    throw new Error(`--plan: ${file} is not JSON (${(error as Error).message})`);
  }
  const { contentTypePlan } = await import('@manablox/api-rpc');
  const parsed = contentTypePlan.safeParse(json);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
    throw new Error(`--plan: ${file} is not a content type plan\n  ${problems.join('\n  ')}`);
  }
  return parsed.data as ContentTypePlan;
}
