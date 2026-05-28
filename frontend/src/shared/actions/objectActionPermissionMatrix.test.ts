import { describe, expect, it } from 'vitest';

import { MUTATING_OBJECT_ACTION_IDS } from './objectActionDescriptors';
import { OBJECT_ACTIONS } from './objectActionClient';
import { OBJECT_ACTION_PERMISSION_MATRIX } from './objectActionPermissionMatrix';

describe('object action permission matrix', () => {
  it('documents every UI-visible mutating action', () => {
    const actionIds = new Set(OBJECT_ACTION_PERMISSION_MATRIX.map((entry) => entry.actionId));

    expect(actionIds).toEqual(new Set(MUTATING_OBJECT_ACTION_IDS));
  });

  it('ties each action to frontend and backend permission enforcement', () => {
    const backendActions = new Set<string>(Object.values(OBJECT_ACTIONS));
    for (const entry of OBJECT_ACTION_PERMISSION_MATRIX) {
      expect(entry.frontendPermission).toBeTruthy();
      expect([...backendActions].some((action) => entry.wailsMethod.includes(action))).toBe(true);
      expect(entry.backendPermission).toContain('resourcePermissionCheck');
      expect(entry.deniedReason).toBeTruthy();
    }
  });

  it('does not duplicate action entries', () => {
    const seen = new Set<string>();
    for (const entry of OBJECT_ACTION_PERMISSION_MATRIX) {
      expect(seen.has(entry.actionId)).toBe(false);
      seen.add(entry.actionId);
    }
  });
});
