import { ManabloxError } from './errors.js';
import { isMachineName } from './ids.js';
import { graphqlTypeName, humanise } from './names.js';
import { stableId } from './stable-id.js';
import type {
  ContentTypeDefinition,
  ContentTypeKind,
  FieldAdminSettings,
  FieldDefinition,
  Loose,
} from './types.js';

export interface FieldInput {
  id?: string | undefined;
  name: string;
  label?: string | undefined;
  type: string;
  settings?: Record<string, unknown> | undefined;
  required?: boolean | undefined;
  localized?: boolean | undefined;
  unique?: boolean | undefined;
  readRoles?: string[] | undefined;
  writeRoles?: string[] | undefined;
  admin?: Loose<FieldAdminSettings> | undefined;
}

export interface ContentTypeInput {
  id?: string | undefined;
  name: string;
  label?: string | undefined;
  description?: string | undefined;
  icon?: string | undefined;
  kind?: ContentTypeKind | undefined;
  spaceId?: string | null | undefined;
  /** A staging environment of `spaceId`; absent for production. */
  environmentId?: string | null | undefined;
  hasSlug?: boolean | undefined;
  isPublishable?: boolean | undefined;
  isVisibleInTree?: boolean | undefined;
  canBeVisibleInMenu?: boolean | undefined;
  requiresApproval?: boolean | undefined;
  /** Only set by the built-in types in `system-types.ts`. */
  isSystem?: boolean | undefined;
  fields: FieldInput[];
  /** Data for plugins by plugin id; each plugin checks its own entry. */
  plugins?: Record<string, unknown> | undefined;
}

/** A type's default id: from space and name, or from a staging environment and name. */
export function contentTypeId(
  spaceId: string | null,
  name: string,
  stagingId?: string | null,
): string {
  return stableId(
    'contentType',
    `${stagingId && spaceId ? stagingId : (spaceId ?? 'global')}:${name}`,
  );
}

export function normaliseField(
  typeName: string,
  input: FieldInput,
  index: number,
): FieldDefinition {
  if (!isMachineName(input.name)) {
    throw ManabloxError.badRequest('contentType.field.name.invalid', {
      contentType: typeName,
      field: input.name,
    });
  }

  return {
    id: input.id ?? stableId(`field:${typeName}`, input.name),
    name: input.name,
    label: input.label ?? humanise(input.name),
    type: input.type,
    settings: input.settings ?? {},
    required: input.required ?? false,
    localized: input.localized ?? false,
    unique: input.unique ?? false,
    ...(input.readRoles ? { readRoles: input.readRoles } : {}),
    ...(input.writeRoles ? { writeRoles: input.writeRoles } : {}),
    admin: {
      zone: input.admin?.zone ?? 'main',
      width: input.admin?.width ?? 100,
      position: input.admin?.position ?? index,
      ...(input.admin?.help !== undefined ? { help: input.admin.help } : {}),
      ...(input.admin?.placeholder !== undefined ? { placeholder: input.admin.placeholder } : {}),
    },
  };
}

/** Declares a content type in code, in the same shape the admin persists. */
export function defineContentType(input: ContentTypeInput): ContentTypeDefinition {
  if (!isMachineName(input.name)) {
    throw ManabloxError.badRequest('contentType.name.invalid', { name: input.name });
  }

  const kind = input.kind ?? 'content';
  const isBlock = kind === 'block';

  // Block types cannot be routed or published on their own.
  if (
    isBlock &&
    (input.hasSlug ||
      input.isPublishable ||
      input.isVisibleInTree ||
      input.canBeVisibleInMenu ||
      input.requiresApproval)
  ) {
    throw ManabloxError.badRequest('contentType.block.flagsNotAllowed', { name: input.name });
  }

  // Data documents are flat records: no URL, no tree, no menu.
  const isData = kind === 'data';
  if (isData && (input.hasSlug || input.isVisibleInTree || input.canBeVisibleInMenu)) {
    throw ManabloxError.badRequest('contentType.data.flagsNotAllowed', { name: input.name });
  }

  const seen = new Set<string>();
  const fields = input.fields.map((field, index) => {
    if (seen.has(field.name)) {
      throw ManabloxError.conflict('contentType.field.name.duplicate', {
        contentType: input.name,
        field: field.name,
      });
    }
    seen.add(field.name);
    return normaliseField(input.name, field, index);
  });

  return {
    id: input.id ?? contentTypeId(input.spaceId ?? null, input.name, input.environmentId),
    name: input.name,
    label: input.label ?? humanise(input.name),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.icon !== undefined ? { icon: input.icon } : {}),
    kind,
    spaceId: input.spaceId ?? null,
    ...(input.spaceId && input.environmentId ? { environmentId: input.environmentId } : {}),
    hasSlug: isBlock || isData ? false : (input.hasSlug ?? true),
    isPublishable: isBlock ? false : (input.isPublishable ?? true),
    isVisibleInTree: isBlock || isData ? false : (input.isVisibleInTree ?? true),
    canBeVisibleInMenu: isBlock || isData ? false : (input.canBeVisibleInMenu ?? true),
    // No approval without publishing.
    requiresApproval:
      isBlock || input.isPublishable === false ? false : (input.requiresApproval ?? false),
    isSystem: input.isSystem ?? false,
    fields,
    ...(input.plugins !== undefined ? { plugins: input.plugins } : {}),
    source: 'code',
  };
}

export { graphqlTypeName };
