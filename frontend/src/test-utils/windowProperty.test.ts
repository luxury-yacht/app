import { describe, expect, it } from 'vitest';
import { installWindowProperty } from './windowProperty';

describe('installWindowProperty', () => {
  it('restores the previous property descriptor', () => {
    Object.defineProperty(window, 'testBoundary', {
      value: 'before',
      configurable: true,
      writable: false,
    });

    const restore = installWindowProperty('testBoundary', 'during');
    expect(Reflect.get(window, 'testBoundary')).toBe('during');
    restore();

    expect(Reflect.get(window, 'testBoundary')).toBe('before');
    expect(Object.getOwnPropertyDescriptor(window, 'testBoundary')?.writable).toBe(false);
    Reflect.deleteProperty(window, 'testBoundary');
  });
});
