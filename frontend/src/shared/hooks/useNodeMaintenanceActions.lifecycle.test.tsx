import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PanelLifecycleGuardProvider,
  type PanelLifecycleGuardRegistry,
  usePanelLifecycleGuardRegistry,
} from '@/core/panel-windows/panelLifecycleGuards';
import { resetAllScopedDomainStates, setScopedDomainState } from '@/core/refresh/store';
import type { NodeMaintenanceDrainJob } from '@/core/refresh/types';
import { requireValue } from '@/test-utils/requireValue';
import { useNodeMaintenanceActions } from './useNodeMaintenanceActions';

const mocks = vi.hoisted(() => ({
  cordon: vi.fn(),
  uncordon: vi.fn(),
  enable: vi.fn(),
  refresh: vi.fn(),
  confirmation: null as null | { onConfirm: () => Promise<void> },
  drain: null as null | { onMutationChange: (inFlight: boolean) => void },
}));
vi.mock('@/core/data-access', () => ({
  setRefreshDomainEnabled: mocks.enable,
  requestRefreshDomain: mocks.refresh,
}));
vi.mock('@shared/actions/objectActionClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/actions/objectActionClient')>()),
  runNodeCordon: mocks.cordon,
  runNodeUncordon: mocks.uncordon,
}));
vi.mock('@shared/components/modals/ConfirmationModal', () => ({
  default: (props: typeof mocks.confirmation) => {
    mocks.confirmation = props;
    return null;
  },
}));
vi.mock('@shared/components/modals/DrainNodeModal', () => ({
  default: (props: typeof mocks.drain) => {
    mocks.drain = props;
    return null;
  },
}));
vi.mock('@/core/capabilities', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/capabilities')>()),
  useUserPermissions: () => new Map(),
}));

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('node maintenance panel lifecycle', () => {
  let root: Root;
  let container: HTMLDivElement;
  let actions: ReturnType<typeof useNodeMaintenanceActions>;
  let guards: PanelLifecycleGuardRegistry;
  const afterAction = vi.fn();
  const target = { clusterId: 'cluster-a', name: 'worker-1' };
  let watchClusterIds: string[] | undefined;
  function Probe() {
    guards = usePanelLifecycleGuardRegistry();
    actions = useNodeMaintenanceActions({
      panelId: 'node-panel',
      watchClusterIds,
      onAfterAction: afterAction,
    });
    return actions.modals;
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    watchClusterIds = undefined;
    resetAllScopedDomainStates('object-maintenance');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () =>
      root.render(
        <PanelLifecycleGuardProvider>
          <Probe />
        </PanelLifecycleGuardProvider>
      )
    );
  });

  it('subscribes once per cluster and only exposes active drains in the watched scopes', async () => {
    watchClusterIds = [' cluster-a ', 'cluster-a', '', 'cluster-b'];
    await act(async () =>
      root.render(
        <PanelLifecycleGuardProvider>
          <Probe />
        </PanelLifecycleGuardProvider>
      )
    );
    expect(mocks.enable.mock.calls).toEqual([
      [{ domain: 'object-maintenance', scope: 'cluster-a|aggregate', enabled: true }],
      [{ domain: 'object-maintenance', scope: 'cluster-b|aggregate', enabled: true }],
    ]);
    const drain: NodeMaintenanceDrainJob = {
      id: 'job',
      clusterId: 'cluster-a',
      clusterName: 'A',
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
    };
    await act(async () =>
      setScopedDomainState('object-maintenance', 'cluster-a|aggregate', (previous) => ({
        ...previous,
        status: 'ready',
        data: { clusterId: 'cluster-a', clusterName: 'A', drains: [drain] },
      }))
    );
    expect(actions.activeDrainFor('cluster-a', 'worker-1')).toEqual(drain);
    expect(actions.activeDrainFor('cluster-b', 'worker-1')).toBeNull();
    expect(actions.activeDrainFor('', 'worker-1')).toBeNull();
    await act(async () => root.render(null));
    expect(mocks.enable.mock.calls.slice(-2)).toEqual([
      [{ domain: 'object-maintenance', scope: 'cluster-a|aggregate', enabled: false }],
      [{ domain: 'object-maintenance', scope: 'cluster-b|aggregate', enabled: false }],
    ]);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it.each([false, true])(
    'blocks close immediately during cordon or uncordon (unschedulable=%s)',
    async (unschedulable) => {
      const pending = deferred();
      const mutation = unschedulable ? mocks.uncordon : mocks.cordon;
      mutation.mockReturnValue(pending.promise);
      await act(async () => actions.openCordonFor({ ...target, unschedulable }));
      let operation: Promise<void> | undefined;
      act(() => {
        operation = requireValue(mocks.confirmation, 'Confirmation must be mounted').onConfirm();
        expect(guards.firstBlocker(['node-panel'])?.reason).toBe('mutation-in-flight');
        expect(guards.firstBlocker(['other-panel'])).toBeNull();
      });
      expect(mutation).toHaveBeenCalledWith({
        ...target,
        group: '',
        version: 'v1',
        kind: 'Node',
        namespace: '',
      });
      await act(async () => {
        pending.resolve();
        await operation;
      });
      expect(guards.firstBlocker(['node-panel'])).toBeNull();
      expect(afterAction).toHaveBeenCalledWith(unschedulable ? 'uncordon' : 'cordon', {
        ...target,
        unschedulable,
      });
    }
  );

  it('releases the panel after a rejected operation without reporting success', async () => {
    const pending = deferred();
    mocks.cordon.mockReturnValue(pending.promise);
    await act(async () => actions.openCordonFor(target));
    let operation: Promise<void> | undefined;
    act(() => {
      operation = requireValue(mocks.confirmation, 'Confirmation must be mounted').onConfirm();
    });
    expect(guards.firstBlocker(['node-panel'])?.reason).toBe('mutation-in-flight');
    await act(async () => {
      pending.reject(new Error('API request rejected'));
      await operation;
    });
    expect(guards.firstBlocker(['node-panel'])).toBeNull();
    expect(afterAction).not.toHaveBeenCalled();
  });

  it('holds overlapping drain mutations until both finish and unregisters on unmount', async () => {
    await act(async () => actions.openDrainFor(target));
    const { onMutationChange } = requireValue(mocks.drain, 'Drain modal must be mounted');
    act(() => {
      onMutationChange(true);
      onMutationChange(true);
      expect(guards.firstBlocker(['node-panel'])?.reason).toBe('mutation-in-flight');
      onMutationChange(false);
      expect(guards.firstBlocker(['node-panel'])?.reason).toBe('mutation-in-flight');
      onMutationChange(false);
      expect(guards.firstBlocker(['node-panel'])).toBeNull();
      onMutationChange(true);
    });
    await act(async () => root.render(null));
    expect(guards.firstBlocker(['node-panel'])).toBeNull();
  });
});
