/**
 * frontend/src/shared/actions/objectActionPolicy.test.ts
 *
 * Verifies object-action policy decisions independently from menu rendering so
 * availability rules remain centralized and testable.
 */

import { describe, expect, expectTypeOf, it } from 'vitest';
import { OBJECT_ACTION_IDS } from './objectActionContract';
import {
  type ObjectActionData,
  objectActionPolicyIds,
  resolveObjectActionPolicy,
} from './objectActionPolicy';

const allowed = { allowed: true, pending: false };
const denied = { allowed: false, pending: false };

const deployment = (overrides: Partial<ObjectActionData> = {}): ObjectActionData => ({
  kind: 'Deployment',
  group: 'apps',
  version: 'v1',
  name: 'api',
  namespace: 'apps',
  clusterId: 'cluster-a',
  hpaManaged: false,
  ...overrides,
});

describe('resolveObjectActionPolicy', () => {
  it('requires cluster and GVK identity in action data', () => {
    expectTypeOf<Pick<ObjectActionData, 'clusterId' | 'group' | 'version'>>().toEqualTypeOf<{
      clusterId: string;
      group: string;
      version: string;
    }>();
  });

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

  it('uses exact supported target GVKs for port-forward availability', () => {
    const supportedTargets: ObjectActionData[] = [
      {
        kind: 'Pod',
        group: '',
        version: 'v1',
        name: 'api',
        namespace: 'apps',
        clusterId: 'cluster-a',
      },
      {
        kind: 'Service',
        group: '',
        version: 'v1',
        name: 'api',
        namespace: 'apps',
        clusterId: 'cluster-a',
      },
      deployment({ group: 'apps', version: 'v1' }),
      deployment({ kind: 'StatefulSet', group: 'apps', version: 'v1' }),
      deployment({ kind: 'DaemonSet', group: 'apps', version: 'v1' }),
    ];

    for (const object of supportedTargets) {
      const policy = resolveObjectActionPolicy({
        object,
        context: 'gridtable',
        handlers: { portForward: true },
        permissions: { portForward: allowed },
      });

      expect(policy.portForward.show, object.kind).toBe(true);
      expect(policy.portForwardEnabled, object.kind).toBe(true);
    }

    const staleDeployment = resolveObjectActionPolicy({
      object: deployment({ group: 'extensions', version: 'v1beta1' }),
      context: 'gridtable',
      handlers: { portForward: true },
      permissions: { portForward: allowed },
    });
    expect(staleDeployment.portForward.show).toBe(false);
    expect(staleDeployment.portForwardEnabled).toBe(false);

    const replicaSet = resolveObjectActionPolicy({
      object: deployment({ kind: 'ReplicaSet', group: 'apps', version: 'v1' }),
      context: 'gridtable',
      handlers: { portForward: true },
      permissions: { portForward: allowed },
    });
    expect(replicaSet.portForward.show).toBe(false);
    expect(replicaSet.portForwardEnabled).toBe(false);
  });

  it('does not grant built-in workload actions to a different GVK with the same kind', () => {
    const policy = resolveObjectActionPolicy({
      object: deployment({ group: 'example.com', version: 'v1' }),
      context: 'gridtable',
      handlers: { restart: true, rollback: true, scale: true },
      permissions: { restart: allowed, rollback: allowed, scale: allowed },
    });

    expect(objectActionPolicyIds(policy)).not.toContain(OBJECT_ACTION_IDS.restart);
    expect(objectActionPolicyIds(policy)).not.toContain(OBJECT_ACTION_IDS.rollback);
    expect(objectActionPolicyIds(policy)).not.toContain(OBJECT_ACTION_IDS.scale);
  });

  it('uses node facts and permissions to choose cordon versus uncordon', () => {
    expect(
      resolveObjectActionPolicy({
        object: {
          kind: 'Node',
          group: '',
          version: 'v1',
          name: 'worker-1',
          clusterId: 'cluster-a',
        },
        context: 'gridtable',
        handlers: { cordon: true },
        permissions: { cordon: allowed },
      }).cordonActionId
    ).toBe(OBJECT_ACTION_IDS.cordon);

    expect(
      resolveObjectActionPolicy({
        object: {
          kind: 'Node',
          group: '',
          version: 'v1',
          name: 'worker-1',
          clusterId: 'cluster-a',
          unschedulable: true,
        },
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
        group: 'batch',
        version: 'v1',
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
