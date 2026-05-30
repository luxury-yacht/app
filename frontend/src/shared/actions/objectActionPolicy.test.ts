/**
 * frontend/src/shared/actions/objectActionPolicy.test.ts
 *
 * Verifies object-action policy decisions independently from menu rendering so
 * availability rules remain centralized and testable.
 */

import { describe, expect, it } from 'vitest';
import { OBJECT_ACTION_IDS } from './objectActionDescriptors';
import {
  objectActionPolicyIds,
  resolveObjectActionPolicy,
  type ObjectActionData,
} from './objectActionPolicy';

const allowed = { allowed: true, pending: false };
const denied = { allowed: false, pending: false };

const deployment = (overrides: Partial<ObjectActionData> = {}): ObjectActionData => ({
  kind: 'Deployment',
  name: 'api',
  namespace: 'apps',
  clusterId: 'cluster-a',
  hpaManaged: false,
  ...overrides,
});

describe('resolveObjectActionPolicy', () => {
  it('selects normal scale only when HPA ownership is known false', () => {
    const policy = resolveObjectActionPolicy({
      object: deployment(),
      context: 'gridtable',
      handlers: { scale: true },
      permissions: { scale: allowed },
    });

    expect(policy.scaleActionId).toBe(OBJECT_ACTION_IDS.scale);
    expect(objectActionPolicyIds(policy)).toContain(OBJECT_ACTION_IDS.scale);
  });

  it('selects scale-to-zero or resume-from-zero for HPA-managed workloads', () => {
    expect(
      resolveObjectActionPolicy({
        object: deployment({ hpaManaged: true, desiredReplicas: 3 }),
        context: 'object-panel',
        handlers: { scaleToZero: true, resumeFromZero: true },
        permissions: { scale: allowed },
      }).scaleActionId
    ).toBe(OBJECT_ACTION_IDS.scaleToZero);

    expect(
      resolveObjectActionPolicy({
        object: deployment({ hpaManaged: true, desiredReplicas: 0 }),
        context: 'object-panel',
        handlers: { scaleToZero: true, resumeFromZero: true },
        permissions: { scale: allowed },
      }).scaleActionId
    ).toBe(OBJECT_ACTION_IDS.resumeFromZero);
  });

  it('shows port-forward only when target facts and permission both allow it', () => {
    expect(
      resolveObjectActionPolicy({
        object: deployment({ group: 'apps', version: 'v1' }),
        context: 'gridtable',
        handlers: { portForward: true },
        permissions: { portForward: allowed },
      }).portForwardEnabled
    ).toBe(true);

    expect(
      resolveObjectActionPolicy({
        object: deployment({ group: 'apps', version: 'v1' }),
        context: 'gridtable',
        handlers: { portForward: true },
        permissions: { portForward: denied },
      }).portForwardEnabled
    ).toBe(false);
  });

  it('uses node facts and permissions to choose cordon versus uncordon', () => {
    expect(
      resolveObjectActionPolicy({
        object: { kind: 'Node', name: 'worker-1', clusterId: 'cluster-a' },
        context: 'gridtable',
        handlers: { cordon: true },
        permissions: { cordon: allowed },
      }).cordonActionId
    ).toBe(OBJECT_ACTION_IDS.cordon);

    expect(
      resolveObjectActionPolicy({
        object: { kind: 'Node', name: 'worker-1', clusterId: 'cluster-a', unschedulable: true },
        context: 'gridtable',
        handlers: { cordon: true },
        permissions: { cordon: allowed },
      }).cordonActionId
    ).toBe(OBJECT_ACTION_IDS.uncordon);
  });

  it('keeps suspended CronJob trigger visible but disabled', () => {
    const policy = resolveObjectActionPolicy({
      object: {
        kind: 'CronJob',
        name: 'backup',
        namespace: 'default',
        clusterId: 'cluster-a',
        status: 'Suspended',
      },
      context: 'gridtable',
      handlers: { trigger: true },
      permissions: { trigger: allowed },
    });

    expect(policy.triggerEnabled).toBe(true);
    expect(policy.triggerDisabled).toBe(true);
  });
});
