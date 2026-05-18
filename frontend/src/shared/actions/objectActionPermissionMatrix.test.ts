import { describe, expect, it } from 'vitest';

import { OBJECT_ACTION_IDS } from './objectActionDescriptors';
import { OBJECT_ACTION_PERMISSION_MATRIX } from './objectActionPermissionMatrix';

describe('object action permission matrix', () => {
  it('documents every UI-visible mutating action', () => {
    const actionIds = new Set(OBJECT_ACTION_PERMISSION_MATRIX.map((entry) => entry.actionId));

    expect(actionIds).toEqual(
      new Set([
        OBJECT_ACTION_IDS.restart,
        OBJECT_ACTION_IDS.rollback,
        OBJECT_ACTION_IDS.scale,
        OBJECT_ACTION_IDS.triggerNow,
        OBJECT_ACTION_IDS.suspend,
        OBJECT_ACTION_IDS.resume,
        OBJECT_ACTION_IDS.portForward,
        OBJECT_ACTION_IDS.cordon,
        OBJECT_ACTION_IDS.uncordon,
        OBJECT_ACTION_IDS.drain,
        OBJECT_ACTION_IDS.delete,
      ])
    );
  });

  it('ties each action to frontend and backend permission enforcement', () => {
    for (const entry of OBJECT_ACTION_PERMISSION_MATRIX) {
      expect(entry.frontendPermission).toBeTruthy();
      expect(entry.wailsMethod).toBeTruthy();
      expect(entry.backendPermission).toContain('resourcePermissionCheck');
      expect(entry.deniedReason).toBeTruthy();
    }
  });
});
