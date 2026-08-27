import { describe, expect, it } from 'vitest';
import { requireValue } from './requireValue';

describe('requireValue', () => {
  it('covers requireValue scenarios', async () => {
    // Scenario: throws a useful error when a test fixture value is missing
    expect(() => requireValue(undefined, 'expected accent shade')).toThrow('expected accent shade');

    {
      // Scenario: narrows nullable input for its caller
      const requireString = (input: string | null): string =>
        requireValue(input, 'expected a string');

      expect(requireString('value')).toBe('value');
    }
  });
});
