import { describe, expect, it } from 'vitest';
import { normalizeDropdownValue } from './dropdownValue';

describe('normalizeDropdownValue', () => {
  it('covers normalizeDropdownValue scenarios', async () => {
    {
      // Scenario: preserves multi-select values
      const values = ['one', 'two'];
      expect(normalizeDropdownValue(values)).toBe(values);
    }
    // Scenario: wraps a single selected value
    expect(normalizeDropdownValue('one')).toEqual(['one']);
    // Scenario: normalizes an empty single-select value to an empty array
    expect(normalizeDropdownValue('')).toEqual([]);
  });
});
