import type { BlockBreakpoint } from '@manablox/core';
import type { DesignNode, SiteDesignKind, ThemeDesign } from '@manablox/site';
import { type InjectionKey, inject, provide, type Ref } from 'vue';
import type { DesignField } from './model/bindings';

/** What the inspector and its sections need of the designer they sit in. */
export interface DesignerContext {
  designKind: SiteDesignKind;
  /** The tree being edited; a block edits one variant's root. */
  root: Readonly<Ref<DesignNode | null>>;
  /** Fields bindings can point at. */
  fields: Readonly<Ref<readonly DesignField[]>>;
  /** Binding paths of the `repeat` elements around the selection. */
  repeats: Readonly<Ref<readonly string[]>>;
  theme: Readonly<Ref<ThemeDesign | null>>;
  breakpoint: Readonly<Ref<BlockBreakpoint>>;
  locales: Readonly<Ref<readonly string[]>>;
  /** Locale static text is written in. */
  locale: Readonly<Ref<string>>;
  readOnly: Readonly<Ref<boolean>>;
  /** Ids used anywhere in the design, a new set per call. */
  takenIds: () => Set<string>;
  labelFor: (node: DesignNode) => string;
  select: (id: string | null) => void;
  remove: (id: string) => void;
}

const DESIGNER_CONTEXT: InjectionKey<DesignerContext> = Symbol('designer');

/** Hands the designer to the inspector below it. */
export function provideDesigner(context: DesignerContext): void {
  provide(DESIGNER_CONTEXT, context);
}

/** The designer an inspector section sits in. */
export function useDesignerContext(): DesignerContext {
  const context = inject(DESIGNER_CONTEXT, null);
  if (!context) throw new Error('useDesignerContext() needs a designer above it');
  return context;
}
