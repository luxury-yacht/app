import { describe, expect, it } from 'vitest';

import {
  deriveParsedLogFieldKeys,
  formatParsedValue,
  formatRawOrPrettyJsonLine,
  getParsedLogRowKey,
  tryParseJSONObject,
} from './parsedLogUtils';

describe('parsedLogUtils', () => {
  it('parses non-empty JSON objects and rejects other JSON shapes', () => {
    expect(tryParseJSONObject('{"level":"info"}')).toEqual({ level: 'info' });
    expect(tryParseJSONObject('[]')).toBeNull();
    expect(tryParseJSONObject('{}')).toBeNull();
    expect(tryParseJSONObject('not json')).toBeNull();
  });

  it('derives stable sorted field keys', () => {
    expect(
      deriveParsedLogFieldKeys([
        { data: { z: 1, a: 2 }, rawLine: '{}', lineNumber: 1 },
        { data: { m: 3, a: 4 }, rawLine: '{}', lineNumber: 2 },
      ])
    ).toEqual(['a', 'm', 'z']);
  });

  it('formats parsed values and JSON display lines', () => {
    expect(formatParsedValue(null)).toBe('-');
    expect(formatParsedValue({ nested: true })).toBe('{"nested":true}');
    expect(formatRawOrPrettyJsonLine('{"level":"info"}', 'pretty', true)).toBe(
      '{\n  "level": "info"\n}'
    );
    expect(formatRawOrPrettyJsonLine('\u001b[31mplain\u001b[0m', 'raw', false)).toBe('plain');
  });

  it('builds parsed row keys from sequence, line number, or fallback index', () => {
    expect(getParsedLogRowKey({ data: {}, rawLine: '{}', lineNumber: 1, seq: 7 })).toBe('log-7');
    expect(getParsedLogRowKey({ data: {}, rawLine: '{}', lineNumber: 3 })).toBe('log-3');
    expect(getParsedLogRowKey({}, 9)).toBe('log-9');
  });
});
