/**
 * frontend/src/modules/cluster/components/ClusterViewCRDs.test.tsx
 *
 * The cluster CRDs view: its Version column reports each CRD's storage
 * version with the count of further versions it serves (or a placeholder when
 * the CRD has no storage version), and it offers no kind filter because every
 * row is a CustomResourceDefinition. The cluster-scoped table it renders
 * through is covered by ClusterViewConfig.test.tsx. Runs in the full app,
 * navigated through the sidebar, over a faked backend (test-utils/appState).
 */

import { describe, expect, it } from 'vitest';
import type { ClusterCRDEntry } from '@/core/refresh/types';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';

const app = installAppStateHarness();
let dev: TestCluster;
let view: MountedApp;

/** A CRD row as backend/refresh/snapshot/cluster_crds.go projects it. */
const crd = (name: string, versions: Partial<ClusterCRDEntry> = {}): ClusterCRDEntry => ({
  ref: {
    clusterId: dev.clusterId,
    group: 'apiextensions.k8s.io',
    version: 'v1',
    kind: 'CustomResourceDefinition',
    resource: 'customresourcedefinitions',
    namespace: '',
    name,
    uid: `${name}-uid`,
  },
  group: name.slice(name.indexOf('.') + 1),
  scope: 'Namespaced',
  details: '',
  age: '1d',
  ...versions,
});

const versionOf = (name: string) =>
  requireValue(
    Array.from(view.container.querySelectorAll<HTMLElement>('.gridtable-row')).find((row) =>
      row.textContent?.includes(name)
    ),
    `expected the ${name} row`
  )
    .querySelector('.grid-cell[data-column="version"]')
    ?.textContent?.trim();

describe('ClusterViewCRDs', () => {
  it('shows each CRD’s storage version with the count of further served versions', async () => {
    dev = app.cluster({ name: 'dev', context: 'alpha' });
    app.namespaces(dev, ['team-a']);
    app.startScreen(dev);
    // The CRDs view sits in the sidebar's Extensions group, collapsed by default.
    app.preferences({ sidebarClusterExtensionsExpanded: true });
    app.serveTable(dev, 'cluster-crds', {
      rows: [
        crd('foos.example.com', { storageVersion: 'v1', extraServedVersionCount: 0 }),
        crd('dbinstances.rds.services.k8s.aws', {
          storageVersion: 'v1',
          extraServedVersionCount: 2,
        }),
        // A CRD in a transient state may report no storage version.
        crd('pending.example.com'),
      ],
    });
    view = await app.mountApp();
    await view.goTo({ clusterView: 'crds' });

    expect(versionOf('foos.example.com')).toBe('v1');
    expect(versionOf('dbinstances.rds.services.k8s.aws')).toBe('v1 (+2)');
    expect(versionOf('pending.example.com')).toBe('-');
    // Every row is a CustomResourceDefinition, so there is nothing to filter by kind.
    expect(view.container.querySelector('[name="gridtable-filter-kind"]')).toBeNull();
  });
});
