import { describe, expect, it } from 'vitest';
import { formatRestartCount } from './restartCount';

describe('formatRestartCount', () => {
  it.each([undefined, null, 0])('renders %s as the table no-value marker', (value) => {
    expect(formatRestartCount(value)).toBe('-');
  });

  it('renders positive restart counts as numbers', () => {
    expect(formatRestartCount(3)).toBe('3');
  });
});
