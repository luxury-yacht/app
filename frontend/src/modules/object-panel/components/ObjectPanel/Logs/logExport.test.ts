import { describe, expect, it } from 'vitest';

import { buildCsv, escapeCsvCell } from './logExport';

describe('logExport', () => {
  it('escapes CSV cells only when needed', () => {
    expect(escapeCsvCell('plain')).toBe('plain');
    expect(escapeCsvCell('needs,quote')).toBe('"needs,quote"');
    expect(escapeCsvCell('say "hello"')).toBe('"say ""hello"""');
    expect(escapeCsvCell('line\nbreak')).toBe('"line\nbreak"');
  });

  it('builds CSV from rows', () => {
    expect(
      buildCsv([
        ['time', 'message'],
        ['now', 'hello, world'],
      ])
    ).toBe('time,message\nnow,"hello, world"');
  });
});
