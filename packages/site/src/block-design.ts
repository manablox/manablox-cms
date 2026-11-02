import type { BlockBreakpoint, Block as SdkBlock } from '@manablox/public-sdk';

/** Style overrides on one block's root, by theme token. */
export interface BlockInstanceStyle {
  background?: `color:${string}`;
  backgroundImage?: {
    assetId: string;
    position?: 'center' | 'top' | 'bottom' | 'left' | 'right';
    size?: 'cover' | 'contain' | 'auto';
    repeat?: boolean;
  };
  paddingY?: `space:${string}` | '0';
  paddingX?: `space:${string}` | '0';
  gap?: `space:${string}` | '0';
  textAlign?: 'left' | 'center' | 'right';
  width?: 'contained' | 'full';
  /** Hidden at these breakpoints. */
  hide?: BlockBreakpoint[];
}

/**
 * How a designed site renders one block: stored at `ext.website`, delivered as `design`.
 * External frontends may ignore it.
 */
export interface BlockInstanceDesign {
  /** A variant of the block type's design; an unknown one renders the default. */
  variant?: string | undefined;
  style?: BlockInstanceStyle | undefined;
}

/** A delivered block with the website's `design`. */
export type DesignedBlock = SdkBlock & { design?: BlockInstanceDesign | null };

/** A variant or at least one style override; delivery leaves out anything less. */
export function hasBlockDesign(
  design: BlockInstanceDesign | null | undefined,
): design is BlockInstanceDesign {
  return !!design && (!!design.variant || Object.keys(design.style ?? {}).length > 0);
}
