import { describe, expect, it } from 'vitest';
import { withStableListKeys } from './stableListKeys';

describe('withStableListKeys', () => {
  it('uses semantic values and disambiguates duplicate values without array indexes', () => {
    expect(withStableListKeys(['warning', 'warning', 'error'], (value) => value)).toEqual([
      { key: 'warning', value: 'warning' },
      { key: 'warning#2', value: 'warning' },
      { key: 'error', value: 'error' },
    ]);
  });
});
