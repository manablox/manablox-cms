import { fnv1a } from '@manablox/core';
import { describe, expect, it } from 'vitest';
import {
  createTouchedIds,
  keyDigest,
  responseDigest,
  touchedTags,
  trackAsset,
  trackAssetList,
  trackListTypes,
  trackTouched,
} from '../src/index.js';

describe('touched ids', () => {
  it('tags each row under its id and its type', () => {
    const touched = createTouchedIds();
    trackTouched(touched, [
      { id: 'a', typeId: 't1' },
      { id: 'b', typeId: 't1' },
    ]);
    expect(touchedTags(touched, 's').sort()).toEqual(['content:a', 'content:b', 'type:t1']);
  });

  it('tags each serialised asset under its id', () => {
    const touched = createTouchedIds();
    trackTouched(touched, [{ id: 'a', typeId: 't1' }]);
    trackAsset(touched, 'img');
    trackAsset(undefined, 'img');
    expect(touchedTags(touched, 's').sort()).toEqual(['asset:img', 'content:a', 'type:t1']);
  });

  it('adds the space tag only for space-wide reads, or when nothing was read', () => {
    expect(touchedTags(createTouchedIds(), 's')).toEqual(['space:s']);
    expect(touchedTags(undefined, 's')).toEqual(['space:s']);
    expect(touchedTags(createTouchedIds(), null)).toEqual([]);

    const touched = createTouchedIds();
    trackTouched(touched, [{ id: 'a', typeId: 't1' }]);
    touched.spaceWide = true;
    expect(touchedTags(touched, 's')).toContain('space:s');
  });

  it('files a typed list under its types and an unfiltered one under the space', () => {
    const typed = createTouchedIds();
    trackListTypes(typed, ['t1', 't2']);
    expect(typed.spaceWide).toBe(false);
    expect([...typed.types]).toEqual(['t1', 't2']);

    const unfiltered = createTouchedIds();
    trackListTypes(unfiltered, undefined);
    expect(unfiltered.spaceWide).toBe(true);
    trackListTypes(undefined, undefined);
  });

  it('files an asset list under the space asset lists, not the whole space', () => {
    const touched = createTouchedIds();
    trackAsset(touched, 'a1');
    trackAssetList(touched);
    expect(touchedTags(touched, 's')).toEqual(['asset:a1', 'asset-list:s']);
    trackAssetList(undefined);
  });

  it('digests to a stable, length-suffixed token', () => {
    expect(responseDigest('{"a":1}')).toBe(responseDigest('{"a":1}'));
    expect(responseDigest('{"a":1}')).not.toBe(responseDigest('{"a":2}'));
    expect(responseDigest('abc')).toMatch(/^[A-Za-z0-9_-]{16}-3$/);
  });

  it('keeps inputs apart that collide under a 32-bit hash', () => {
    // Found offline by brute force: fnv1a maps both to 8a0e01ab.
    expect(fnv1a('q=1pvu')).toBe(fnv1a('q=g3ea'));
    expect(keyDigest('q=1pvu')).not.toBe(keyDigest('q=g3ea'));
    expect(keyDigest('q=1pvu')).toBe(keyDigest('q=1pvu'));
    expect(keyDigest('q=1pvu')).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it('does not let parts shift across their boundary', () => {
    expect(keyDigest('ab', 'c')).not.toBe(keyDigest('a', 'bc'));
  });
});
