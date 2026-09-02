import { describe, expect, it } from 'vitest';
import { resolveObjectPanelMountTarget } from './objectPanelMountTarget';

describe('resolveObjectPanelMountTarget', () => {
  it('passes the floating preference through when the panel has no persisted docked edge', () => {
    expect(resolveObjectPanelMountTarget(undefined, 'floating')).toEqual({
      position: 'floating',
      groupKey: undefined,
    });
  });

  it('uses a persisted docked edge instead of the default preference', () => {
    expect(resolveObjectPanelMountTarget('bottom', 'floating')).toEqual({
      position: 'bottom',
      groupKey: 'bottom',
    });
  });
});
