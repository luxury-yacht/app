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
import { beforeEach, describe, expect, it } from 'vitest';
import { makeCatalogSnapshotPayload } from '@/core/refresh/refreshContractTestBuilders';
import { buildRefreshScope, CLUSTER_SELECTOR } from '@/core/refresh/scopeSelector';
import type { DomainPayloadMap } from '@/core/refresh/types';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { snapshotResponse } from '@/test-utils/appState/transport';
import { requireValue } from '@/test-utils/requireValue';

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

describe('discovered resource view availability', () => {
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
