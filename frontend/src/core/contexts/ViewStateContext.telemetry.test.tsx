/**
 * frontend/src/core/contexts/ViewStateContext.telemetry.test.tsx
 *
 * The workspace window's navigation owner: it publishes the active view to
 * error reporting, opens Workloads when a namespace is picked from outside the
 * namespace view, and keeps Global and per-cluster navigation while a cluster
 * tab is hidden for closing, dropping a cluster's navigation only once the
 * close is accepted. Runs the production shell's own view state under the real
 * kubeconfig owner (test-utils/appState); tabs close through it against the
 * faked backend. Error reporting is observed with a pass-through spy.
 */

import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setActiveViewContext } from '@/core/telemetry/sentry';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';

vi.mock('@/core/telemetry/sentry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/telemetry/sentry')>();
  return { ...actual, setActiveViewContext: vi.fn(actual.setActiveViewContext) };
});

const app = installAppStateHarness();
let view: MountedApp;
let alpha: TestCluster;
let beta: TestCluster;

const navigation = () => {
  const viewState = view.owners().viewState;
  if (!viewState) {
    throw new Error('expected workspace navigation');
  }
  return viewState;
};

const published = () => vi.mocked(setActiveViewContext).mock.calls.map(([context]) => context);

/**
 * Starts closing `cluster`'s tab and returns the backend's pending decision:
 * the tab is hidden until `decide` answers `accept`.
 */
const beginClose = async (cluster: TestCluster, accept: boolean) => {
  if (!accept) {
    app.backend.answer('CloseClusterView', () => false);
  }
  const decide = app.backend.hold('CloseClusterView');
  let closing!: Promise<void>;
  act(() => {
    closing = view.owners().kubeconfig.closeKubeconfig(cluster.selection);
  });
  await app.settle();
  return async () => {
    await act(async () => decide());
    await act(async () => {
      await closing;
    });
    await app.settle();
  };
};

const reopen = async (cluster: TestCluster) => {
  await act(async () => {
    await view.owners().kubeconfig.openKubeconfig(cluster.selection);
  });
  await app.settle();
};

beforeEach(async () => {
  vi.mocked(setActiveViewContext).mockClear();
  alpha = app.cluster({ name: 'dev', context: 'alpha' });
  beta = app.cluster({ name: 'dev', context: 'beta' });
  app.namespaces(alpha, ['default', 'payments']);
  app.namespaces(beta, ['default']);
  view = await app.render(null);
});

describe('navigation', () => {
  it('publishes the active view of the visible cluster to error reporting', () => {
    expect(published().slice(-1)).toEqual([
      {
        view: 'overview',
        clusterId: alpha.clusterId,
        objectPanelOpen: false,
      },
    ]);
  });

  it('opens Workloads when a namespace is selected outside the namespace view', async () => {
    await act(async () => navigation().onNamespaceSelect('payments'));

    expect(navigation().viewType).toBe('namespace');
    expect(navigation().activeNamespaceTab).toBe('workloads');
    expect(navigation().sidebarSelection).toEqual({ type: 'namespace', value: 'payments' });
    expect(published().slice(-1)).toEqual([
      {
        view: 'namespace',
        tab: 'workloads',
        clusterId: alpha.clusterId,
        objectPanelOpen: false,
      },
    ]);
  });

  it.each([
    ['restores Global navigation when the backend refuses the close', false, 'global'],
    ['drops Global navigation once the backend accepts the close', true, 'overview'],
  ] as const)('%s', async (_case, accept, afterReopen) => {
    await act(async () => navigation().navigateToGlobal());
    expect(navigation().viewType).toBe('global');

    const decide = await beginClose(alpha, accept);
    // One visible cluster has no Global workspace.
    expect(navigation().viewType).toBe('overview');
    await decide();
    if (accept) {
      await reopen(alpha);
    }

    expect(view.owners().kubeconfig.selectedClusterIds).toEqual(
      expect.arrayContaining([alpha.clusterId, beta.clusterId])
    );
    expect(navigation().viewType).toBe(afterReopen);
  });

  it.each([
    ['restores a cluster’s navigation when the backend refuses its tab’s close', false],
    ['drops a cluster’s navigation once the backend accepts its tab’s close', true],
  ] as const)('%s', async (_case, accept) => {
    await act(async () => {
      navigation().setViewType('cluster');
      navigation().setActiveClusterView('nodes');
    });

    const decide = await beginClose(alpha, accept);
    // The hidden tab's navigation survives until the backend decides.
    expect(navigation().getClusterNavigationState(alpha.clusterId).activeClusterView).toBe('nodes');
    await decide();
    if (accept) {
      await reopen(alpha);
    } else {
      await view.selectCluster(alpha);
    }

    expect(view.owners().kubeconfig.selectedClusterId).toBe(alpha.clusterId);
    expect(navigation().viewType).toBe(accept ? 'overview' : 'cluster');
    expect(navigation().activeClusterTab).toBe(accept ? null : 'nodes');
  });
});
