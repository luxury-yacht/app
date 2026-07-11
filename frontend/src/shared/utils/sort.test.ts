import { describe, expect, it } from 'vitest';
import { compareUtf16Strings } from './sort';

describe('compareUtf16Strings', () => {
  it('preserves the default JavaScript string ordering explicitly', () => {
    expect(['a', '10', 'A', '2'].sort(compareUtf16Strings)).toEqual(['10', '2', 'A', 'a']);
  });

  it('treats equal values as equal', () => {
    expect(compareUtf16Strings('same', 'same')).toBe(0);
  });
});
