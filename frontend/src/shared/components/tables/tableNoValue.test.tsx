import { isTableNoValueText, TABLE_NO_VALUE_TEXT } from '@shared/components/tables/tableNoValue';
import { describe, expect, it } from 'vitest';

describe('table no-value presentation', () => {
  it('covers table no-value presentation scenarios', async () => {
    for (const value of ['-', '—', ' - ', ' — ']) {
      // Scenarios: recognizes the %s placeholder
      expect(isTableNoValueText(value)).toBe(true);
    }

    for (const value of ['', 'Unavailable', 'alpha-beta', '–']) {
      // Scenarios: does not treat %s as no value
      expect(isTableNoValueText(value)).toBe(false);
    }
    // Scenario: uses the namespace table hyphen-minus marker
    expect(TABLE_NO_VALUE_TEXT).toBe('-');
  });
});
