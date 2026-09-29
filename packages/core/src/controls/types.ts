/** Value shapes of controls, and the scopes they are set at. */

export type ControlScopeKind = 'instance' | 'group' | 'space';

export type ControlScope =
  | { kind: 'instance' }
  | { kind: 'group'; id: string }
  | { kind: 'space'; id: string };

/** The read-only scope above every stored one: what plugins' feature ceilings set. */
export interface CeilingScope {
  kind: 'ceiling';
}

/** The scopes a feature resolves over: a ceiling first, then the stored ones. */
export type FeatureScope = CeilingScope | ControlScope;

export type FeaturePresentation = 'hidden' | 'locked';

export interface FeatureControl {
  enabled: boolean;
  /** Default `locked`. */
  presentation?: FeaturePresentation;
  /** Shown when locked. */
  message?: string;
  link?: string;
}

export type LimitMode = 'hard' | 'soft' | 'off';

export interface LimitControl {
  /** `null` is unlimited. */
  max: number | null;
  mode: LimitMode;
  /** Percent; default `[80, 100]`. */
  thresholds?: number[];
}

/** At most `max` hits per `windowSeconds`. */
export interface RateRule {
  max: number;
  windowSeconds: number;
}

/** At most `max` at the same time. */
export interface ConcurrencyRule {
  max: number;
}

export type SnapshotInterval = 'daily' | 'hourly';

export type BannerLevel = 'info' | 'warning' | 'danger';

export interface AdminBanner {
  id: string;
  level: BannerLevel;
  /** Plain text. */
  text: string;
  link?: string;
  dismissible: boolean;
  audience: 'all' | 'superadmin';
}

export interface AdminLinks {
  upgrade?: string;
  billing?: string;
  support?: string;
  docs?: string;
}

export type InstanceStatus = 'active' | 'readOnly' | 'suspended';

export interface StateControl {
  status: InstanceStatus;
  message?: string;
}

/** A feature flag after scope resolution. */
export interface ResolvedFeature {
  enabled: boolean;
  presentation: FeaturePresentation;
  message?: string;
  link?: string;
}

/** What a limit is counted over: one space, a group's spaces, or all (`'all'`). */
export interface LimitTarget {
  scope: ControlScope;
  spaceIds: readonly string[] | 'all';
  /** The space the action is in; `null` for instance-level actions. */
  spaceId: string | null;
}

/** How much an action adds at a scope; a function when it differs per scope. */
export type LimitIncrement = number | ((target: LimitTarget) => number | Promise<number>);

/** A limit set at one scope; every entry of a key must pass. */
export interface ResolvedLimit {
  scope: ControlScope;
  max: number;
  mode: 'hard' | 'soft';
  thresholds: number[];
}

export interface ResolvedState {
  status: InstanceStatus;
  /** The scope that set the status; `null` when active by default. */
  scope: ControlScope | null;
  message?: string;
}

/** `null` means no restriction; an empty list admits nothing. */
export interface ResolvedUploadRules {
  maxFileSize: number | null;
  allowedMimeTypes: string[] | null;
}

export type UsageLevel = 'ok' | 'warn' | 'over' | 'blocked';

/** A metric's state at one scope in the current period. */
export interface UsageState {
  level: UsageLevel;
  used: number;
  /** `null` without a limit at the scope. */
  max: number | null;
  /** The start of the next period, ISO 8601. */
  resetsAt: string;
}

/** A metric's most severe level across a space's scopes, at the scope that has it. */
export interface UsageNotice extends UsageState {
  scope: ControlScope;
}

/** A hard usage limit a space is blocked by, at the scope that set it. */
export interface UsageBlock {
  scope: ControlScope;
  used: number;
  max: number;
  resetsAt: string;
}
