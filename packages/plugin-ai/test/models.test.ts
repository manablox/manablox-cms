import { describe, expect, it } from 'vitest';
import { AI_HOSTED_KINDS, AI_PROVIDERS } from '../src/sdk.js';

/** Guards the model catalogue shared by the picker and the service's model check. */
describe('the model catalogue', () => {
  // A self-hosted provider has no catalogue.
  const hosted = AI_HOSTED_KINDS.map((kind) => AI_PROVIDERS[kind]);

  it('offers a model for every capability each provider claims', () => {
    for (const meta of hosted) {
      for (const capability of meta.capabilities) {
        expect(meta.models[capability]?.length, `${meta.kind}/${capability}`).toBeGreaterThan(0);
      }
    }
  });

  it('defaults to a model it also offers', () => {
    for (const meta of hosted) {
      for (const capability of meta.capabilities) {
        const chosen = meta.defaultModels[capability];
        expect(chosen, `${meta.kind}/${capability}`).toBeTruthy();
        expect(meta.models[capability]?.map((model) => model.id)).toContain(chosen);
      }
    }
  });

  it('gives every model a distinct id and a name that is not just the id', () => {
    const seen = new Set<string>();
    for (const meta of Object.values(AI_PROVIDERS)) {
      for (const models of Object.values(meta.models)) {
        for (const model of models ?? []) {
          expect(seen.has(model.id), `duplicate ${model.id}`).toBe(false);
          seen.add(model.id);
          expect(model.label.length).toBeGreaterThan(0);
        }
      }
    }
  });
});
