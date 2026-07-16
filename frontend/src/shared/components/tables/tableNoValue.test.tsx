import { isTableNoValueText, TABLE_NO_VALUE_TEXT } from '@shared/components/tables/tableNoValue';
import { describe, expect, it } from 'vitest';

describe('table no-value presentation', () => {
  it.each(['-', '—', ' - ', ' — '])('recognizes the %s placeholder', (value) => {
    expect(isTableNoValueText(value)).toBe(true);
  });

  it.each(['', 'Unavailable', 'alpha-beta', '–'])('does not treat %s as no value', (value) => {
    expect(isTableNoValueText(value)).toBe(false);
  });

  it('uses the namespace table hyphen-minus marker', () => {
    expect(TABLE_NO_VALUE_TEXT).toBe('-');
  });
});
