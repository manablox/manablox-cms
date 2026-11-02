import { definePlugin, type ManabloxPlugin } from '@manablox/core';
import type { AiDesigner } from '../../src/server/ai/design.js';

/** One `design` call of the fake designer: what it sent, and each answer's problems. */
export interface FakeDesignCall {
  prompt: string;
  system: string;
  purpose: string;
  problems: string[][];
}

/** Thrown when no answer gave a usable design, with the AI plugin's error key. */
const empty = () =>
  Object.assign(new Error('no usable design'), { key: 'plugins.ai.design.empty' });

/**
 * The AI plugin's design service as the website sees it (`plugins.get('ai').design`),
 * answering `answers` in turn instead of a model: every answer, a JSON string or an object,
 * goes through the request's `check`; one with problems is answered again with the next
 * answer, up to `retries` more times; a design the request's `usable` refuses fails.
 */
export function fakeDesigner(
  answers: unknown[],
  { retries = 2 }: { retries?: number } = {},
): AiDesigner & { calls: FakeDesignCall[] } {
  const calls: FakeDesignCall[] = [];
  return {
    calls,
    async design(request) {
      const call: FakeDesignCall = {
        prompt: request.prompt,
        system: request.system,
        purpose: request.purpose,
        problems: [],
      };
      calls.push(call);
      let last: Awaited<ReturnType<typeof request.check>> | null = null;
      for (let attempt = 0; attempt <= retries; attempt++) {
        const answer = answers.shift();
        let parsed: unknown = answer;
        if (typeof answer === 'string') {
          try {
            parsed = JSON.parse(answer);
          } catch {
            call.problems.push(['The answer is not JSON.']);
            continue;
          }
        }
        last = await request.check((parsed ?? {}) as Record<string, unknown>);
        call.problems.push(last.problems);
        if (last.problems.length === 0) break;
      }
      if (!last || (request.usable && !request.usable(last.value))) throw empty();
      return { value: last.value, problems: last.problems, generationId: 'g1' };
    },
  };
}

/**
 * A stand-in for the AI plugin: a plugin named `ai` with the `ai:use` permission, serving
 * `design`.
 */
export function fakeAiPlugin(designer: AiDesigner = fakeDesigner([])): ManabloxPlugin {
  return definePlugin({
    name: 'ai',
    description: 'A stand-in for the AI plugin in the website tests.',
    permissions: [
      { key: 'ai:use', label: 'Generate content', group: 'AI', roles: ['editor', 'author'] },
    ],
    services: () => ({ design: designer }),
  });
}
