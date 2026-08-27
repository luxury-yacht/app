import { describe, expect, it } from 'vitest';

import { buildLogSearchRegex, escapeRegExp, isValidRegexPattern } from './logSearch';

describe('logSearch', () => {
  it('covers logSearch scenarios', async () => {
    {
      // Scenario: escapes plain text patterns before building regexes
      expect(escapeRegExp('pod[0].*')).toBe('pod\\[0\\]\\.\\*');
      const regex = buildLogSearchRegex('pod[0].*');

      expect(regex?.test('pod[0].*')).toBe(true);
      expect(regex?.test('pod0xxx')).toBe(false);
    }

    {
      // Scenario: supports case-sensitive and global regex modes
      const regex = buildLogSearchRegex('error', {
        regexMode: true,
        caseSensitive: true,
        global: true,
      });

      expect(regex?.flags).toBe('g');
      expect('error Error'.match(regex ?? /never/)).toEqual(['error']);
    }
    // Scenario: returns null for invalid regex mode patterns
    expect(buildLogSearchRegex('[', { regexMode: true })).toBeNull();
    expect(isValidRegexPattern('[')).toBe(false);
    expect(isValidRegexPattern('')).toBe(true);
  });
});
