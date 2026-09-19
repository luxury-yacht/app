import { describe, expect, it } from 'vitest';
import { withStableListKeys } from './stableListKeys';

describe('withStableListKeys', () => {
  it('uses semantic values and disambiguates duplicate values without array indexes', () => {
    const entries = withStableListKeys(['warning', 'warning', 'error'], (value) => value);
    expect(entries.map((entry) => entry.value)).toEqual(['warning', 'warning', 'error']);
    expect(new Set(entries.map((entry) => entry.key)).size).toBe(3);
    const reordered = withStableListKeys(['error', 'warning', 'warning'], (value) => value);
    expect(reordered.map((entry) => entry.key)).toEqual([
      entries[2].key,
      entries[0].key,
      entries[1].key,
    ]);
  });
  it('keeps literal occurrence suffixes distinct from repeated values', () => {
    const values = ['warning', 'warning', 'warning#2', 'warning#2', 'warning#2#2', '', '', '#2'];
    const entries = withStableListKeys(values, (value) => value);
    expect(entries.map((entry) => entry.value)).toEqual(values);
    expect(new Set(entries.map((entry) => entry.key)).size).toBe(values.length);
    expect(withStableListKeys(['unrelated', ...values], (value) => value).slice(1)).toEqual(
      entries
    );
  });
});
