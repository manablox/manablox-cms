/** Option and item shapes of the kit's controls. */

/** A tab of `Tabs`. */
export interface TabItem<V> {
  id: V;
  label: string;
  icon?: string | undefined;
  /** Shown after the label. */
  count?: number | undefined;
}

/** An option of `SegmentedControl`. */
export interface SegmentedOption<V> {
  value: V;
  label: string;
  icon?: string | undefined;
  hint?: string | undefined;
}

/** One collapsible card of `SettingsAccordion`. */
export interface SettingsAccordionItem {
  value: string;
  label: string;
  icon: string;
  /** What the section is for, in a line. */
  description?: string | undefined;
  /** The current values at a glance. */
  summary?: string | undefined;
  badge?: { label: string; tone?: 'ok' | 'warn' | 'danger' | 'neutral' } | undefined;
  disabled?: boolean | undefined;
}

/** A chip of `ChipFieldset`. */
export interface ChipOption<V> {
  value: V;
  label: string;
  /** Tooltip. */
  title?: string | undefined;
}

/** A `DataTable` column; `sortBy` makes its header a `SortHeader`. */
export interface DataColumn<S extends string = string> {
  key: string;
  label: string;
  /** Hides the header text from sight, not from screen readers. */
  hideLabel?: boolean;
  sortBy?: S;
  /** Classes on the header cell. */
  headerClass?: string;
  /** Classes on each body cell. */
  cellClass?: string;
}

/** An option of `Select`. */
export interface SelectOption<T> {
  value: T;
  label: string;
  /** Second line under the label. */
  hint?: string | undefined;
  /** Wrapped prose under the label, instead of a one-line hint. */
  description?: string | undefined;
  /** Heading of the run of options it starts; neighbours with the same group share it. */
  group?: string | undefined;
}
