/**
 * frontend/src/core/contexts/inactiveClusterDemand.test.tsx
 *
 * A cluster tab the user is not looking at does no refresh work of its own:
 * nothing in the app's provider tree polls it. Only leases (visible views)
 * create demand. The real orchestrator and runtime run; contexts that only
 * supply state are stubbed, and snapshot reads are faked.
 */

import type { ReactNode } from 'react';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchSnapshotMock, PassThrough } = vi.hoisted(() => ({
  fetchSnapshotMock: vi.fn(),
  PassThrough: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('@/core/refresh/client', () => ({
  fetchSnapshot: (...args: unknown[]) => fetchSnapshotMock(...args),
  setMetricsActive: () => Promise.resolve(),
}));

vi.mock('@/core/logging/appLogsClient', () => ({
  APP_LOG_SOURCES: new Proxy({}, { get: (_target, key) => String(key) }),
  logAppLogsDebug: () => undefined,
  logAppLogsInfo: () => undefined,
  logAppLogsWarn: () => undefined,
  logAppLogsError: () => undefined,
}));

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  KubeconfigProvider: PassThrough,
  useKubeconfig: () => ({
    selectedClusterId: 'tab-active',
    selectedClusterIds: ['tab-active', 'tab-inactive'],
  }),
}));

// The inactive tab was last on Overview, the view a background poll would read.
vi.mock('@/core/contexts/ViewStateContext', () => ({
  ViewStateProvider: PassThrough,
  useViewState: () => ({
    getClusterNavigationState: () => ({
      viewType: 'overview',
      activeNamespaceView: 'workloads',
      activeClusterView: null,
    }),
  }),
}));

vi.mock('@modules/namespace/contexts/NamespaceContext', () => ({
  NamespaceProvider: PassThrough,
  useNamespace: () => ({ getClusterNamespace: () => undefined }),
}));

vi.mock('@/core/contexts/ClusterLifecycleContext', () => ({
  ClusterLifecycleProvider: PassThrough,
}));

vi.mock('@/core/contexts/AppearanceModeContext', () => ({
  AppearanceModeProvider: PassThrough,
}));

import {
  flushRefreshWork,
  markClusterReady,
  resetRefreshHarness,
} from '@/test-utils/refreshHarness';
import { KubernetesProvider } from './KubernetesProvider';

describe('an inactive cluster tab', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeAll(() => {
    vi.useFakeTimers();
  });

  beforeEach(() => {
    fetchSnapshotMock.mockReset();
    fetchSnapshotMock.mockResolvedValue({ notModified: true, snapshot: null });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(async () => {
    act(() => root.unmount());
    container.remove();
    resetRefreshHarness();
    await vi.runOnlyPendingTimersAsync();
  });

  it('is never polled while the user looks at another tab', async () => {
    markClusterReady('tab-active');
    markClusterReady('tab-inactive');
    await act(async () => {
      root.render(
        <KubernetesProvider>
          <div />
        </KubernetesProvider>
      );
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
      await flushRefreshWork();
    });

    const inactiveReads = fetchSnapshotMock.mock.calls.filter(([, options]) =>
      (options as { scope: string }).scope.startsWith('tab-inactive|')
    );
    expect(inactiveReads).toEqual([]);
  });
});
