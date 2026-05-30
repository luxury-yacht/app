import { describe, expect, it } from 'vitest';

import {
  MUTATING_OBJECT_ACTION_IDS,
  OBJECT_ACTIONS,
  OBJECT_ACTION_IDS,
  buildObjectActionPermissionDescriptor,
  objectActionBackendAction,
  objectActionContract,
  objectActionPayloadFields,
} from './objectActionContract';

describe('object action contract', () => {
  it('documents every UI-visible mutating action once', () => {
    const actionIds = new Set(MUTATING_OBJECT_ACTION_IDS);

    expect(actionIds.size).toBe(MUTATING_OBJECT_ACTION_IDS.length);
    expect(actionIds).toEqual(
      new Set([
        OBJECT_ACTION_IDS.restart,
        OBJECT_ACTION_IDS.rollback,
        OBJECT_ACTION_IDS.scale,
        OBJECT_ACTION_IDS.scaleToZero,
        OBJECT_ACTION_IDS.resumeFromZero,
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

  it('ties each mutating action to backend execution and permission metadata', () => {
    const backendActions = new Set<string>(Object.values(OBJECT_ACTIONS));

    for (const actionId of MUTATING_OBJECT_ACTION_IDS) {
      const contract = objectActionContract(actionId);

      expect(contract.actionId).toBe(actionId);
      expect(backendActions.has(objectActionBackendAction(actionId))).toBe(true);
      expect(contract.frontendPermission).toBeTruthy();
      expect(contract.backendPermission).toContain('resourcePermissionCheck');
      expect(contract.deniedReason).toBeTruthy();
    }
  });

  it('derives RunObjectAction payload metadata from the shared contract', () => {
    expect(objectActionPayloadFields(OBJECT_ACTION_IDS.scale)).toEqual(['replicas']);
    expect(objectActionBackendAction(OBJECT_ACTION_IDS.scale)).toBe(OBJECT_ACTIONS.scale);

    expect(objectActionPayloadFields(OBJECT_ACTION_IDS.drain)).toEqual(['drainOptions']);
    expect(objectActionBackendAction(OBJECT_ACTION_IDS.drain)).toBe(OBJECT_ACTIONS.startDrain);
  });

  it('builds permission descriptors with full target identity', () => {
    expect(
      buildObjectActionPermissionDescriptor(OBJECT_ACTION_IDS.delete, {
        clusterId: 'cluster-a',
        group: 'apps',
        version: 'v1',
        kind: 'Deployment',
        namespace: 'team-a',
        name: 'api',
      })
    ).toEqual({
      id: 'delete',
      actionId: OBJECT_ACTION_IDS.delete,
      slot: 'delete',
      clusterId: 'cluster-a',
      group: 'apps',
      version: 'v1',
      resourceKind: 'Deployment',
      verb: 'delete',
      namespace: 'team-a',
      name: 'api',
    });
  });

  it('requires object kind before building target-object permission descriptors', () => {
    expect(
      buildObjectActionPermissionDescriptor(OBJECT_ACTION_IDS.delete, {
        clusterId: 'cluster-a',
        group: 'apps',
        version: 'v1',
        namespace: 'team-a',
        name: 'api',
      })
    ).toBeNull();
  });
});
