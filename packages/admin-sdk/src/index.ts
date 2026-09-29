/** The admin's public surface for admin plugins; semver-stable. */

export { default as ContentPicker } from './components/ContentPicker.vue';
export { default as FeatureGate } from './components/feature/FeatureGate.vue';
export { default as FeatureLock } from './components/feature/FeatureLock.vue';
export { default as HostVerification } from './components/HostVerification.vue';
export { default as Icon } from './components/Icon.vue';
export { default as EditorHeader } from './components/layout/EditorHeader.vue';
export { default as EntityPanel } from './components/layout/EntityPanel.vue';
export { default as SettingsBlock } from './components/layout/SettingsBlock.vue';
export { default as SettingsPage } from './components/layout/SettingsPage.vue';
export { default as PageHeader } from './components/PageHeader.vue';
export { default as PluginSlot } from './components/PluginSlot.vue';
export { default as Accordion } from './components/ui/Accordion.vue';
export { default as AsyncList } from './components/ui/AsyncList.vue';
export { default as Checkbox } from './components/ui/Checkbox.vue';
export { default as CheckCard } from './components/ui/CheckCard.vue';
export { default as ChipFieldset } from './components/ui/ChipFieldset.vue';
export { default as ChipToggle } from './components/ui/ChipToggle.vue';
export { default as ConfirmDialog } from './components/ui/ConfirmDialog.vue';
export { default as CopyField } from './components/ui/CopyField.vue';
export { default as DataTable } from './components/ui/DataTable.vue';
export { default as Dialog } from './components/ui/Dialog.vue';
export { default as DropdownMenu } from './components/ui/DropdownMenu.vue';
export { default as EmptyState } from './components/ui/EmptyState.vue';
export { default as FormDialog } from './components/ui/FormDialog.vue';
export { default as FormField } from './components/ui/FormField.vue';
export { default as IconButton } from './components/ui/IconButton.vue';
export { default as IconPicker } from './components/ui/IconPicker.vue';
export { default as JsonBlock } from './components/ui/JsonBlock.vue';
export { default as Kbd } from './components/ui/Kbd.vue';
export { default as KeyValueList } from './components/ui/KeyValueList.vue';
export { default as Loader } from './components/ui/Loader.vue';
export { default as LocalePicker } from './components/ui/LocalePicker.vue';
export { default as MimeTypePicker } from './components/ui/MimeTypePicker.vue';
export { default as NavList } from './components/ui/NavList.vue';
export { default as NavListItem } from './components/ui/NavListItem.vue';
export { default as NewButton } from './components/ui/NewButton.vue';
export { default as NumberField } from './components/ui/NumberField.vue';
export { default as PageLoader } from './components/ui/PageLoader.vue';
export { default as Pager } from './components/ui/Pager.vue';
export { default as PageState } from './components/ui/PageState.vue';
export { default as Panel } from './components/ui/Panel.vue';
export { default as Popover } from './components/ui/Popover.vue';
export { default as ProgressBar } from './components/ui/ProgressBar.vue';
export { default as Radio } from './components/ui/Radio.vue';
export { default as RadioCard } from './components/ui/RadioCard.vue';
export { default as SaveButton } from './components/ui/SaveButton.vue';
export { default as ScheduleFields } from './components/ui/ScheduleFields.vue';
export { default as SearchField } from './components/ui/SearchField.vue';
export { default as SectionIntro } from './components/ui/SectionIntro.vue';
export { default as SegmentedControl } from './components/ui/SegmentedControl.vue';
export { default as Select } from './components/ui/Select.vue';
export { default as SettingsAccordion } from './components/ui/SettingsAccordion.vue';
export { default as Skeleton } from './components/ui/Skeleton.vue';
export { default as SortHeader } from './components/ui/SortHeader.vue';
export { default as StatusBadge } from './components/ui/StatusBadge.vue';
export { default as StringList } from './components/ui/StringList.vue';
export { default as Switch } from './components/ui/Switch.vue';
export { default as Tabs } from './components/ui/Tabs.vue';
export { default as TextareaField } from './components/ui/TextareaField.vue';
export { default as TextField } from './components/ui/TextField.vue';
export { default as Tip } from './components/ui/Tip.vue';
// UI kit
export type {
  ChipOption,
  DataColumn,
  SegmentedOption,
  SelectOption,
  SettingsAccordionItem,
  TabItem,
} from './components/ui/types';
// Composables
export { useBreadcrumb } from './composables/useBreadcrumb';
export {
  type DraftFormOptions,
  type ErrorFor,
  scoped,
  useDraftForm,
} from './composables/useDraftForm';
export {
  type EditorForm,
  type EditorFormOptions,
  useEditorForm,
} from './composables/useEditorForm';
export { type EditorShortcuts, useEditorShortcuts } from './composables/useEditorShortcuts';
export {
  type JsonFilePick,
  type JsonFilePickOptions,
  useJsonFilePick,
} from './composables/useJsonFilePick';
export {
  type PagedQuery,
  type PageRequest,
  useSpacePagedQuery,
} from './composables/usePagedQuery';
export { type PanelKey, usePanel } from './composables/usePanel';
export { useShortcuts } from './composables/useShortcuts';
export { useUnsavedGuard } from './composables/useUnsavedGuard';
export { default as AssetPicker } from './features/assets/components/AssetPicker.vue';
export { assets, useAssetsByIds, useAssetsPaged } from './features/assets/queries';
// Queries
export { BREAKPOINTS } from './features/content/model/block-grid';
export type { DraftDocument } from './features/content/model/draft';
export {
  content,
  useContentByIds,
  useContentSearch,
  useTreeChildren,
} from './features/content/queries';
export { contentTypes, useContentTypes } from './features/content-types/queries';
export { default as CredentialPicker } from './features/credentials/components/CredentialPicker.vue';
export { useCredentials } from './features/credentials/queries';
export { isProduction } from './features/environments/model';
export type { Environment } from './features/environments/queries';
export { useEnvironmentChoice } from './features/environments/useEnvironmentChoice';
export { menus, useMenu, useMenus } from './features/menus/queries';

// API client
export { api, pluginClient } from './lib/api';
export {
  type ApiErrorDetail,
  errorDetails,
  errorKey,
  isNotFound,
} from './lib/api-errors';
export { SDK_API_LEVEL } from './lib/api-level';
export type {
  Asset,
  ContentDocument,
  ContentListItem,
  ContentTypeSummary,
  FieldDefinition,
  MenuDetail,
  Space,
  UsageOverview,
} from './lib/api-types';
// Stores and helpers
export { COPIED_URL, copyText } from './lib/clipboard';
export { plainClone } from './lib/clone';
export { moveInList, toggleInList, toggleInSet } from './lib/collections';
export { type ConfirmOptions, confirm } from './lib/confirm';
export { downloadBlob, downloadFile } from './lib/download';
export { environmentOf } from './lib/environment';
export type { FeatureState } from './lib/features';
export {
  type FieldContext,
  type FieldContextDocument,
  provideFieldContext,
  useFieldContext,
} from './lib/field-context';
export { focusFirstFieldSoon } from './lib/focus';
export {
  dayLabel,
  formatBytes,
  formatDate,
  formatDateTime,
  formatTime,
  plural,
  relativeTime,
} from './lib/format';
export {
  BlockEditor,
  BlockGridBoard,
  FieldGrid,
  FieldInput,
  FieldRenderer,
  htmlToRichText,
} from './lib/host';
export { previewHostname } from './lib/hostnames';
export { TYPE_ICON_NAMES } from './lib/icon-names';
export {
  type InvalidatedKind,
  invalidate,
  onInvalidated,
  type PluginKeys,
  pluginKeys,
} from './lib/invalidate';
export { keys } from './lib/keys';
export { type LocaleOption, localeName, localeOptions } from './lib/locales';
export { hasMessage, messageFor, messageForKey } from './lib/messages';
export { type PluginSlotItem, slotEntries, usePluginApi, useSlotEntries } from './lib/plugin-slots';
export { queryClient } from './lib/query-client';
export { formatKeys, type Shortcut, shortcutHint } from './lib/shortcuts';
export { requireSpace, useCan, useFeature } from './lib/space';
export { required, type SpaceRef, useSpaceQuery } from './lib/space-query';
export { toast } from './lib/toast';
export { typeIcon } from './lib/type-icon';
export { confirmAndRun, runWrite, type WriteFeedback } from './lib/write';
export { optimistic, spaceWrites } from './lib/writes';
export { useSessionStore } from './stores/session';
export { useSpaceStore } from './stores/space';
export { useUiStore } from './stores/ui';
