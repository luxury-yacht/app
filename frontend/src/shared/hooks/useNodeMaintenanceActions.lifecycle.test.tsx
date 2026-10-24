/**
 * frontend/src/shared/hooks/useNodeMaintenanceActions.lifecycle.test.tsx
 *
 * Node maintenance (cordon, uncordon, drain) inside a panel's lifecycle: the
 * hook polls the maintenance state of each watched cluster (however its id is
 * written) and exposes only the running drains of those clusters, stops
 * polling when its consumer goes away, and keeps its panel from closing while
 * a cordon, uncordon, or drain request is in flight (overlapping drains
 * included), releasing it when the request settles or fails or the consumer
 * unmounts. Runs the hook inside the production shell (refresh, permissions,
 * panel lifecycle guards) with its real confirmation and drain modals, over a
 * faked backend (test-utils/appState); the requests are the backend's
 * RunObjectAction.
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type PanelLifecycleGuardRegistry,
  usePanelLifecycleGuardRegistry,
} from '@/core/panel-windows/panelLifecycleGuards';
import { buildRefreshScope } from '@/core/refresh/scopeSelector';
import type { NodeMaintenanceDrainJob } from '@/core/refresh/types';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';
import {
  buildNodeMaintenanceAggregateScope,
  type NodeActionTarget,
  useNodeMaintenanceActions,
} from './useNodeMaintenanceActions';

const app = installAppStateHarness();
let dev: TestCluster;
let view: MountedApp;
let actions: ReturnType<typeof useNodeMaintenanceActions> | undefined;
let guards: PanelLifecycleGuardRegistry | undefined;
const afterAction = vi.fn();

function Probe({ watchClusterIds }: Readonly<{ watchClusterIds?: string[] }>) {
  guards = usePanelLifecycleGuardRegistry();
  actions = useNodeMaintenanceActions({
    panelId: 'node-panel',
    watchClusterIds,
    onAfterAction: afterAction,
  });
  return actions.modals;
}

const maintenance = () => requireValue(actions, 'mounted node maintenance');
const blocker = (panelId: string) =>
  requireValue(guards, 'guard registry').firstBlocker([panelId])?.reason ?? null;

const target = (): NodeActionTarget => ({ clusterId: dev.clusterId, name: 'worker-1' });
const nodeRef = () => ({
  clusterId: dev.clusterId,
  group: '',
  version: 'v1',
  kind: 'Node',
  namespace: '',
  name: 'worker-1',
});

const drainJob = (clusterId: string): NodeMaintenanceDrainJob => ({
  id: 'job',
  clusterId,
  nodeName: 'worker-1',
  status: 'running',
  startedAt: 1,
  completedAt: 0,
  message: '',
  events: [],
  options: {
    ignoreDaemonSets: true,
    deleteEmptyDirData: false,
    force: false,
    disableEviction: false,
    skipWaitForPodsToTerminate: false,
  },
});

/** Answers RunObjectAction with requests the test settles one at a time. */
const pendingActions = () => {
  const pending: Array<{ resolve: () => void; reject: (error: Error) => void }> = [];
  app.backend.answer(
    'RunObjectAction',
    () =>
      new Promise((resolve, reject) => {
        pending.push({ resolve: () => resolve({}), reject });
      })
  );
  return {
    count: () => pending.length,
    settle: async (index: number, error?: Error) => {
      const request = requireValue(pending[index], `request ${index}`);
      await act(async () => {
        if (error) {
          request.reject(error);
        } else {
          request.resolve();
        }
      });
      await app.settle();
    },
  };
};

const start = async (watchClusterIds?: string[]) => {
  view = await app.render(null);
  await view.show(<Probe watchClusterIds={watchClusterIds} />);
};

const clickButton = async (selector: string, label: string) => {
  const button = requireValue(
    Array.from(document.querySelectorAll<HTMLButtonElement>(selector)).find(
      (candidate) => candidate.textContent?.trim() === label
    ),
    `expected the ${label} button`
  );
  await act(async () => button.click());
  await app.settle();
};

beforeEach(() => {
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['default']);
  afterAction.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('node maintenance panel lifecycle', () => {
  it('polls each watched cluster’s maintenance state, exposes only its running drains, and stops when unmounted', async () => {
    vi.useFakeTimers();
    const stg = app.cluster({ name: 'stg', context: 'beta' });
    app.namespaces(stg, ['default']);
    const devScope = buildNodeMaintenanceAggregateScope(dev.clusterId);
    const stgScope = buildNodeMaintenanceAggregateScope(stg.clusterId);
    const drain = drainJob(dev.clusterId);
    app.snapshots.serve('object-maintenance', devScope, {
      clusterId: dev.clusterId,
      drains: [drain],
    });
    app.snapshots.serve('object-maintenance', stgScope, { clusterId: stg.clusterId, drains: [] });
    const maintenanceScopes = () =>
      new Set(app.snapshots.reads('object-maintenance').map((read) => read.scope));

    await start([` ${dev.clusterId} `, dev.clusterId, '', stg.clusterId]);

    expect(maintenanceScopes()).toEqual(new Set([devScope, stgScope]));
    expect(maintenance().activeDrainFor(dev.clusterId, 'worker-1')).toEqual(drain);
    expect(maintenance().activeDrainFor(stg.clusterId, 'worker-1')).toBeNull();
    expect(maintenance().activeDrainFor('', 'worker-1')).toBeNull();

    // object-maintenance polls every 5 s while leased (types.generated.ts).
    const pollFor = async (ms: number) => {
      app.snapshots.clearReads();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
      return maintenanceScopes();
    };
    expect(await pollFor(12_000)).toContain(devScope);
    view.clear();
    expect(await pollFor(12_000)).toEqual(new Set());
  });

  it.each([false, true])(
    'keeps the panel open while a cordon or uncordon is in flight (unschedulable=%s)',
    async (unschedulable) => {
      const requests = pendingActions();
      await start();
      await act(async () => maintenance().openCordonFor({ ...target(), unschedulable }));
      await app.settle();

      await clickButton('.confirmation-modal-footer button', unschedulable ? 'Uncordon' : 'Cordon');

      expect(app.backend.calls('RunObjectAction')).toEqual([
        [{ action: unschedulable ? 'uncordon' : 'cordon', target: nodeRef() }],
      ]);
      expect(blocker('node-panel')).toBe('mutation-in-flight');
      expect(blocker('other-panel')).toBeNull();

      await requests.settle(0);

      expect(blocker('node-panel')).toBeNull();
      expect(afterAction).toHaveBeenCalledWith(unschedulable ? 'uncordon' : 'cordon', {
        ...target(),
        unschedulable,
      });
    }
  );

  it('releases the panel after a refused cordon without reporting success', async () => {
    const requests = pendingActions();
    await start();
    await act(async () => maintenance().openCordonFor(target()));
    await app.settle();
    await clickButton('.confirmation-modal-footer button', 'Cordon');
    expect(blocker('node-panel')).toBe('mutation-in-flight');

    await requests.settle(0, new Error('API request rejected'));

    expect(blocker('node-panel')).toBeNull();
    expect(afterAction).not.toHaveBeenCalled();
    expect(app.errors.take((record) => record.context?.source === 'node-maintenance')).toHaveLength(
      1
    );
  });

  it('keeps the panel open until overlapping drains both finish, and releases it on unmount', async () => {
    const nodeScope = buildRefreshScope('object-maintenance', {
      clusterId: dev.clusterId,
      selector: { kind: 'node', node: 'worker-1' },
    });
    app.snapshots.serve('object-maintenance', nodeScope, {
      clusterId: dev.clusterId,
      drains: [],
    });
    const requests = pendingActions();
    await start();
    const startDrain = async () => {
      await act(async () => maintenance().openDrainFor(target()));
      await app.settle();
      await act(async () => {
        requireValue(
          document.querySelector<HTMLButtonElement>('[data-test="drain-modal-start"]'),
          'expected the drain start button'
        ).click();
      });
      await app.settle();
    };
    const closeDrainModal = () => clickButton('.drain-node-modal-footer button', 'Cancel');

    // The user starts a drain, dismisses the modal while it runs, and starts another.
    await startDrain();
    await closeDrainModal();
    await startDrain();
    expect(requests.count()).toBe(2);
    expect(blocker('node-panel')).toBe('mutation-in-flight');

    await requests.settle(0);
    expect(blocker('node-panel')).toBe('mutation-in-flight');
    await requests.settle(1);
    expect(blocker('node-panel')).toBeNull();

    await closeDrainModal();
    await startDrain();
    expect(blocker('node-panel')).toBe('mutation-in-flight');
    view.clear();
    expect(blocker('node-panel')).toBeNull();
    await requests.settle(2);
  });
});
