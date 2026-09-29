import {
  auditor,
  type ContentTypeDefinition,
  type ContentTypeInput,
  type ContentTypeKind,
  type ContentTypePlan,
  type ContentTypePlanType,
  contentTypeId,
  diffRecords,
  environmentCacheTag,
  type FieldInput,
  fieldSubFields,
  fieldTypeReferences,
  isDocumentType,
  isMachineName,
  ManabloxError,
  mapFieldTypeReferences,
  planCreationOrder,
  purgeTags,
  type ResolvedScope,
  scopeSpaceId,
  snapshotChanges,
  stagingIdOf,
  type TypeScope,
  ValidationCollector,
  validateFieldSettings,
} from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import {
  inTransaction,
  type Repositories,
  type TransactionRepositories,
  transactionKey,
} from '@manablox/db';
import type { RoleService } from './role.service.js';

/** How many repeaters deep sub-fields may nest, the outermost included. */
const MAX_SUB_FIELD_DEPTH = 2;

/** Creates and edits runtime content types, reloading the registry. */
export class ContentTypeService {
  private readonly audit;
  /** The repositories outside any transaction, for work after commit. */
  private root: Repositories;

  constructor(
    private readonly manablox: Manablox,
    private readonly repos: Repositories,
    /** Keeps role grants in step with types. */
    private readonly roles: RoleService,
  ) {
    this.audit = auditor(
      repos,
      'contentType',
      (type: ContentTypeDefinition) => type.label ?? type.name,
    );
    this.root = repos;
  }

  /**
   * This service on a transaction's repositories. Its writes load the registry at once so
   * later work in the transaction sees the types; after a rollback the caller reloads it.
   */
  using(repos: Repositories): ContentTypeService {
    const service = new ContentTypeService(this.manablox, repos, this.roles.using(repos));
    service.root = this.root;
    return service;
  }

  /** Global types plus the scope's; a space id alone is its production types. */
  list(scope: TypeScope = null): ContentTypeDefinition[] {
    return this.manablox.contentTypes.forSpace(scope);
  }

  /** A type of the scope or a global one; another space's or environment's type is not found. */
  get(scope: string | ResolvedScope, id: string): ContentTypeDefinition {
    const type = this.manablox.contentTypes.tryGet(id);
    if (!type || !this.manablox.contentTypes.inScope(type, scope)) {
      throw ManabloxError.notFound('contentType.notFound', { id });
    }
    return type;
  }

  /**
   * Per-type roles of `createdBy` are granted the new type. In a staging `scope` the type
   * belongs to that environment, its default id derived from it.
   */
  async create(
    input: ContentTypeInput,
    createdBy: string | null = null,
    scope?: string | ResolvedScope,
  ): Promise<ContentTypeDefinition> {
    const staging = input.spaceId ? stagingIdOf(scope) : null;
    const scoped = staging ? { ...input, environmentId: staging } : input;
    const hooked = await this.manablox.hooks.run('contentType:beforeCreate', scoped, {
      manablox: this.manablox,
      spaceId: scoped.spaceId ?? null,
      ...(staging ? { environmentId: staging } : {}),
    });
    const target = typeScopeOf(hooked, scope);
    await this.validate(hooked, undefined, target);
    await this.assertFeatures(hooked);
    await this.assertTypeLimits(target, [hooked.kind ?? 'content']);

    const definition = await this.repos.transaction(async (tx) => {
      const definition = await tx.contentTypes.create(
        hooked,
        typeof target === 'object' && target ? target.environmentId : null,
      );
      if (createdBy && definition.spaceId) {
        await this.roles.using(tx).grantContentType(definition.spaceId, definition.id, createdBy);
      }
      await this.written(tx, definition, 'contentType:afterCreate');
      await this.audit
        .in(tx)
        .record('contentType.create', definition, snapshotChanges(definition, 'created'));
      return definition;
    });
    return this.manablox.contentTypes.get(definition.id);
  }

  async update(
    scope: string | ResolvedScope,
    id: string,
    input: ContentTypeInput,
  ): Promise<ContentTypeDefinition> {
    const existing = this.get(scope, id);
    if (existing.source === 'code') {
      throw ManabloxError.forbidden('contentType.code.immutable', { name: existing.name });
    }

    const hooked = await this.manablox.hooks.run('contentType:beforeUpdate', input, {
      manablox: this.manablox,
      spaceId: existing.spaceId,
      ...(existing.environmentId ? { environmentId: existing.environmentId } : {}),
      previous: existing,
    });
    await this.validate(hooked, id, typeScopeOf(existing, scope));
    await this.assertFeatures(hooked, existing);
    const definition = await this.repos.transaction(async (tx) => {
      const definition = await tx.contentTypes.update(id, hooked);
      await this.written(tx, definition, 'contentType:afterUpdate');
      await this.audit
        .in(tx)
        .record('contentType.update', definition, diffRecords(existing, definition));
      return definition;
    });
    return this.manablox.contentTypes.get(definition.id);
  }

  /**
   * Creates types that reference each other by name, all or nothing: validated first,
   * block types created first, rolled back on failure. References may be plan names,
   * existing names or ids.
   */
  async applyPlan(
    scope: string | ResolvedScope,
    plan: ContentTypePlan,
    createdBy: string | null = null,
  ): Promise<ContentTypeDefinition[]> {
    const spaceId = scopeSpaceId(scope);
    const staging = stagingIdOf(scope);
    const collector = new ValidationCollector();
    if (!plan.types.length) collector.add('contentType.plan.empty', ['types']);

    // Ids derive from space and name.
    const planned = new Map<string, { id: string; kind: 'content' | 'block' }>();
    for (const [index, type] of plan.types.entries()) {
      if (planned.has(type.name)) {
        collector.add('contentType.plan.name.duplicate', ['types', index, 'name'], {
          name: type.name,
        });
        continue;
      }
      planned.set(type.name, {
        id: contentTypeId(spaceId, type.name, staging),
        kind: isDocumentType(type) ? 'content' : 'block',
      });
    }

    const resolve = (value: string): { id: string; kind: 'content' | 'block' } | null => {
      const inPlan = planned.get(value);
      if (inPlan) return inPlan;
      const existing =
        this.manablox.contentTypes.tryGetByName(value, scope) ??
        this.manablox.contentTypes.tryGet(value);
      if (!existing || !this.manablox.contentTypes.inScope(existing, scope)) return null;
      // A databag is a valid relation target, like any document type.
      return { id: existing.id, kind: isDocumentType(existing) ? 'content' : 'block' };
    };

    const inputs = new Map<string, ContentTypeInput>();
    for (const [index, type] of plan.types.entries()) {
      for (const [fieldIndex, field] of type.fields.entries()) {
        for (const reference of fieldTypeReferences(field)) {
          const target = resolve(reference.name);
          const path = [
            'types',
            index,
            'fields',
            fieldIndex,
            'settings',
            ...reference.key.split('.').map((part) => (/^\d+$/.test(part) ? Number(part) : part)),
          ];
          if (!target) {
            collector.add('contentType.plan.reference.unknown', path, { name: reference.name });
          } else if (target.kind !== reference.target) {
            collector.add('contentType.plan.reference.wrongKind', path, {
              name: reference.name,
              expected: reference.target,
            });
          }
        }
      }
      inputs.set(
        type.name,
        this.planInput(spaceId, type, (value) => resolve(value)?.id ?? null),
      );
    }
    collector.throwIfAny('contentType.validation.failed');

    // The checks `create` runs, minus block types that do not exist yet.
    for (const [index, type] of plan.types.entries()) {
      const input = inputs.get(type.name);
      if (!input) continue;
      try {
        await this.validate(
          { ...input, fields: input.fields.filter((field) => !isNested(field)) },
          undefined,
          scope,
        );
      } catch (error) {
        if (!ManabloxError.is(error)) throw error;
        for (const detail of error.details) {
          collector.add(
            detail.key as never,
            ['types', index, ...(detail.path ?? [])],
            detail.params,
          );
        }
      }
    }
    collector.throwIfAny('contentType.validation.failed');
    await this.assertTypeLimits(
      scope,
      plan.types.map((type) => type.kind ?? 'content'),
    );

    const { order, cyclic } = planCreationOrder(plan);
    const ids = await this.repos.transaction(async (tx) => {
      const types = this.using(tx);
      const created: string[] = [];
      for (const type of order) {
        const input = inputs.get(type.name) as ContentTypeInput;
        // Cyclic block fields are added once every type in the cycle exists.
        const fields = cyclic.has(type.name)
          ? input.fields.filter((field) => !refersToAny(field, cyclic, planned))
          : input.fields;
        created.push((await types.create({ ...input, fields }, createdBy, scope)).id);
      }
      for (const name of cyclic) {
        const input = inputs.get(name) as ContentTypeInput;
        await types.update(scope, planned.get(name)?.id as string, input);
      }
      return created;
    });
    return ids.map((id) => this.manablox.contentTypes.get(id));
  }

  /** A plan type with references resolved to ids. */
  private planInput(
    spaceId: string,
    type: ContentTypePlanType,
    idOf: (value: string) => string | null,
  ): ContentTypeInput {
    const isBlock = !isDocumentType(type);
    const isData = type.kind === 'data';
    return {
      name: type.name,
      ...(type.label ? { label: type.label } : {}),
      ...(type.description ? { description: type.description } : {}),
      ...(type.icon ? { icon: type.icon } : {}),
      kind: type.kind,
      spaceId,
      ...(isBlock
        ? {}
        : {
            // Databags have no URL, tree or menu; those flags are dropped.
            ...(type.hasSlug === undefined || isData ? {} : { hasSlug: type.hasSlug }),
            ...(type.isPublishable === undefined ? {} : { isPublishable: type.isPublishable }),
            ...(type.isVisibleInTree === undefined || isData
              ? {}
              : { isVisibleInTree: type.isVisibleInTree }),
            ...(type.canBeVisibleInMenu === undefined || isData
              ? {}
              : { canBeVisibleInMenu: type.canBeVisibleInMenu }),
            ...(type.requiresApproval === undefined
              ? {}
              : { requiresApproval: type.requiresApproval }),
          }),
      fields: type.fields.map(
        (field, position): FieldInput => ({
          ...mapFieldTypeReferences(
            {
              name: field.name,
              ...(field.label ? { label: field.label } : {}),
              type: field.type,
              settings: field.settings ?? {},
              required: field.required ?? false,
              localized: field.localized ?? false,
              unique: field.unique ?? false,
            },
            idOf,
          ),
          admin: {
            zone: field.admin?.zone === 'sidebar' ? 'sidebar' : 'main',
            width: field.admin?.width ?? 100,
            position,
            ...(field.admin?.help ? { help: field.admin.help } : {}),
            ...(field.admin?.placeholder ? { placeholder: field.admin.placeholder } : {}),
          },
        }),
      ),
    };
  }

  async delete(scope: string | ResolvedScope, id: string): Promise<void> {
    const existing = this.get(scope, id);
    if (existing.source === 'code') {
      throw ManabloxError.forbidden('contentType.code.immutable', { name: existing.name });
    }
    if (existing.kind === 'data') {
      await this.manablox.controls.assertFeature(existing.spaceId, 'databags');
    }

    const inUse = await this.repos.content.page(
      {
        ...(existing.environmentId && existing.spaceId
          ? { spaceId: existing.spaceId, environmentId: existing.environmentId }
          : {}),
        typeIds: [id],
      },
      { limit: 1, offset: 0 },
    );
    if (inUse.total > 0) {
      throw ManabloxError.conflict('contentType.inUse', {
        name: existing.name,
        count: inUse.total,
      });
    }

    await this.repos.transaction(async (tx) => {
      await tx.contentTypes.delete(id);
      await this.roles.using(tx).pruneContentType(id);
      await this.written(tx, existing, 'contentType:afterDelete');
      await this.audit
        .in(tx)
        .record('contentType.delete', existing, snapshotChanges(existing, 'deleted'));
    });
  }

  /** Databags need `databags`; switching `requiresApproval` on needs `approvals`. */
  /** `contentTypes` (content and block) and `databagTypes` limits, for all the new types at once. */
  async assertTypeLimits(spaceId: TypeScope, kinds: readonly ContentTypeKind[]): Promise<void> {
    // Global types are config, not counted.
    if (!spaceId) return;
    const data = kinds.filter((kind) => kind === 'data').length;
    if (kinds.length > data) {
      await this.manablox.controls.assertLimit(spaceId, 'contentTypes', {
        increment: kinds.length - data,
      });
    }
    if (data > 0) {
      await this.manablox.controls.assertLimit(spaceId, 'databagTypes', { increment: data });
    }
  }

  private async assertFeatures(
    input: ContentTypeInput,
    existing?: ContentTypeDefinition,
  ): Promise<void> {
    const spaceId = existing ? existing.spaceId : (input.spaceId ?? null);
    if (input.kind === 'data' || existing?.kind === 'data') {
      await this.manablox.controls.assertFeature(spaceId, 'databags');
    }
    if (input.requiresApproval && !existing?.requiresApproval) {
      await this.manablox.controls.assertFeature(spaceId, 'approvals');
    }
  }

  /**
   * Queues the hook, registry reload and purge for after commit; inside an outer transaction
   * the registry also stages the transaction's types until it ends.
   */
  private async written(
    tx: TransactionRepositories,
    definition: ContentTypeDefinition,
    hook: 'contentType:afterCreate' | 'contentType:afterUpdate' | 'contentType:afterDelete',
  ): Promise<void> {
    const spaceId = definition.spaceId;
    if (inTransaction(this.repos)) {
      const key = transactionKey(tx);
      if (await this.manablox.stage(key, spaceId, await tx.contentTypes.listOfSpace(spaceId))) {
        tx.afterEnd(() => this.manablox.unstage(key));
      }
    }
    tx.afterCommit(async () => {
      const context = {
        manablox: this.manablox,
        spaceId: definition.spaceId,
        ...(definition.environmentId ? { environmentId: definition.environmentId } : {}),
      };
      if (hook === 'contentType:afterDelete') {
        await this.reloadSpace(spaceId);
        await this.manablox.hooks.run(hook, definition, context);
      } else {
        await this.manablox.hooks.run(hook, definition, context);
        await this.reloadSpace(spaceId);
      }
      await this.purge(definition);
    });
  }

  /** Validates the shape and every field's settings; names are unique in the scope's type set. */
  async validate(
    input: ContentTypeInput,
    existingId?: string,
    scope: TypeScope = input.spaceId ?? null,
  ): Promise<void> {
    const collector = new ValidationCollector();

    if (!isMachineName(input.name)) collector.add('contentType.name.invalid', ['name']);

    const clash = this.manablox.contentTypes.tryGetByName(input.name, scope);
    if (clash && clash.id !== existingId) collector.add('contentType.name.duplicate', ['name']);

    await this.validateFields(input.fields, ['fields'], collector, 0);

    collector.throwIfAny('contentType.validation.failed');
  }

  /** Checks a field list; sub-fields of item fields like repeaters recurse under `settings.fields`. */
  private async validateFields(
    fields: FieldInput[],
    at: (string | number)[],
    collector: ValidationCollector,
    depth: number,
  ): Promise<void> {
    const seen = new Set<string>();

    for (const [index, field] of fields.entries()) {
      const path = [...at, index];

      if (!isMachineName(field.name))
        collector.add('contentType.field.name.invalid', [...path, 'name']);
      if (seen.has(field.name))
        collector.add('contentType.field.name.duplicate', [...path, 'name']);
      seen.add(field.name);

      const fieldType = this.manablox.fieldTypes.tryGet(field.type);
      if (!fieldType) {
        collector.add('contentType.field.type.notFound', [...path, 'type'], { type: field.type });
        continue;
      }

      const result = await validateFieldSettings(fieldType, field.settings ?? {});
      if (!result.issues.isEmpty) {
        collector.merge([...result.issues.all], [...path, 'settings']);
        continue;
      }

      // Block fields may only reference block types.
      if (fieldType.nested) {
        const referenced = collectBlockTypeIds(field.settings ?? {});
        for (const typeId of referenced) {
          const target = this.manablox.contentTypes.tryGet(typeId);
          if (!target)
            collector.add('contentType.field.blockType.notFound', [...path, 'settings'], {
              typeId,
            });
          else if (target.kind !== 'block') {
            collector.add('contentType.field.blockType.notABlock', [...path, 'settings'], {
              name: target.name,
            });
          }
        }
      }

      const subFields = fieldSubFields(fieldType, field.settings ?? {});
      if (subFields) {
        if (depth + 1 > MAX_SUB_FIELD_DEPTH) {
          collector.add('contentType.field.subFields.tooDeep', [...path, 'settings']);
          continue;
        }
        await this.validateFields(subFields, [...path, 'settings', 'fields'], collector, depth + 1);
      }
    }
  }

  /**
   * Drops cached deliveries of the type and its environment; a global type touches every
   * space.
   */
  private async purge(type: ContentTypeDefinition): Promise<void> {
    if (type.spaceId && type.environmentId) {
      await purgeTags(this.manablox, type.spaceId, [
        `type:${type.id}`,
        environmentCacheTag(type.spaceId, type.environmentId),
      ]);
      return;
    }
    const spaceIds = type.spaceId
      ? [type.spaceId]
      : (await this.root.spaces.list()).map((space) => space.id);
    await purgeTags(this.manablox, type.spaceId ?? null, [
      `type:${type.id}`,
      ...spaceIds.map((spaceId) => `space:${spaceId}`),
    ]);
  }

  /** Reloads the registry from the stored types. */
  async reload(): Promise<void> {
    await this.manablox.reload(await this.root.contentTypes.listAll());
  }

  /** Reloads one space's stored types (the global ones for `null`). */
  private async reloadSpace(spaceId: string | null): Promise<void> {
    await this.manablox.reloadSpace(spaceId, await this.root.contentTypes.listOfSpace(spaceId));
  }
}

/** The type set a type belongs to: its staging environment's, else the scope or its space. */
function typeScopeOf(
  type: Pick<ContentTypeInput, 'spaceId' | 'environmentId'>,
  scope: string | ResolvedScope | undefined,
): TypeScope {
  if (!type.spaceId) return null;
  if (type.environmentId) {
    return { spaceId: type.spaceId, environmentId: type.environmentId, production: false };
  }
  return scope ?? type.spaceId;
}

function collectBlockTypeIds(settings: Record<string, unknown>): string[] {
  const single = typeof settings.type === 'string' ? [settings.type] : [];
  const many = Array.isArray(settings.types)
    ? settings.types.filter((entry): entry is string => typeof entry === 'string')
    : [];
  return [...single, ...many];
}

/** Whether a field embeds blocks, directly or in sub-fields, whose types must exist on save. */
function isNested(field: FieldInput): boolean {
  return fieldTypeReferences(field).some((reference) => reference.target === 'block');
}

/** Whether a field embeds any of these plan types. */
function refersToAny(
  field: FieldInput,
  names: Set<string>,
  planned: Map<string, { id: string }>,
): boolean {
  if (!isNested(field)) return false;
  const ids = new Set([...names].map((name) => planned.get(name)?.id));
  return fieldTypeReferences(field).some((reference) => ids.has(reference.name));
}
