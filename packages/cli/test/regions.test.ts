import { describe, expect, it } from 'vitest';
import {
  commentStyle,
  insertRegion,
  regionIds,
  regionsOf,
  removeRegions,
  UnbalancedRegion,
} from '../src/regions.js';

const file = [
  'const plugins = [',
  '  // manablox:slot config.plugins',
  '  // manablox:plugin ai >>>',
  '  ai(),',
  '  // manablox:plugin ai <<<',
  '  mine(),',
  '];',
  '',
].join('\n');

describe('marked regions', () => {
  it('reads the comment syntax from the path', () => {
    expect(commentStyle('manablox.plugins.ts')).toEqual({ open: '//', close: '' });
    expect(commentStyle('README.md')).toEqual({ open: '<!--', close: ' -->' });
    expect(commentStyle('.env')).toEqual({ open: '#', close: '' });
    expect(commentStyle('caddy/Caddyfile')).toEqual({ open: '#', close: '' });
    expect(commentStyle('package.json')).toBeNull();
  });

  it('finds each region with the anchor it follows', () => {
    expect(regionsOf(file)).toEqual([
      {
        id: 'ai',
        slot: 'config.plugins',
        occurrence: 0,
        text: '  // manablox:plugin ai >>>\n  ai(),\n  // manablox:plugin ai <<<\n',
      },
    ]);
    expect(regionIds(file)).toEqual(['ai']);
  });

  it('inserts after the regions already at the anchor, once', () => {
    const region = {
      id: 'workflows',
      occurrence: 0,
      text: '  // manablox:plugin workflows >>>\n  workflows(),\n  // manablox:plugin workflows <<<\n',
    };
    const first = insertRegion(file, 'config.plugins', region);
    expect(first.status).toBe('inserted');
    expect(first.content).toBe(file.replace('  mine(),', `${region.text}  mine(),`));
    expect(insertRegion(first.content, 'config.plugins', region)).toEqual({
      status: 'present',
      content: first.content,
    });
    expect(insertRegion(file, 'env', region)).toEqual({ status: 'missing', content: file });
  });

  it('removes whole regions only, and refuses an unbalanced one', () => {
    expect(removeRegions(file, 'ai')).toEqual({
      content: file.replace(
        '  // manablox:plugin ai >>>\n  ai(),\n  // manablox:plugin ai <<<\n',
        '',
      ),
      removed: 1,
    });
    expect(removeRegions(file, 'website')).toEqual({ content: file, removed: 0 });
    const broken = file.replace('  // manablox:plugin ai <<<\n', '');
    expect(() => removeRegions(broken, 'ai')).toThrow(UnbalancedRegion);
  });
});
