import { graphqlTypeName } from './content-type.js';
import type { ResolvedScope } from './environment.js';
import { ManabloxError } from './errors.js';
import { type FieldTypeRegistry, resolveStorage } from './field-type.js';
import { fnv1a } from './hash.js';
import { type ContentTypeDefinition, type FieldDefinition, isDocumentType } from './types.js';

/**
 * Which type set a lookup reads: global types only (`null`), a space's production types (its
 * id), or an environment's, resolved so it knows whether it is production.
 */
export type TypeScope =
  | string
  | null
  | Pick<ResolvedScope, 'spaceId' | 'environmentId' | 'production'>;

/**
 * Code- and admin-defined content types in one shape, told apart by `source`. Ids are unique
 * across environments; names are unique per type set: global, a space's production types, or
 * one staging environment's (which also sees the space's code types).
 */
export class ContentTypeRegistry {
  private byId = new Map<string, ContentTypeDefinition>();
  /** `${setKey}:${name}` -> id */
  private byName = new Map<string, string>();
  /** Space id (`''` for global types) -> ids of its types, every environment's. */
  private bySpace = new Map<string, Set<string>>();
  /** Id -> position in the registry; lookups answer in this order. */
  private rank = new Map<string, number>();
  private nextRank = 0;
  /** GraphQL type name -> the type names that map to it, with how many types have each. */
  private graphqlNames = new Map<string, Map<string, number>>();
  private version = 0;
  /** Set key -> a digest of its types, for per-set schema versions. */
  private digests = new Map<string, string>();

  constructor(readonly fieldTypes: FieldTypeRegistry) {}

  /** Replaces every type in the registry. */
  setAll(types: ContentTypeDefinition[]): void {
    this.byId = new Map();
    this.byName = new Map();
    this.bySpace = new Map();
    this.rank = new Map();
    this.graphqlNames = new Map();
    this.nextRank = 0;
    for (const type of types) this.insert(type);
    this.version++;
    this.digests = new Map();
  }

  add(type: ContentTypeDefinition): void {
    this.insert(type);
    this.changed([type.spaceId]);
  }

  remove(id: string): void {
    const type = this.byId.get(id);
    if (!type) return;
    if (type.source === 'code') {
      throw ManabloxError.forbidden('contentType.code.immutable', { name: type.name });
    }
    this.drop(type);
    this.changed([type.spaceId]);
  }

  /**
   * Drops the types with the ids in `removed` and puts `types` in (a type already in keeps its
   * place), then checks what changed like `validate` does; the rest is left alone.
   */
  replace(removed: Iterable<string>, types: readonly ContentTypeDefinition[]): void {
    const spaces: Array<string | null> = [];
    for (const id of removed) {
      const type = this.byId.get(id);
      if (!type) continue;
      this.drop(type);
      spaces.push(type.spaceId);
    }
    // Every replaced type leaves the indexes first, so names can move between them.
    const replaced = new Set<string>();
    for (const type of types) {
      const before = this.byId.get(type.id);
      if (!before || replaced.has(type.id)) continue;
      this.unindex(before);
      replaced.add(type.id);
      spaces.push(before.spaceId);
    }
    for (const type of types) {
      this.insert(type, replaced.delete(type.id));
      spaces.push(type.spaceId);
    }
    this.changed(spaces);
    for (const type of types) this.validateType(type);
  }

  get(id: string): ContentTypeDefinition {
    const type = this.byId.get(id);
    if (!type) throw ManabloxError.notFound('contentType.notFound', { id });
    return type;
  }

  tryGet(id: string): ContentTypeDefinition | undefined {
    return this.byId.get(id);
  }

  getByName(name: string, scope: TypeScope = null): ContentTypeDefinition {
    const found = this.tryGetByName(name, scope);
    if (!found) {
      throw ManabloxError.notFound('contentType.notFound', { name, spaceId: spaceOf(scope) });
    }
    return found;
  }

  tryGetByName(name: string, scope: TypeScope = null): ContentTypeDefinition | undefined {
    for (const key of [stagingOf(scope), spaceOf(scope), 'global']) {
      const id = key ? this.byName.get(`${key}:${name}`) : undefined;
      const type = id ? this.byId.get(id) : undefined;
      if (type && this.inScope(type, scope)) return type;
    }
    return undefined;
  }

  /**
   * The type id per-type grants name for `typeId`: grants name production types, so a staging
   * type follows its space's production type of the same name, when there is one.
   */
  grantTypeId(typeId: string): string {
    const type = this.byId.get(typeId);
    if (!type?.spaceId || !type.environmentId) return typeId;
    return this.tryGetByName(type.name, type.spaceId)?.id ?? typeId;
  }

  /** Types available in a scope: its own, plus global ones, in registry order. */
  forSpace(scope: TypeScope): ContentTypeDefinition[] {
    const out: ContentTypeDefinition[] = [];
    const space = spaceOf(scope);
    for (const key of space === null ? [''] : ['', space]) {
      for (const id of this.bySpace.get(key) ?? []) {
        const type = this.byId.get(id);
        if (type && this.inScope(type, scope)) out.push(type);
      }
    }
    if (space !== null) {
      out.sort((a, b) => (this.rank.get(a.id) ?? 0) - (this.rank.get(b.id) ?? 0));
    }
    return out;
  }

  /**
   * Whether a type is available in a scope: global types everywhere, a space's production
   * types in production, a staging environment's types and the space's code types there.
   */
  inScope(type: ContentTypeDefinition, scope: TypeScope): boolean {
    if (type.spaceId === null) return true;
    if (type.spaceId !== spaceOf(scope)) return false;
    const staging = stagingOf(scope);
    if (!staging) return !type.environmentId;
    return type.environmentId === staging || (!type.environmentId && type.source === 'code');
  }

  /**
   * Changes when a type available in the scope changes; keys per-scope schema caches. The
   * same types give the same digest in any order, so processes agree however they loaded.
   */
  schemaVersionOf(scope: TypeScope): string {
    const key = `${spaceOf(scope) ?? 'global'}:${stagingOf(scope) ?? ''}`;
    let digest = this.digests.get(key);
    if (digest === undefined) {
      const types = this.forSpace(scope).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      digest = fnv1a(JSON.stringify(types));
      this.digests.set(key, digest);
    }
    return digest;
  }

  /** Every type, in registry order. */
  get all(): ContentTypeDefinition[] {
    return [...this.byId.values()];
  }

  get blockTypes(): ContentTypeDefinition[] {
    return this.all.filter((type) => type.kind === 'block');
  }

  /** Types whose documents are stored: tree documents and databags. */
  get contentTypes(): ContentTypeDefinition[] {
    return this.all.filter(isDocumentType);
  }

  get dataTypes(): ContentTypeDefinition[] {
    return this.all.filter((type) => type.kind === 'data');
  }

  /** Bumped on every mutation; keys the GraphQL schema cache. */
  get schemaVersion(): number {
    return this.version;
  }

  field(typeId: string, fieldName: string): FieldDefinition {
    const type = this.get(typeId);
    const field = type.fields.find((candidate) => candidate.name === fieldName);
    if (!field) {
      throw ManabloxError.notFound('contentType.field.notFound', {
        contentType: type.name,
        field: fieldName,
      });
    }
    return field;
  }

  /** Column-stored fields per content type, for generated migrations. */
  promotedColumns(): Map<string, FieldDefinition[]> {
    const out = new Map<string, FieldDefinition[]>();
    for (const type of this.all) {
      const promoted = type.fields.filter((field) => {
        const fieldType = this.fieldTypes.tryGet(field.type);
        return fieldType ? resolveStorage(fieldType, field.settings).kind === 'column' : false;
      });
      if (promoted.length > 0) out.set(type.id, promoted);
    }
    return out;
  }

  /** Checks field types exist, GraphQL names are unique and block fields target block types. */
  validate(): void {
    for (const type of this.all) this.validateType(type);
  }

  private validateType(type: ContentTypeDefinition): void {
    const gqlName = graphqlTypeName(type.name);
    const names = this.graphqlNames.get(gqlName);
    if (names && names.size > 1) {
      const clash = [...names.keys()].find((name) => name !== type.name) as string;
      throw ManabloxError.conflict('contentType.graphqlName.duplicate', {
        a: clash,
        b: type.name,
        graphqlName: gqlName,
      });
    }
    for (const field of type.fields) {
      if (!this.fieldTypes.has(field.type)) {
        throw ManabloxError.notFound('contentType.field.type.notFound', {
          contentType: type.name,
          field: field.name,
          fieldType: field.type,
        });
      }
    }
  }

  /** Puts a type in; `unindexed` when the one it replaces already left the indexes. */
  private insert(type: ContentTypeDefinition, unindexed = false): void {
    const key = this.nameKey(type);
    const existingId = this.byName.get(key);
    if (existingId && existingId !== type.id) {
      throw ManabloxError.conflict('contentType.name.duplicate', {
        name: type.name,
        spaceId: type.spaceId,
      });
    }
    const before = unindexed ? undefined : this.byId.get(type.id);
    // Setting an id already in keeps its place in `byId` and its rank.
    if (before) this.unindex(before);
    this.byId.set(type.id, type);
    this.byName.set(key, type.id);
    const space = type.spaceId ?? '';
    let ids = this.bySpace.get(space);
    if (!ids) {
      ids = new Set();
      this.bySpace.set(space, ids);
    }
    ids.add(type.id);
    if (!this.rank.has(type.id)) this.rank.set(type.id, this.nextRank++);
    const gqlName = graphqlTypeName(type.name);
    let names = this.graphqlNames.get(gqlName);
    if (!names) {
      names = new Map();
      this.graphqlNames.set(gqlName, names);
    }
    names.set(type.name, (names.get(type.name) ?? 0) + 1);
  }

  /** Takes a type out of the registry. */
  private drop(type: ContentTypeDefinition): void {
    this.unindex(type);
    this.byId.delete(type.id);
    this.rank.delete(type.id);
  }

  /** Takes a type out of the name, space and GraphQL name indexes. */
  private unindex(type: ContentTypeDefinition): void {
    if (this.byName.get(this.nameKey(type)) === type.id) this.byName.delete(this.nameKey(type));
    this.bySpace.get(type.spaceId ?? '')?.delete(type.id);
    const gqlName = graphqlTypeName(type.name);
    const names = this.graphqlNames.get(gqlName);
    const left = (names?.get(type.name) ?? 0) - 1;
    if (names && left > 0) names.set(type.name, left);
    else names?.delete(type.name);
    if (names?.size === 0) this.graphqlNames.delete(gqlName);
  }

  /** A change of these spaces' types (`null` for global ones, which every scope sees). */
  private changed(spaces: ReadonlyArray<string | null>): void {
    this.version++;
    if (spaces.includes(null)) {
      this.digests = new Map();
      return;
    }
    for (const key of [...this.digests.keys()]) {
      if (spaces.some((space) => key.startsWith(`${space}:`))) this.digests.delete(key);
    }
  }

  private nameKey(type: ContentTypeDefinition): string {
    return `${(type.spaceId && type.environmentId) || type.spaceId || 'global'}:${type.name}`;
  }
}

function spaceOf(scope: TypeScope): string | null {
  return scope === null || typeof scope === 'string' ? scope : scope.spaceId;
}

function stagingOf(scope: TypeScope): string | null {
  return scope && typeof scope !== 'string' && !scope.production ? scope.environmentId : null;
}
