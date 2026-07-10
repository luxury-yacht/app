import { describe, expect, it } from 'vitest';
import { requireValue } from './requireValue';

describe('requireValue', () => {
  it('throws a useful error when a test fixture value is missing', () => {
    expect(() => requireValue(undefined, 'expected accent shade')).toThrow('expected accent shade');
  });
});
