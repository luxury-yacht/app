import { describe, expect, it } from 'vitest';
import { resolveObjectPanelMountTarget } from './objectPanelMountTarget';

describe('resolveObjectPanelMountTarget', () => {
  it('isolates a pending default-floating panel from any focused floating group', () => {
    expect(resolveObjectPanelMountTarget(undefined, 'floating', 'panel-a')).toEqual({
      position: 'floating',
      groupKey: 'pending-native:panel-a',
    });
  });

  it('passes the floating preference through for an established panel', () => {
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
