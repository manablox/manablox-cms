/** Admin extension contract; `./vite` builds plugin bundles and the dev registry. */
import type {
  Asset,
  ContentTypeSummary,
  DraftDocument,
  FieldContext,
  FieldDefinition,
  Space,
  UsageOverview,
} from '@manablox/admin-sdk';
import type { BlockValue, ContentTypePlanType, RealtimeEvent } from '@manablox/core';

// biome-ignore lint/suspicious/noExplicitAny: a Vue component, without importing Vue here
export type ComponentLoader = () => Promise<{ default: any }>;

export interface AdminRoute {
  path: string;
  name: string;
  component: ComponentLoader;
  /** Render inside the space shell. */
  inSpace?: boolean;
  /** Feature key; switched off, the page shows as locked or unavailable. The plugin's own by default. */
  feature?: string;
  /** More features the page needs besides `feature`. */
  features?: string[];
  /** An editor page, for a new record or an existing one: full width, no side panel. */
  editor?: 'new' | 'edit';
  /** Side panel shown beside the page, a key of `sidePanels`. */
  panel?: string;
  /** The sidebar entry (its `to`) the route belongs to. */
  section?: string;
}

/** A sidebar category. */
export type AdminMenuGroup = 'content' | 'automation' | 'structure' | 'system';

export interface AdminMenuItem {
  label: string;
  icon?: string;
  to: string;
  /** Sidebar category; `content` when absent. */
  group?: AdminMenuGroup;
  /** Lower sorts first within its category. Built-in entries occupy 100, 200, 300... */
  order?: number;
  /** Required space permission. */
  permission?: string;
  /** Key after `g` that jumps here; ignored if a built-in entry has it. */
  shortcut?: string;
  /**
   * Feature key; switched off, the entry is removed (hidden) or shows a lock (locked). Plugin
   * entries default to the plugin's own.
   */
  feature?: string;
}

export interface AdminFieldComponents {
  /** Editor input, keyed by the field type's `admin.input`. */
  inputs?: Record<string, ComponentLoader>;
  /**
   * Settings form, keyed by the field type's `admin.settings`; shown in the type builder
   * below the built-in settings. Props `{ settings, field, readOnly }`; emits
   * `update:settings` with the whole new settings object.
   */
  settings?: Record<string, ComponentLoader>;
}

/** The document editor's state as a view or action sees it. */
export interface ContentEditorDraft {
  readonly isDirty: boolean;
  readonly readOnly: boolean;
  readonly saving: boolean;
  /** Bumped on every edit. */
  readonly revision: number;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  undo(): void;
  redo(): void;
  /** The validation message at a field path, else null. */
  errorFor(path: readonly (string | number)[]): string | null;
  /** Whether an error sits at the path or inside it. */
  errorUnder(path: readonly (string | number)[]): boolean;
  /** Saves the draft; resolves once the write settled. */
  save(): Promise<unknown>;
}

/** The environment the admin works in; `id` is known once the list loaded. */
export interface WorkingEnvironment {
  spaceId: string;
  machineName: string;
  id: string | null;
}

/** The address field of the space creation form. */
export interface SpaceAddressField {
  readonly value: string;
  /** The admin's own default. */
  readonly default: string;
  set(value: string): void;
  /** The field's label and hint; `null` restores the admin's own. */
  describe(text: { label: string; hint: string } | null): void;
}

/** The props each slot hands its entries. */
export interface AdminSlotProps {
  /** Side lists beside plugin pages; an entry's `key` is what a route's `panel` names. */
  'app.sidePanels': Record<string, never>;
  /** Full-screen editor views, opened from a header button with the entry's label and icon. */
  'content.editor.views': {
    document: DraftDocument;
    type: ContentTypeSummary;
    draft: ContentEditorDraft;
    close: () => void;
  };
  /** Buttons in the document editor's header. */
  'content.editor.actions': { document: DraftDocument; type: ContentTypeSummary };
  /** Below a block's fields, in the blocks field and the block field, and beside the preview. */
  'block.inspector': {
    block: BlockValue;
    type: ContentTypeSummary | null;
    path: readonly (string | number)[];
    readOnly: boolean;
    update: (block: BlockValue) => void;
    /** In the preview view's side panel rather than below the block's fields. */
    panel?: boolean;
  };
  /**
   * In the header of the content preview view; an entry may take over the frame with
   * `preview.setTarget`. Nothing is framed until every shown entry has called it once.
   */
  'content.preview.target': {
    document: DraftDocument;
    type: ContentTypeSummary;
    readOnly: boolean;
    preview: AdminPreviewControl;
  };
  /** Buttons in the content type editor's header. */
  'contentType.actions': { type: ContentTypeSummary };
  /** A preset of the new content type form; the component shows below the picker while it is picked. */
  'contentType.presets': {
    draft: Record<string, unknown>;
    setDraft: (patch: Record<string, unknown>) => void;
  };
  /** A part of the space creation form; `draft` is the plugin's own state in that form. */
  'space.create.steps': {
    draft: Record<string, unknown>;
    setDraft: (patch: Record<string, unknown>) => void;
    /** `'space'` in the form's first stage, after the names; `'own'` in the entry's own stage. */
    stage: 'space' | 'own';
    /** Shows or drops the entry's own stage (see `stage` on the entry). */
    setStage: (shown: boolean) => void;
    address: SpaceAddressField;
  };
  /** Panels in the space's General settings. */
  'space.settings.sections': { space: Space };
  /** Next to the API hosts in the space's settings. */
  'space.domains': { space: Space };
  /** Below the export and import section pickers. */
  'transfer.sections': { spaceId: string };
  /** Under the space's usage meters. */
  'usage.lines': { usage: UsageOverview };
  /** Above the activity log. */
  'audit.entities': Record<string, never>;
  /** In the top bar, next to "Visit site": the working environment of the current space. */
  'environment.address': { environment: WorkingEnvironment };
  /** Beside a field's label in the editors; `update` sets the field's value. */
  'field.actions': {
    field: FieldDefinition;
    value: unknown;
    update: (value: unknown) => void;
    context: FieldContext;
  };
  /** In the asset library's header; `added` selects an asset the entry created. */
  'assets.actions': { selection: readonly Asset[]; added: (assetId: string) => void };
  /** In the content type list's header. */
  'contentType.list.actions': Record<string, never>;
  /** In the template list's header. */
  'template.list.actions': Record<string, never>;
  /**
   * A kind of preconfigured space in the space creation form, next to the website types; the
   * component shows below the picker while it is picked.
   */
  'space.create.starters': {
    draft: Record<string, unknown>;
    setDraft: (patch: Record<string, unknown>) => void;
  };
}

export type AdminSlotId = keyof AdminSlotProps;

/** What frames a document in the content preview view instead of the frontend's `/preview` route. */
export interface AdminPreviewTarget {
  /** The page framed; `null` shows `empty` instead. */
  src: string | null;
  /** The framed page's origin, checked on every message. */
  origin: string | null;
  /** Shown instead of the frame while `src` is `null`. */
  empty?: string;
  /** Shown after the connection state in the header, e.g. `generated designs`. */
  status?: string;
  /** Maps the draft's fields before the frame gets them. */
  fields?: (fields: Record<string, unknown>) => Record<string, unknown>;
  /** Runs each time the frame announces itself, before the draft is sent. */
  ready?: (frame: AdminPreviewFrame) => void;
}

/** The document as the preview frame gets it. */
export interface AdminPreviewDocument {
  id: string | null;
  typeId: string;
  typeName: string;
  locale: string;
  title: string;
  slug: string;
  permalink: string | null;
  fields: Record<string, unknown>;
}

/** One plugin's messages with the preview frame (`plugin:<id>` channel of `@manablox/live-preview`). */
export interface AdminPreviewChannel {
  send(name: string, payload: unknown): void;
  on(name: string, handler: (payload: unknown) => void): () => void;
}

/** A connected preview frame; calls do nothing once it is gone. */
export interface AdminPreviewFrame {
  plugin(id: string): AdminPreviewChannel;
  /** The draft as the frame gets it. */
  document(): AdminPreviewDocument | null;
  /** Sends the draft again. */
  sync(): void;
}

/** What a `content.preview.target` entry gets to steer the frame. */
export interface AdminPreviewControl {
  /** Frames `target`; `null` leaves the frontend's preview route. */
  setTarget(target: AdminPreviewTarget | null): void;
}

/** A starting point for a new content type. */
export interface AdminTypePreset {
  /** Also the new type's technical name. */
  id: string;
  kind: 'content' | 'block' | 'data';
  label: string;
  icon: string;
  description: string;
  fields: Array<
    Pick<FieldDefinition, 'name' | 'label' | 'type'> &
      Partial<Pick<FieldDefinition, 'settings' | 'required' | 'localized'>> & {
        zone?: 'main' | 'sidebar';
      }
  >;
  /** Unset means publishable. */
  isPublishable?: boolean;
}

/** What an entry of any slot has. */
export interface AdminSlotEntryBase<K extends AdminSlotId = AdminSlotId> {
  component: ComponentLoader;
  /** Unique within the slot; `app.sidePanels` and `content.editor.views` require it. */
  key?: string;
  /** Lower renders first; 100 by default. */
  order?: number;
  /**
   * Shown only while this feature is on; the plugin's own flag by default, which a feature of
   * its own needs on too; `null` always shows it.
   */
  feature?: string | null;
  /**
   * Also rendered while the feature is locked (switched off but shown), for the component to
   * draw the lock with `FeatureGate` or `FeatureLock`. Slots whose host draws the lock itself
   * keep locked entries anyway.
   */
  locked?: boolean;
  /** Shown only with this space permission. */
  permission?: string;
  /** For side panels, editor views and create stages. */
  label?: string;
  icon?: string;
  /** The tooltip of the button the admin draws for the entry. */
  hint?: string;
  /** Shown only while this holds for the slot's props. */
  when?: (props: AdminSlotProps[K]) => boolean;
}

/** Options some slots take besides the common ones. */
export interface AdminSlotOptions {
  'space.create.steps': {
    /** A stage of its own after the admin's; shown until the entry drops it with `setStage(false)`. */
    stage?: {
      label: string;
      title: string;
      hint?: string;
      /** A sentence the install wizard adds to its welcome text. */
      welcome?: string;
    };
    /**
     * The plugin's data for `spaces.create` from the draft; `undefined` sends none. The draft
     * itself by default.
     */
    data?: (draft: Record<string, unknown>) => unknown;
  };
  'space.create.starters': {
    /** The choice in the form's list of space types. */
    starter: { title: string; hint: string };
    /** Why the space cannot be created yet, else null. */
    validate?: (draft: Record<string, unknown>) => string | null;
    /** Content types `spaces.create` creates with the space (its `plan`). */
    plan?: (draft: Record<string, unknown>) => ContentTypePlanType[];
    /** The plugin's data for `spaces.create`, like a `space.create.steps` entry's. */
    data?: (draft: Record<string, unknown>) => unknown;
    /** The toast after the space was created, e.g. `with 4 types`. */
    created?: (draft: Record<string, unknown>) => string;
  };
  'contentType.presets': {
    preset: AdminTypePreset;
    /** Why the type cannot be saved yet, else null. */
    validate?: (draft: Record<string, unknown>) => string | null;
    /** Runs once the new type is saved. */
    afterCreate?: (type: ContentTypeSummary, draft: Record<string, unknown>) => Promise<void>;
  };
}

/** A component a plugin puts into a slot. */
export type AdminSlotEntry<K extends AdminSlotId = AdminSlotId> = AdminSlotEntryBase<K> &
  (K extends keyof AdminSlotOptions ? AdminSlotOptions[K] : unknown);

/** A plugin-declared slot's id: the declaring plugin's id, a colon and its name. */
export type AdminPluginSlotId = `${string}:${string}`;

/**
 * An entry of a plugin-declared slot whose props nobody typed; the declaring plugin types them
 * by augmenting `AdminSlotProps`.
 */
export interface AdminPluginSlotEntry extends Omit<AdminSlotEntryBase, 'when'> {
  // biome-ignore lint/suspicious/noExplicitAny: the declaring plugin's props
  when?: (props: any) => boolean;
  /** Options the declaring plugin reads; it types them by augmenting `AdminSlotOptions`. */
  [option: string]: unknown;
}

export type AdminSlots = { [K in AdminSlotId]?: AdminSlotEntry<K>[] } & {
  [K in AdminPluginSlotId]?: AdminPluginSlotEntry[];
};

/** A tab of its own in Settings. */
export interface AdminSettingsSection {
  /** Unique across plugins; also the `?tab=` value. */
  id: string;
  label: string;
  icon: string;
  component: ComponentLoader;
  /** Of the current space (the default) or of the instance. */
  scope?: 'space' | 'instance';
  permission?: string;
  superadmin?: boolean;
  feature?: string;
}

/** A side list for plugin routes; shorthand for an `app.sidePanels` entry. */
export interface AdminSidePanel {
  key: string;
  label: string;
  icon: string;
  component: ComponentLoader;
}

/** A data provider's section in the space transfer picker. */
export interface AdminTransferSection {
  /** The data provider's kind. */
  kind: string;
  label: string;
  description: string;
  icon: string;
  /** The picker group; one of the admin's (`content`, `structure`, `integrations`) or a new one. */
  group: string | AdminTransferGroup;
  /** Left unticked until picked, like host names that would collide on the target. */
  optIn?: boolean;
  /** A section (its kind) this one needs; unticking that unticks this. */
  requires?: string;
  /** What one row is called, singular and plural, in counts. */
  noun?: [string, string];
  /**
   * Its entries can be picked one by one: the data provider lists them (`transfer.entries`);
   * in an import file they are the rows with an `id`, named by `label`, `name` or `kind`.
   */
  pickable?: boolean;
}

/** A group of the transfer picker; the admin's are 100 (content), 200 and 400. */
export interface AdminTransferGroup {
  id: string;
  label: string;
  hint: string;
  order?: number;
}

/** A field an audit entry changed. */
export interface AdminAuditChange {
  path: string;
  from?: unknown;
  to?: unknown;
}

/** Labels and links of a plugin's audit entries. */
export interface AdminAudit {
  /** By target kind (`<id>.<entity>`); `route` gets the entry's target id and meta. */
  entities?: Record<
    string,
    {
      label: string;
      route?: (targetId: string | null, meta: Record<string, unknown> | null) => string | null;
    }
  >;
  /** By action (`<id>.<entity>.<verb>`). */
  actions?: Record<string, string>;
  /** The one-word badge of an action, by action. */
  verbs?: Record<string, string>;
  /** A word beside the badge, from the entry's meta and changes, by action. */
  outcomes?: Record<
    string,
    (meta: Record<string, unknown> | null, changes: readonly AdminAuditChange[]) => string | null
  >;
  /** Names and icons of the actor kinds the plugin records as, by kind. */
  actors?: Record<string, { label: string; icon?: string }>;
}

/** An audit outcome for a switch: `on` or `off` from the entry's `enabled` change. */
export function enabledSwitchOutcome(
  _meta: Record<string, unknown> | null,
  changes: readonly AdminAuditChange[],
): string | null {
  const change = changes.find((entry) => entry.path === 'enabled');
  return change ? (change.to ? 'on' : 'off') : null;
}

/** Called for each live event another tab or actor caused, by target kind. */
export type AdminRealtimeHandler = (event: RealtimeEvent) => void;

/** What `setup` gets at boot; everything else is declared on the plugin object. */
export interface AdminPluginContext {
  /** The plugin's id, as its server part and its rpc namespace use it. */
  id: string;
  /**
   * Declares the slot `<id>:<name>` for this plugin's components to render with `<PluginSlot>`
   * and other bundles to fill; returns its id. Type its props by augmenting `AdminSlotProps`.
   */
  defineSlot(name: string): string;
  /** What `usePluginApi(<id>)` returns to other bundles: components, composables, queries. */
  expose(api: unknown): void;
}

export interface AdminPlugin {
  /** The plugin's name, the same as its server part's. */
  name: string;
  /** The flag the plugin's routes and entries answer to; `plugins.<id>` of `name` by default. */
  feature?: string;
  routes?: AdminRoute[];
  menu?: AdminMenuItem[];
  fields?: AdminFieldComponents;
  slots?: AdminSlots;
  /** Live event handlers by target kind (`<id>.<entity>`). */
  realtime?: Record<string, AdminRealtimeHandler>;
  audit?: AdminAudit;
  settingsSections?: AdminSettingsSection[];
  sidePanels?: AdminSidePanel[];
  transferSections?: AdminTransferSection[];
  /** Names of the plugin's features, by feature key, for locks and notices. */
  features?: Record<string, string>;
  /** Icons of the plugin's permission groups, by group id. */
  permissionIcons?: Record<string, string>;
  /** Names of the plugin's usage metrics and what stops when one is used up, by metric. */
  usage?: Record<string, { label: string; blocked: string }>;
  /** Names of the plugin's kinds in the promote diff, by kind. */
  diffKinds?: Record<string, string>;
  /** Drops the plugin's queries of a space after a promote replaced its production data. */
  invalidateOnPromote?: (spaceId: string | null) => void;
  /** Runs once at boot, after the router exists. */
  setup?: (context: AdminPluginContext) => void;
}

export function defineAdminPlugin(plugin: AdminPlugin): AdminPlugin {
  return plugin;
}
