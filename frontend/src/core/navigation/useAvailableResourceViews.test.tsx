/**
 * frontend/src/core/navigation/useAvailableResourceViews.test.tsx
 *
 * Optional extension views (cert-manager, External Secrets, Prometheus, …) are
 * offered only where the visible cluster's API discovery found their resource
 * family, in the scope it was found in, and a cluster never offers views from
 * another cluster's discovery while its own is still loading. Runs in the full
 * app, observed through the sidebar that renders the available views, over a
 * faked backend serving each cluster's discovered families (test-utils/appState).
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeCatalogSnapshotPayload } from '@/core/refresh/refreshContractTestBuilders';
import {
  buildClusterRefreshScope,
  buildRefreshScope,
  CLUSTER_SELECTOR,
} from '@/core/refresh/scopeSelector';
import type { DomainPayloadMap } from '@/core/refresh/types';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { snapshotResponse } from '@/test-utils/appState/transport';
import { requireValue } from '@/test-utils/requireValue';
import { useAvailableClusterViews } from './useAvailableResourceViews';

const app = installAppStateHarness();
let view: MountedApp;
let alpha: TestCluster;
let beta: TestCluster;

type Families = DomainPayloadMap['catalog']['resourceFamilies'];

// The discovered-families read the sidebar makes for a cluster.
const discoveryScope = (cluster: TestCluster) =>
  buildRefreshScope('catalog', {
    clusterId: cluster.clusterId,
    selector: CLUSTER_SELECTOR,
    query: 'limit=1',
  });

const discovery = (cluster: TestCluster, resourceFamilies: Families) =>
  makeCatalogSnapshotPayload({
    clusterId: cluster.clusterId,
    clusterName: cluster.clusterName,
    resourceFamilies,
  });

const serveDiscovery = (cluster: TestCluster, resourceFamilies: Families) => {
  app.snapshots.serve('catalog', discoveryScope(cluster), discovery(cluster, resourceFamilies));
};

const click = async (selector: string) => {
  const entry = requireValue(
    view.container.querySelector<HTMLElement>(selector),
    `expected the sidebar entry ${selector}`
  );
  await act(async () => entry.click());
  await app.settle();
};

/** The extension views the sidebar offers for the visible cluster, by scope. */
const offeredExtensions = async () => {
  const clusterId = view.owners().kubeconfig.selectedClusterId;
  const namespaceKey = `${clusterId}|default`;
  const namespaceToggle = `[data-sidebar-target-kind="namespace-toggle"][data-sidebar-target-namespace="${namespaceKey}"]`;
  if (view.container.querySelector(namespaceToggle)?.getAttribute('aria-expanded') !== 'true') {
    await click(namespaceToggle);
  }
  const ids = (selector: string) =>
    Array.from(view.container.querySelectorAll<HTMLElement>(selector)).map(
      (entry) => entry.dataset.sidebarTargetView
    );
  return {
    cluster: ids('[data-sidebar-target-kind="cluster-view"]'),
    namespaced: ids(
      `[data-sidebar-target-kind="namespace-view"][data-sidebar-target-namespace="${namespaceKey}"]`
    ),
  };
};

beforeEach(() => {
  // Extension views sit in the sidebar's Extensions groups, collapsed by default.
  app.preferences({
    sidebarClusterExtensionsExpanded: true,
    sidebarNamespaceExtensionsExpanded: true,
  });
  alpha = app.cluster({ name: 'dev', context: 'alpha' });
  beta = app.cluster({ name: 'dev', context: 'beta' });
  for (const cluster of [alpha, beta]) {
    app.namespaces(cluster, ['default']);
    app.startScreen(cluster);
  }
  serveDiscovery(alpha, {
    cluster: ['cert-manager'],
    namespaced: ['external-secrets', 'prometheus'],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

/** The cluster views a cluster's discovery offers. */
function ClusterViews({ clusterId }: Readonly<{ clusterId: string }>) {
  return (
    <output>
      {useAvailableClusterViews(clusterId)
        .map((entry) => entry.id)
        .join(',')}
    </output>
  );
}

/** The backend announces a change to the cluster's catalog. */
const ringCatalog = async (cluster: TestCluster, version: string) => {
  await act(async () => {
    app.streams.ring(
      'catalog',
      buildClusterRefreshScope('catalog', cluster.clusterId),
      'catalog',
      version
    );
    // Doorbells coalesce before consumers re-read (resourceStreamManager.ts UPDATE_COALESCE_MS).
    await vi.advanceTimersByTimeAsync(200);
  });
  await app.settle();
};

describe('discovered resource view availability', () => {
  it('offers a view a later discovery finds, once the catalog changes', async () => {
    vi.useFakeTimers();
    view = await app.mountApp();
    expect((await offeredExtensions()).namespaced).not.toContain('argocd');

    serveDiscovery(alpha, {
      cluster: ['cert-manager'],
      namespaced: ['external-secrets', 'prometheus', 'argocd'],
    });
    await ringCatalog(alpha, 'catalog:2');

    expect((await offeredExtensions()).namespaced).toContain('argocd');
  });

  it('reads discovery again when the catalog changes while its first read is out', async () => {
    vi.useFakeTimers();
    const asSent = discovery(alpha, { cluster: ['cert-manager'], namespaced: [] });
    const held: Array<() => void> = [];
    let holding = true;
    // Every discovery read before the change is answered as it was sent.
    app.snapshots.respond((request) => {
      if (!holding || request.domain !== 'catalog' || request.scope !== discoveryScope(alpha)) {
        return undefined;
      }
      return new Promise<Response>((resolve) => {
        held.push(() =>
          resolve(
            snapshotResponse({
              domain: request.domain,
              scope: request.scope,
              version: 1,
              payload: asSent,
            })
          )
        );
      });
    });
    view = await app.render(null);
    await view.show(<ClusterViews clusterId={alpha.clusterId} />);
    expect(held.length).toBeGreaterThan(0);

    serveDiscovery(alpha, { cluster: ['cert-manager', 'karpenter'], namespaced: [] });
    await ringCatalog(alpha, 'catalog:2');
    holding = false;
    await act(async () => {
      for (const answer of held) {
        answer();
      }
    });
    await app.settle();

    expect(view.container.textContent).toContain('karpenter');
  });

  it('reads discovery again only when the catalog changes', async () => {
    vi.useFakeTimers();
    view = await app.mountApp();
    await offeredExtensions();
    const discoveryReads = () =>
      app.snapshots.reads('catalog').filter((read) => read.scope === discoveryScope(alpha)).length;
    const before = discoveryReads();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    await app.settle();

    expect(discoveryReads()).toBe(before);
  });

  it('offers extension views only for the families discovery found, in their scope', async () => {
    view = await app.mountApp();

    const offered = await offeredExtensions();

    expect(offered.cluster).toContain('cert-manager');
    expect(offered.cluster).not.toContain('external-secrets');
    expect(offered.namespaced).toEqual(expect.arrayContaining(['external-secrets', 'prometheus']));
    expect(offered.namespaced).not.toContain('cert-manager');
  });

  it('offers no other cluster’s views while the switched-to cluster’s discovery loads', async () => {
    view = await app.mountApp();
    await offeredExtensions();
    const pendingBeta: Array<() => void> = [];
    app.snapshots.respond((request) => {
      if (request.domain !== 'catalog' || request.scope !== discoveryScope(beta)) {
        return undefined;
      }
      return new Promise<Response>((resolve) => {
        pendingBeta.push(() =>
          resolve(
            snapshotResponse({
              domain: request.domain,
              scope: request.scope,
              version: 100,
              payload: discovery(beta, { cluster: ['karpenter'], namespaced: [] }),
            })
          )
        );
      });
    });

    await view.selectCluster(beta);
    const whileLoading = await offeredExtensions();
    expect(pendingBeta.length).toBeGreaterThan(0);
    await act(async () => {
      for (const answer of pendingBeta.splice(0)) {
        answer();
      }
    });
    await app.settle();
    const loaded = await offeredExtensions();

    // The sidebar lists beta's views; only the discovered extensions wait.
    expect(whileLoading.cluster).toContain('browse');
    expect(whileLoading.cluster).not.toContain('cert-manager');
    expect(whileLoading.namespaced).not.toContain('external-secrets');
    expect(loaded.cluster).toContain('karpenter');
    expect(loaded.cluster).not.toContain('cert-manager');
    expect(loaded.namespaced).not.toContain('prometheus');
  });
});
