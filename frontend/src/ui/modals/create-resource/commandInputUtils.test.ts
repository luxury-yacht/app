import { describe, expect, it } from 'vitest';
import {
  shellTokenize,
  shellJoin,
  inferMode,
  arrayToDisplayText,
  parseDisplayText,
} from './commandInputUtils';

describe('commandInputUtils', () => {
  // ─── shellTokenize ──────────────────────────────────────────────────

  describe('shellTokenize', () => {
    it('splits simple tokens by whitespace', () => {
      expect(shellTokenize('/bin/sh -c')).toEqual(['/bin/sh', '-c']);
    });

    it('preserves double-quoted strings as single tokens', () => {
      expect(shellTokenize('/bin/sh -c "hello world"')).toEqual(['/bin/sh', '-c', 'hello world']);
    });

    it('preserves single-quoted strings as single tokens', () => {
      expect(shellTokenize("echo 'hello world'")).toEqual(['echo', 'hello world']);
    });

    it('handles escaped double quotes inside double quotes', () => {
      expect(shellTokenize('echo "say \\"hi\\""')).toEqual(['echo', 'say "hi"']);
    });

    it('handles empty string', () => {
      expect(shellTokenize('')).toEqual([]);
    });

    it('handles whitespace-only input', () => {
      expect(shellTokenize('   ')).toEqual([]);
    });

    it('handles multiple spaces between tokens', () => {
      expect(shellTokenize('a   b   c')).toEqual(['a', 'b', 'c']);
    });

    it('handles tokens with commas (no split on comma)', () => {
      expect(shellTokenize('--origins=a.com,b.com --port=80')).toEqual([
        '--origins=a.com,b.com',
        '--port=80',
      ]);
    });

    it('handles explicitly empty quoted tokens', () => {
      expect(shellTokenize('a "" b')).toEqual(['a', '', 'b']);
    });

    it('handles tabs as whitespace', () => {
      expect(shellTokenize("a\tb")).toEqual(['a', 'b']);
    });
  });

  // ─── shellJoin ──────────────────────────────────────────────────────

  describe('shellJoin', () => {
    it('joins simple tokens with spaces', () => {
      expect(shellJoin(['/bin/sh', '-c'])).toBe('/bin/sh -c');
    });

    it('double-quotes tokens containing spaces', () => {
      expect(shellJoin(['echo', 'hello world'])).toBe('echo "hello world"');
    });

    it('escapes double quotes inside tokens', () => {
      expect(shellJoin(['say "hi"'])).toBe('"say \\"hi\\""');
    });

    it('represents empty strings as ""', () => {
      expect(shellJoin(['a', '', 'b'])).toBe('a "" b');
    });

    it('handles an empty array', () => {
      expect(shellJoin([])).toBe('');
    });
  });

  // ─── shellTokenize / shellJoin round-trip ───────────────────────────

  describe('round-trip', () => {
    const cases: string[][] = [
      ['/bin/sh', '-c'],
      ['echo', 'hello world'],
      ['--origins=a.com,b.com', '--port=80'],
      ['a', '', 'b'],
    ];

    it.each(cases)('round-trips %j', (...tokens) => {
      // shellJoin receives the full array, not individual elements.
      const joined = shellJoin(tokens);
      expect(shellTokenize(joined)).toEqual(tokens);
    });
  });

  // ─── inferMode ──────────────────────────────────────────────────────

  describe('inferMode', () => {
    it('returns "command" for empty arrays', () => {
      expect(inferMode([])).toBe('command');
    });

    it('returns "command" for simple string arrays', () => {
      expect(inferMode(['/bin/sh', '-c'])).toBe('command');
    });

    it('returns "script" when an item contains newlines', () => {
      expect(inferMode(['set -e\necho hello'])).toBe('script');
    });
  });

  // ─── arrayToDisplayText ─────────────────────────────────────────────

  describe('arrayToDisplayText', () => {
    it('joins as shell command in command mode', () => {
      expect(arrayToDisplayText(['/bin/sh', '-c'], 'command')).toBe('/bin/sh -c');
    });

    it('returns the first item in script mode', () => {
      expect(arrayToDisplayText(['set -e\necho hi'], 'script')).toBe('set -e\necho hi');
    });

    it('returns YAML in raw-yaml mode', () => {
      const text = arrayToDisplayText(['/bin/sh', '-c'], 'raw-yaml');
      expect(text).toContain('- /bin/sh');
      expect(text).toContain('- -c');
    });

    it('returns empty string for empty arrays', () => {
      expect(arrayToDisplayText([], 'command')).toBe('');
      expect(arrayToDisplayText([], 'script')).toBe('');
      expect(arrayToDisplayText([], 'raw-yaml')).toBe('');
    });
  });

  // ─── parseDisplayText ───────────────────────────────────────────────

  describe('parseDisplayText', () => {
    it('tokenises in command mode', () => {
      expect(parseDisplayText('/bin/sh -c "hello world"', 'command')).toEqual([
        '/bin/sh',
        '-c',
        'hello world',
      ]);
    });

    it('wraps text as single item in script mode', () => {
      const script = 'set -e\necho hello';
      expect(parseDisplayText(script, 'script')).toEqual([script]);
    });

    it('parses valid YAML in raw-yaml mode', () => {
      expect(parseDisplayText('- /bin/sh\n- -c', 'raw-yaml')).toEqual(['/bin/sh', '-c']);
    });

    it('returns null for invalid YAML in raw-yaml mode', () => {
      expect(parseDisplayText('not: a: sequence', 'raw-yaml')).toBeNull();
    });

    it('returns null for YAML that is not a sequence', () => {
      expect(parseDisplayText('key: value', 'raw-yaml')).toBeNull();
    });

    it('returns empty array for blank input in all modes', () => {
      expect(parseDisplayText('', 'command')).toEqual([]);
      expect(parseDisplayText('  ', 'command')).toEqual([]);
      expect(parseDisplayText('', 'script')).toEqual([]);
      expect(parseDisplayText('', 'raw-yaml')).toEqual([]);
    });
  });
});
