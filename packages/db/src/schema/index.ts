/** The Postgres tables, built from `../definitions`, and their row types. */
export * from './tables.js';

import type {
  apikeys,
  assetSpaces,
  assets,
  assetTags,
  assetUsages,
  assetVariants,
  auditEntries,
  contentApprovals,
  contents,
  contentTags,
  contentTypes,
  contentVersions,
  controlEvents,
  controlSettings,
  credentials,
  instanceMeta,
  invitations,
  memberships,
  menuItems,
  menus,
  notifications,
  pushSubscriptions,
  redirects,
  roles,
  spaceApiHosts,
  spaceEnvironments,
  spaceGroups,
  spacePluginSettings,
  spaces,
  ssoProviders,
  tags,
  usageCounters,
  usageExternal,
  userPreferences,
  users,
} from './tables.js';

export type SpaceRow = typeof spaces.$inferSelect;
export type ContentRow = typeof contents.$inferSelect;
export type ContentInsert = typeof contents.$inferInsert;
export type ContentTypeRow = typeof contentTypes.$inferSelect;
export type AssetRow = typeof assets.$inferSelect;
export type AssetVariantRow = typeof assetVariants.$inferSelect;
export type AssetSpaceRow = typeof assetSpaces.$inferSelect;
export type AssetUsageRow = typeof assetUsages.$inferSelect;
export type TagRow = typeof tags.$inferSelect;
export type ContentTagRow = typeof contentTags.$inferSelect;
export type AssetTagRow = typeof assetTags.$inferSelect;
export type UserRow = typeof users.$inferSelect;
export type MembershipRow = typeof memberships.$inferSelect;
export type RoleRow = typeof roles.$inferSelect;
export type ContentVersionRow = typeof contentVersions.$inferSelect;
export type MenuRow = typeof menus.$inferSelect;
export type MenuItemRow = typeof menuItems.$inferSelect;
export type CredentialRow = typeof credentials.$inferSelect;
export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;
export type AuditEntryRow = typeof auditEntries.$inferSelect;
export type NotificationRow = typeof notifications.$inferSelect;
export type ContentApprovalRow = typeof contentApprovals.$inferSelect;
export type ApiKeyRow = typeof apikeys.$inferSelect;
export type ApiKeyInsert = typeof apikeys.$inferInsert;
export type RedirectRow = typeof redirects.$inferSelect;
export type SpaceApiHostRow = typeof spaceApiHosts.$inferSelect;
export type SpaceGroupRow = typeof spaceGroups.$inferSelect;
export type SpacePluginSettingsRow = typeof spacePluginSettings.$inferSelect;
export type SpaceEnvironmentRow = typeof spaceEnvironments.$inferSelect;
export type ControlSettingRow = typeof controlSettings.$inferSelect;
export type UsageCounterRow = typeof usageCounters.$inferSelect;
export type UsageExternalRow = typeof usageExternal.$inferSelect;
export type ControlEventRow = typeof controlEvents.$inferSelect;
export type InstanceMetaRow = typeof instanceMeta.$inferSelect;
export type InvitationRow = typeof invitations.$inferSelect;
export type SsoProviderRow = typeof ssoProviders.$inferSelect;
export type UserPreferenceRow = typeof userPreferences.$inferSelect;
