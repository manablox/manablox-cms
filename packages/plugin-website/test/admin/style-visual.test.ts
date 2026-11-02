import { describe, expect, it } from 'vitest';
import { setStyleProps } from '../../src/admin/model/style';
import {
  boxPatch,
  boxProp,
  boxSide,
  lengthPx,
  mainAxis,
  scopeLabel,
  scopeShortLabel,
  scopeSides,
} from '../../src/admin/model/style-visual';

describe('setStyleProps', () => {
  it('sets and clears in one go, dropping empty rules', () => {
    const rules = { base: { padding: 'space:4', gap: 'space:2' } } as const;
    expect(setStyleProps(rules, 'base', { padding: undefined, paddingX: 'space:1' })).toEqual({
      base: { gap: 'space:2', paddingX: 'space:1' },
    });
    expect(setStyleProps(rules, 'base', { padding: undefined, gap: undefined })).toBeUndefined();
  });
});

describe('lengthPx', () => {
  it('reads px and rem', () => {
    expect(lengthPx('1.5rem')).toBe(24);
    expect(lengthPx('12px')).toBe(12);
    expect(lengthPx('0')).toBe(0);
    expect(lengthPx('50%')).toBeNull();
  });
});

describe('box sides', () => {
  const read = (values: Record<string, string>) => (name: string) => values[name];

  it('names the prop of a scope', () => {
    expect(boxProp('padding', 'top', 'all')).toBe('padding');
    expect(boxProp('padding', 'left', 'axis')).toBe('paddingX');
    expect(boxProp('margin', 'bottom', 'side')).toBe('marginBottom');
  });

  it('takes the most specific set prop', () => {
    const values = read({ padding: 'space:4', paddingY: 'space:2', paddingTop: 'space:8' });
    expect(boxSide(values, 'padding', 'top')).toEqual({ value: 'space:8', scope: 'side' });
    expect(boxSide(values, 'padding', 'bottom')).toEqual({ value: 'space:2', scope: 'axis' });
    expect(boxSide(values, 'padding', 'left')).toEqual({ value: 'space:4', scope: 'all' });
    expect(boxSide(read({}), 'margin', 'left')).toEqual({ value: undefined, scope: null });
  });

  it('clears what a wider change covers', () => {
    expect(boxPatch('padding', 'top', 'axis', 'space:3')).toEqual({
      paddingY: 'space:3',
      paddingTop: undefined,
      paddingBottom: undefined,
    });
    expect(boxPatch('margin', 'left', 'all', '0')).toEqual({
      margin: '0',
      marginTop: undefined,
      marginRight: undefined,
      marginBottom: undefined,
      marginLeft: undefined,
      marginX: undefined,
      marginY: undefined,
    });
    expect(boxPatch('padding', 'right', 'side', undefined)).toEqual({ paddingRight: undefined });
  });
});

describe('spacing scopes', () => {
  it('names and draws what a change from one side reaches', () => {
    expect(scopeLabel('top', 'axis')).toBe('Top and bottom');
    expect(scopeShortLabel('left', 'axis')).toBe('Left + right');
    expect(scopeShortLabel('top', 'side')).toBe('Top');
    expect(scopeSides('right', 'side')).toEqual(['right']);
    expect(scopeSides('left', 'axis')).toEqual(['left', 'right']);
    expect(scopeSides('top', 'all')).toEqual(['top', 'right', 'bottom', 'left']);
  });
});

describe('mainAxis', () => {
  it('treats reversed directions like their axis', () => {
    expect(mainAxis('column-reverse')).toBe('column');
    expect(mainAxis(undefined)).toBe('row');
  });
});
