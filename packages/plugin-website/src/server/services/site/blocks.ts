import type {
  ContentTypeDefinition,
  PluginBlockInstance,
  PluginBlockPublicApi,
  PluginContentTypeData,
  PluginDataIssue,
} from '@manablox/core';
import {
  type BlockInstanceDesign,
  hasBlockDesign,
  type SiteIssue,
  validateInstanceDesign,
  validateSiteDesign,
} from '@manablox/site';

const issuesOf = (list: readonly SiteIssue[]): PluginDataIssue[] =>
  list.map((issue) => ({
    path: issue.path
      ? issue.path.split('.').map((key) => (/^\d+$/.test(key) ? Number(key) : key))
      : [],
    message: issue.message,
  }));

/** A block's design at `ext.website`: a variant and style overrides. */
export const websiteBlockInstance: PluginBlockInstance = {
  validate: (value) => {
    const result = validateInstanceDesign(value);
    return result.ok ? [] : issuesOf(result.issues);
  },
};

/** Delivers a block's design as `design`, where it has a variant or a style. */
export const websiteBlockDelivery: PluginBlockPublicApi = {
  field: 'design',
  serialize: (value) => (hasBlockDesign(value as BlockInstanceDesign | null) ? value : undefined),
};

/** A code block type's `BlockDesign` at `plugins.website`. */
export const websiteTypeData: PluginContentTypeData = {
  validate: (value, type: ContentTypeDefinition) => {
    if (type.kind !== 'block') return [{ message: 'only block types may bring a design' }];
    const result = validateSiteDesign('block', value);
    return result.ok ? [] : issuesOf(result.issues);
  },
};
