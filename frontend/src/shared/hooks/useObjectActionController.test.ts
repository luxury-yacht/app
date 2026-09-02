import { describe, expect, it } from 'vitest';
import { resolveNavigateViewHandler } from './useObjectActionController';

describe('resolveNavigateViewHandler', () => {
  it('hides fallback navigation when the current window has no navigation providers', () => {
    expect(resolveNavigateViewHandler(undefined, () => undefined, false)).toBeUndefined();
  });
});
