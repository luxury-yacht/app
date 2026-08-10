/**
 * frontend/src/shared/actions/objectActionClient.test.ts
 *
 * Verifies RunObjectAction target identity normalization.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const runObjectActionMock = vi.hoisted(() => vi.fn());
const runUserActionMock = vi.hoisted(() => vi.fn());

vi.mock('@/core/backend-api', () => ({
  RunObjectAction: (...args: unknown[]) => runObjectActionMock(...args),
}));

vi.mock('@/core/telemetry/sentry', () => ({
  runUserAction: (...args: unknown[]) => runUserActionMock(...args),
}));

import {
  buildObjectActionTarget,
  runCreateDebugContainer,
  runCronJobSuspend,
  runCronJobTrigger,
  runNodeCordon,
  runNodeUncordon,
  runObjectDelete,
  runObjectFinalizerRemoval,
  runObjectRestart,
  runObjectRollback,
  runObjectScale,
  runStartDrain,
  runStartPortForward,
} from './objectActionClient';

describe('buildObjectActionTarget', () => {
  beforeEach(() => {
    runObjectActionMock.mockReset();
    runObjectActionMock.mockResolvedValue({});
    runUserActionMock.mockReset();
    runUserActionMock.mockImplementation((_action: string, work: () => Promise<unknown>) => work());
  });

  it('preserves full object identity for RunObjectAction targets', () => {
    expect(
      buildObjectActionTarget(
        {
          clusterId: 'cluster-a',
          group: 'example.com',
          version: 'v1alpha1',
          kind: 'Widget',
          namespace: 'team-a',
          name: 'api',
        },
        'delete'
      )
    ).toEqual({
      clusterId: 'cluster-a',
      group: 'example.com',
      version: 'v1alpha1',
      kind: 'Widget',
      namespace: 'team-a',
      name: 'api',
    });
  });

  it('resolves registered built-in identity when group and version are omitted', () => {
    expect(
      buildObjectActionTarget(
        {
          clusterId: ' cluster-a ',
          kind: ' deployment ',
          namespace: ' team-a ',
          name: ' api ',
        },
        'restart'
      )
    ).toEqual({
      clusterId: 'cluster-a',
      group: 'apps',
      version: 'v1',
      kind: 'deployment',
      namespace: 'team-a',
      name: 'api',
    });
  });

  it('accepts an explicitly carried core group with the registered version', () => {
    expect(
      buildObjectActionTarget(
        {
          clusterId: 'cluster-a',
          group: '',
          version: 'v1',
          kind: 'Pod',
          name: 'api',
        },
        'delete'
      )
    ).toMatchObject({ group: '', version: 'v1', kind: 'Pod' });
  });

  it.each([
    [{ group: 'extensions', version: 'v1', kind: 'Deployment' }, 'unsupported group/version'],
    [{ group: 'apps', version: 'v1beta1', kind: 'Deployment' }, 'unsupported group/version'],
    [{ version: 'v1alpha1', kind: 'Widget' }, 'group is missing'],
    [{ group: 'example.com', kind: 'Widget' }, 'version is missing'],
  ])('rejects incomplete or conflicting GVK %#', (identity, message) => {
    expect(() =>
      buildObjectActionTarget(
        {
          clusterId: 'cluster-a',
          namespace: 'team-a',
          name: 'api',
          ...identity,
        },
        'delete'
      )
    ).toThrow(message);
  });

  it('canonicalizes the synthetic Helm release identity', () => {
    expect(
      buildObjectActionTarget(
        {
          clusterId: 'cluster-a',
          group: 'helm.sh',
          version: 'v2',
          kind: 'helmrelease',
          namespace: 'team-a',
          name: 'api',
        },
        'delete'
      )
    ).toMatchObject({ group: 'helm.sh', version: 'v3', kind: 'HelmRelease' });
  });

  it.each([
    [{ kind: 'Pod', name: 'api' }, 'clusterId is missing'],
    [{ clusterId: 'cluster-a', name: 'api' }, 'kind is missing'],
    [{ clusterId: 'cluster-a', kind: 'Pod' }, 'name is missing'],
  ])('rejects missing required target identity %#', (identity, message) => {
    expect(() => buildObjectActionTarget(identity, 'delete')).toThrow(message);
  });

  it('gives every object mutation an exact user-action instance', async () => {
    const target = {
      clusterId: 'cluster-a',
      group: 'apps',
      version: 'v1',
      kind: 'Deployment',
      namespace: 'team-a',
      name: 'api',
    };

    const actions = [
      {
        action: 'delete',
        run: () => runObjectDelete(target),
        request: { action: 'delete', target },
      },
      {
        action: 'restart',
        run: () => runObjectRestart(target),
        request: { action: 'restart', target },
      },
      {
        action: 'scale',
        run: () => runObjectScale(target, 3),
        request: { action: 'scale', target, replicas: 3 },
      },
      {
        action: 'trigger',
        run: () => runCronJobTrigger(target),
        request: { action: 'trigger', target },
      },
      {
        action: 'suspend',
        run: () => runCronJobSuspend(target, true),
        request: { action: 'suspend', target, suspend: true },
      },
      { action: 'cordon', run: () => runNodeCordon(target), request: { action: 'cordon', target } },
      {
        action: 'uncordon',
        run: () => runNodeUncordon(target),
        request: { action: 'uncordon', target },
      },
      {
        action: 'startDrain',
        run: () => runStartDrain(target, { force: true }),
        request: { action: 'startDrain', target, drainOptions: { force: true } },
      },
      {
        action: 'startPortForward',
        run: () => runStartPortForward(target, { containerPort: 80, localPort: 8080 }),
        request: {
          action: 'startPortForward',
          target,
          portForward: { containerPort: 80, localPort: 8080 },
        },
      },
      {
        action: 'createDebugContainer',
        run: () => runCreateDebugContainer(target, { image: 'busybox:latest' }),
        request: {
          action: 'createDebugContainer',
          target,
          debugContainer: { image: 'busybox:latest' },
        },
      },
      {
        action: 'rollback',
        run: () => runObjectRollback(target, 4),
        request: { action: 'rollback', target, revision: 4 },
      },
      {
        action: 'removeFinalizer',
        run: () => runObjectFinalizerRemoval(target, 'example.com/cleanup', 'metadata.finalizers'),
        request: {
          action: 'removeFinalizer',
          target,
          finalizer: 'example.com/cleanup',
          finalizerPath: 'metadata.finalizers',
        },
      },
    ];

    for (const action of actions) {
      await action.run();
    }

    expect(runUserActionMock.mock.calls.map(([action]) => action)).toEqual(
      actions.map(({ action }) => action)
    );
    expect(runObjectActionMock.mock.calls.map(([request]) => request)).toEqual(
      actions.map(({ request }) => request)
    );
  });
});
