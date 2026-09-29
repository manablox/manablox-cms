/**
 * Code-declared credential slots; the environment fills the secret via `values`. A slot
 * without values is created empty, and everything using it starts disabled.
 */

import type { SpaceTarget } from './code-resource.js';
import { CREDENTIAL_KIND_SPECS, type CredentialKind } from './credentials.js';
import { ManabloxError } from './errors.js';
import { isMachineName } from './ids.js';
import { humanise } from './names.js';

export interface CredentialDefinitionInput {
  slug: string;
  kind: CredentialKind;
  name?: string | undefined;
  provider?: string | undefined;
  spaces?: SpaceTarget | undefined;
  /** Field name -> value, typically from `requireEnv`. */
  values?: Record<string, string> | undefined;
}

export interface CredentialDefinition {
  kind: 'credential';
  slug: string;
  credentialKind: CredentialKind;
  name: string;
  provider: string;
  spaces: SpaceTarget;
  /** Null when an operator fills the slot. */
  values: Record<string, string> | null;
  sourceRef?: string;
}

export function defineCredential(input: CredentialDefinitionInput): CredentialDefinition {
  if (!isMachineName(input.slug)) {
    throw ManabloxError.badRequest('codeResource.slug.invalid', {
      kind: 'credential',
      slug: input.slug,
    });
  }

  const spec = CREDENTIAL_KIND_SPECS[input.kind];
  if (!spec) {
    throw ManabloxError.badRequest('credential.kind.unknown', { kind: input.kind });
  }

  // `custom` is free-form; other kinds reject unknown fields early.
  if (input.values && input.kind !== 'custom') {
    const known = new Set(spec.fields.map((field) => field.name));
    for (const name of Object.keys(input.values)) {
      if (!known.has(name)) {
        throw ManabloxError.badRequest('codeCredential.field.unknown', {
          slug: input.slug,
          kind: input.kind,
          field: name,
          known: [...known].join(', '),
        });
      }
    }
  }

  return {
    kind: 'credential',
    slug: input.slug,
    credentialKind: input.kind,
    name: input.name ?? humanise(input.slug),
    provider: input.provider ?? '',
    spaces: input.spaces ?? '*',
    values: input.values ?? null,
  };
}
