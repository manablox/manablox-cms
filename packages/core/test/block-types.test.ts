import type * as sdk from '@manablox/public-sdk';
import { BLOCK_BREAKPOINTS as SDK_BREAKPOINTS } from '@manablox/public-sdk';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { ResolvedLink } from '../src/link.js';
import type * as core from '../src/types.js';
import { BLOCK_BREAKPOINTS } from '../src/types.js';

// Checked by `tsc`: a drift between the stored and the delivered block types fails typecheck.
describe('block layout types match the public SDK', () => {
  it('declares the same layout shapes', () => {
    expectTypeOf<core.BlockBreakpoint>().toEqualTypeOf<sdk.BlockBreakpoint>();
    expectTypeOf<core.BlockPlacement>().toEqualTypeOf<sdk.BlockPlacement>();
    expectTypeOf<core.BlockLayout>().toEqualTypeOf<sdk.BlockLayout>();
    expectTypeOf<core.BlockGrid>().toEqualTypeOf<sdk.BlockGrid>();
    expectTypeOf<core.BlockGridSettings>().toEqualTypeOf<sdk.BlockGridSettings>();
    expectTypeOf<core.BlockGridValue>().toEqualTypeOf<sdk.BlockGridValue>();
    expect(BLOCK_BREAKPOINTS).toEqual(SDK_BREAKPOINTS);
  });

  it('differs only where storage and delivery differ', () => {
    // A delivered block carries its fields flattened too, and plugin data in place of `ext`.
    expectTypeOf<Pick<sdk.Block, 'blockId' | 'type' | 'fields'>>().toEqualTypeOf<
      Omit<core.BlockValue, 'layout' | 'ext'>
    >();
    expectTypeOf<core.BlockLayout | undefined>().toMatchTypeOf<sdk.Block['layout']>();
    // Stored grids keep only what an editor set; delivered ones are resolved or `null`.
    expectTypeOf<core.BlocksValue['grid']>().toEqualTypeOf<core.BlockGridValue | undefined>();
    expectTypeOf<sdk.BlocksValue['grid']>().toEqualTypeOf<sdk.BlockGridSettings | null>();
    expectTypeOf<core.BlocksValue['blocks']>().toEqualTypeOf<core.BlockValue[]>();
    // The SDK's `LinkValue` is the delivered link; `content` is typed as a document there.
    expectTypeOf<Omit<sdk.LinkValue, 'content'>>().toEqualTypeOf<Omit<ResolvedLink, 'content'>>();
  });
});
