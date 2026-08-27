import { describe, expect, it } from 'vitest';
import { formatRestartCount } from './restartCount';

describe('formatRestartCount', () => {
  it('covers formatRestartCount scenarios', async () => {
    for (const value of [undefined, null, 0]) {
      // Scenarios: renders %s as the table no-value marker
      expect(formatRestartCount(value)).toBe('-');
    }
    // Scenario: renders positive restart counts as numbers
    expect(formatRestartCount(3)).toBe('3');
  });
});
