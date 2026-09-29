import {
  type CodeRef,
  type CredentialDefinition,
  type CredentialKind,
  ManabloxError,
  type TemplateDefinition,
  type TypeScope,
  targetsSpace,
} from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type { ContentRow, CredentialRow, SpaceEnvironmentRow, SpaceRow } from '@manablox/db';
import type { CredentialService } from '../credentials/service.js';
import type { ResourceKindPlan } from './kinds.js';
import { codeCredentialId, codeTemplateId } from './shared.js';

/** A credential as planned, existing or not. */
export interface PlannedCredential {
  id: string;
  kind: CredentialKind;
  /** Holds a secret, or will after this pass. */
  filled: boolean;
}

/** What one environment will hold after a pass, and references resolved against it. */
export interface ResourcePlan {
  /** `codeScopeKey` of the environment planned. */
  key: string;
  /** The environment's content types, for references by name. */
  types: TypeScope;
  credentials: Map<string, PlannedCredential>;
  byId: Map<string, PlannedCredential>;
  /**
   * Resolves `ref.<kind>(name)`: content types, credentials and templates here, other kinds
   * through the plan their kind made. Throws on unknown names.
   */
  resolve(reference: CodeRef): string;
  /** Another kind's plan, as its `plan` returned it. */
  part<P extends ResourceKindPlan>(kind: string): P | undefined;
}

/** Core's declarations that target one space. */
export interface SpaceDeclarations {
  credentials: CredentialDefinition[];
  templates: TemplateDefinition[];
}

/** Core's rows of one environment, read once per pass and kept current as the pass writes. */
export interface SpaceRows {
  declared: SpaceDeclarations;
  environment: SpaceEnvironmentRow;
  /** `codeScopeKey` of the space and environment. */
  key: string;
  /** Shared by every environment of the space. */
  credentials: CredentialRow[];
  /** Code-owned documents as the pass began, for prune. */
  codeContent: ContentRow[];
  /** Existing template documents by derived id, whatever their source. */
  templates: Map<string, ContentRow>;
}

/** Declarations that target the space with this machine name. */
export const targeting = <T extends { spaces: '*' | readonly string[] }>(
  list: readonly T[],
  space: SpaceRow,
): T[] => list.filter((declaration) => targetsSpace(declaration.spaces, space.machineName));

/** Core's declarations that target a space. */
export function declaredFor(
  resources: Manablox['config']['resources'],
  space: SpaceRow,
): SpaceDeclarations {
  return {
    credentials: targeting(resources.credentials, space),
    templates: targeting(resources.templates, space),
  };
}

/**
 * Existing rows plus the rows this pass will write, so a dry run resolves references
 * like a real one. Existing rows win.
 */
export function planSpace(
  space: SpaceRow,
  rows: SpaceRows,
  credentialService: CredentialService,
  manablox: Manablox,
  parts: ReadonlyMap<string, ResourceKindPlan>,
): ResourcePlan {
  const { declared } = rows;
  const credentials = new Map<string, PlannedCredential>();
  // A slot this pass fills counts as filled, so dry runs match real ones.
  const declaresValues = new Map<string, boolean>();
  for (const definition of declared.credentials) {
    declaresValues.set(definition.slug, definition.values !== null);
    credentials.set(definition.slug, {
      id: codeCredentialId(space.id, definition.slug),
      kind: definition.credentialKind,
      filled: definition.values !== null,
    });
  }
  for (const row of rows.credentials) {
    credentials.set(row.slug, {
      id: row.id,
      kind: row.kind,
      filled: credentialService.hasSecret(row) || (declaresValues.get(row.slug) ?? false),
    });
  }

  const byId = new Map([...credentials.values()].map((entry) => [entry.id, entry]));
  const types: TypeScope = {
    spaceId: space.id,
    environmentId: rows.environment.id,
    production: rows.environment.kind === 'production',
  };
  const plan: ResourcePlan = {
    key: rows.key,
    types,
    credentials,
    byId,
    part: <P extends ResourceKindPlan>(kind: string) => parts.get(kind) as P | undefined,
    resolve: (reference) => {
      const found =
        reference.kind === 'contentType'
          ? manablox.contentTypes.tryGetByName(reference.name, types)?.id
          : reference.kind === 'credential'
            ? credentials.get(reference.name)?.id
            : reference.kind === 'template'
              ? codeTemplateId(rows.key, reference.name, space.defaultLocale)
              : parts.get(reference.kind)?.resolve(reference.name);
      if (!found) {
        throw ManabloxError.notFound('codeResource.ref.unresolved', {
          kind: reference.kind,
          name: reference.name,
          space: space.machineName,
        });
      }
      return found;
    },
  };
  return plan;
}
