import { describe, expect, it } from 'vitest';
import {
  resolveNavigateViewHandler,
  resolveObjectActionGuardPanelId,
} from './useObjectActionController';

describe('resolveObjectActionGuardPanelId', () => {
  it('keeps grid actions inside an object panel in that panel lifecycle', () => {
    expect(resolveObjectActionGuardPanelId('panel-a')).toBe('panel-a');
  });

  it('does not register actions rendered outside an object panel', () => {
    expect(resolveObjectActionGuardPanelId(null)).toBeNull();
  });
});

describe('resolveNavigateViewHandler', () => {
  it('hides fallback navigation when the current window has no navigation providers', () => {
    expect(resolveNavigateViewHandler(undefined, () => undefined, false)).toBeUndefined();
  });
});
