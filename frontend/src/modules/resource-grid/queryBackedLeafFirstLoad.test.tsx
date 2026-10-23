/**
 * frontend/src/modules/resource-grid/queryBackedLeafFirstLoad.test.tsx
 *
 * First load of every query-backed leaf view, opened from the sidebar: the
 * view reads its own domain's typed page (in the selected namespace and under
 * All Namespaces, or cluster-wide) in its default sort, shows that page's
 * rows, and offers sorting only on the columns the page query sorts by. A view
 * whose domain the backend denies settles on the permission state at once,
 * with no warm-up retries. Runs in the full app, navigated through the
 * sidebar, over a faked backend (test-utils/appState).
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  makeClusterNodeSnapshotEntry,
  makeNamespaceWorkloadSummary,
  makePodSnapshotEntry,
} from '@/core/refresh/refreshContractTestBuilders';
import { buildClusterRefreshScope } from '@/core/refresh/scopeSelector';
import type { CanonicalResourceRef, RefreshDomain } from '@/core/refresh/types';
import {
  installAppStateHarness,
  type MountedApp,
  type SidebarTarget,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { statusResponse } from '@/test-utils/appState/transport';
import { makeErrorStatus } from '@/test-utils/errorStatusFixtures';

const app = installAppStateHarness();
let dev: TestCluster;
let view: MountedApp;

type Identity = Pick<CanonicalResourceRef, 'group' | 'version' | 'kind' | 'resource'>;

const ref = (identity: Identity, name: string, namespace = ''): CanonicalResourceRef => ({
  clusterId: dev.clusterId,
  ...identity,
  namespace,
  name,
  uid: `${name}-uid`,
});

const CONFIG_MAP = { group: '', version: 'v1', kind: 'ConfigMap', resource: 'configmaps' };
const INGRESS = {
  group: 'networking.k8s.io',
  version: 'v1',
  kind: 'Ingress',
  resource: 'ingresses',
};
const PVC = {
  group: '',
  version: 'v1',
  kind: 'PersistentVolumeClaim',
  resource: 'persistentvolumeclaims',
};
const QUOTA = { group: '', version: 'v1', kind: 'ResourceQuota', resource: 'resourcequotas' };
const ROLE = {
  group: 'rbac.authorization.k8s.io',
  version: 'v1',
  kind: 'Role',
  resource: 'roles',
};
const EVENT = { group: '', version: 'v1', kind: 'Event', resource: 'events' };
const HPA = {
  group: 'autoscaling',
  version: 'v2',
  kind: 'HorizontalPodAutoscaler',
  resource: 'horizontalpodautoscalers',
};
const HELM_RELEASE = { group: 'helm.sh', version: 'v3', kind: 'HelmRelease', resource: 'releases' };
const STORAGE_CLASS = {
  group: 'storage.k8s.io',
  version: 'v1',
  kind: 'StorageClass',
  resource: 'storageclasses',
};
const PV = { group: '', version: 'v1', kind: 'PersistentVolume', resource: 'persistentvolumes' };
const CLUSTER_ROLE = {
  group: 'rbac.authorization.k8s.io',
  version: 'v1',
  kind: 'ClusterRole',
  resource: 'clusterroles',
};
const CRD = {
  group: 'apiextensions.k8s.io',
  version: 'v1',
  kind: 'CustomResourceDefinition',
  resource: 'customresourcedefinitions',
};

const eventRow = (name: string, namespace = '') => ({
  ref: ref(EVENT, name, namespace),
  resourceVersion: '1',
  objectKind: 'Pod',
  objectName: 'query',
  objectNamespace: namespace,
  objectUid: 'query-uid',
  type: 'Warning',
  source: 'kubelet',
  reason: 'QueryReason',
  object: 'Pod/query',
  message: `${name} message`,
  age: '2h',
  ageTimestamp: 2,
});

interface LeafView {
  label: string;
  view: string;
  domain: RefreshDomain;
  /** The default sort of the first read, as `<key> <direction>`. */
  sort: string;
  /** The page's one row, named `query-<view>`. */
  row: (name: string) => object;
  /** The columns the page query sorts by (backend/refresh/snapshot: each domain's sortable fields). */
  sortable: string[];
  /** The view's sidebar entry sits in the Extensions group. */
  extension?: boolean;
  /** Other reads the view makes. */
  serveOthers?: () => void;
}

const NAMESPACE_VIEWS: LeafView[] = [
  {
    label: 'config',
    view: 'config',
    domain: 'namespace-config',
    sort: 'name asc',
    row: (name) => ({ ref: ref(CONFIG_MAP, name, 'team-a'), data: 2, age: '2h' }),
    sortable: ['age', 'data', 'kind', 'name', 'namespace'],
  },
  {
    label: 'network',
    view: 'network',
    domain: 'namespace-network',
    sort: 'name asc',
    row: (name) => ({ ref: ref(INGRESS, name, 'team-a'), age: '2h' }),
    // Context and Network are slot columns backed by server sort fields;
    // Summary stays unsortable (mixed label and number text).
    sortable: ['age', 'context', 'kind', 'name', 'namespace', 'network'],
  },
  {
    label: 'storage',
    view: 'storage',
    domain: 'namespace-storage',
    sort: 'name asc',
    row: (name) => ({
      ref: ref(PVC, name, 'team-a'),
      capacity: '2Gi',
      status: 'Bound',
      storageClass: 'standard',
      age: '2h',
    }),
    sortable: ['age', 'capacity', 'kind', 'name', 'namespace', 'status', 'storageClass'],
  },
  {
    label: 'quotas',
    view: 'quotas',
    domain: 'namespace-quotas',
    sort: 'name asc',
    row: (name) => ({ ref: ref(QUOTA, name, 'team-a'), details: 'pods: 1/2', age: '2h' }),
    sortable: ['age', 'kind', 'name', 'namespace'],
  },
  {
    label: 'RBAC',
    view: 'rbac',
    domain: 'namespace-rbac',
    sort: 'name asc',
    row: (name) => ({ ref: ref(ROLE, name, 'team-a'), details: '2 rules', age: '2h' }),
    sortable: ['age', 'kind', 'name', 'namespace'],
  },
  {
    label: 'events',
    view: 'events',
    domain: 'namespace-events',
    sort: 'age asc',
    row: (name) => eventRow(name, 'team-a'),
    sortable: [
      'age',
      'kind',
      'message',
      'namespace',
      'objectName',
      'objectType',
      'reason',
      'source',
      'type',
    ],
  },
  {
    label: 'autoscaling',
    view: 'autoscaling',
    domain: 'namespace-autoscaling',
    sort: 'name asc',
    row: (name) => ({
      ref: ref(HPA, name, 'team-a'),
      target: 'Deployment/query',
      targetApiVersion: 'apps/v1',
      min: 1,
      max: 3,
      current: 2,
      age: '2h',
    }),
    sortable: ['age', 'current', 'kind', 'name', 'namespace', 'replicas', 'scaleTarget'],
  },
  {
    label: 'Helm',
    view: 'helm',
    extension: true,
    domain: 'namespace-helm',
    sort: 'name asc',
    row: (name) => ({
      ref: ref(HELM_RELEASE, name, 'team-a'),
      chart: 'query-1.0.0',
      appVersion: '1.0.0',
      status: 'deployed',
      revision: 2,
      updated: '2026-01-01T00:00:00Z',
      age: '2h',
    }),
    sortable: [
      'age',
      'appVersion',
      'chart',
      'kind',
      'name',
      'namespace',
      'revision',
      'status',
      'updated',
    ],
  },
  {
    label: 'pods',
    view: 'pods',
    domain: 'pods',
    sort: 'name asc',
    row: (name) =>
      makePodSnapshotEntry({ ref: { clusterId: dev.clusterId, namespace: 'team-a', name } }),
    sortable: [
      'age',
      'cpu',
      'memory',
      'name',
      'namespace',
      'node',
      'owner',
      'ready',
      'restarts',
      'status',
    ],
  },
  {
    label: 'workloads',
    view: 'workloads',
    domain: 'namespace-workloads',
    sort: 'name asc',
    row: (name) =>
      makeNamespaceWorkloadSummary({ clusterId: dev.clusterId, namespace: 'team-a', name }),
    sortable: ['age', 'cpu', 'kind', 'memory', 'name', 'namespace', 'ready', 'restarts', 'status'],
  },
];

const CLUSTER_VIEWS: LeafView[] = [
  {
    label: 'config',
    view: 'config',
    domain: 'cluster-config',
    sort: 'name asc',
    row: (name) => ({ ref: ref(STORAGE_CLASS, name), details: 'default', age: '2h' }),
    sortable: ['age', 'kind', 'name'],
  },
  {
    label: 'storage',
    view: 'storage',
    domain: 'cluster-storage',
    sort: 'name asc',
    row: (name) => ({
      ref: ref(PV, name),
      storageClass: 'standard',
      capacity: '2Gi',
      accessModes: 'RWO',
      status: 'Bound',
      claim: 'team-a/data',
      age: '2h',
    }),
    sortable: ['accessModes', 'age', 'capacity', 'claim', 'kind', 'name', 'status', 'storageClass'],
  },
  {
    label: 'RBAC',
    view: 'rbac',
    domain: 'cluster-rbac',
    sort: 'name asc',
    row: (name) => ({ ref: ref(CLUSTER_ROLE, name), details: '2 rules', age: '2h' }),
    sortable: ['age', 'kind', 'name'],
  },
  {
    label: 'CRDs',
    view: 'crds',
    extension: true,
    domain: 'cluster-crds',
    sort: 'name asc',
    row: (name) => ({
      ref: ref(CRD, `${name}.example.com`),
      group: 'example.com',
      scope: 'Namespaced',
      details: 'v1',
      age: '2h',
    }),
    sortable: ['age', 'group', 'kind', 'name', 'scope', 'version'],
  },
  {
    label: 'events',
    view: 'events',
    domain: 'cluster-events',
    sort: 'age asc',
    row: (name) => eventRow(name),
    sortable: ['age', 'kind', 'message', 'objectName', 'objectType', 'reason', 'source', 'type'],
  },
  {
    label: 'nodes',
    view: 'nodes',
    domain: 'nodes',
    sort: 'name asc',
    row: (name) => makeClusterNodeSnapshotEntry({ ref: { clusterId: dev.clusterId, name } }),
    // The Nodes view also lists drain jobs (backend/refresh/snapshot/node_maintenance.go).
    serveOthers: () =>
      app.snapshots.serve(
        'object-maintenance',
        buildClusterRefreshScope('object-maintenance', dev.clusterId),
        { clusterId: dev.clusterId, clusterName: dev.clusterName, drains: [] }
      ),
    sortable: ['age', 'cpu', 'kind', 'memory', 'name', 'pods', 'restarts', 'status', 'version'],
  },
];

/** The page scope a first read asks for: the default sort at the default page size. */
const firstPageScope = (selector: string, sort: string) => {
  const [key, direction] = sort.split(' ');
  return `${dev.clusterId}|${selector}?limit=50&sort=${key}&sortDirection=${direction}`;
};

const readScopes = (domain: RefreshDomain) => app.snapshots.reads(domain).map((read) => read.scope);

const renderedRows = () =>
  Array.from(view.container.querySelectorAll<HTMLElement>('.gridtable-row')).map(
    (row) => row.textContent ?? ''
  );

/** The keys of the visible table's sortable column headers (GridTable marks each one). */
const sortableColumns = () =>
  Array.from(
    view.container.querySelectorAll<HTMLElement>('.gridtable-header [data-sortable="true"]')
  )
    .map((header) => header.dataset.column ?? '')
    .sort((left, right) => left.localeCompare(right));

const start = async (leaf: LeafView, target: SidebarTarget) => {
  app.startScreen(dev);
  app.serveTable(dev, leaf.domain, { rows: [leaf.row(`query-${leaf.view}`)] } as never);
  leaf.serveOthers?.();
  if (leaf.extension) {
    // The user keeps the sidebar's Extensions group (collapsed by default) open.
    app.preferences({
      sidebarClusterExtensionsExpanded: true,
      sidebarNamespaceExtensionsExpanded: true,
    });
  }
  view = await app.mountApp();
  await view.goTo(target);
};

beforeEach(() => {
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['team-a', 'team-b']);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('query-backed leaf first load', () => {
  it.each(NAMESPACE_VIEWS)(
    'the namespace $label view reads its typed page in the namespace and under All Namespaces',
    async (leaf) => {
      await start(leaf, { namespace: 'team-a', view: leaf.view });

      expect(readScopes(leaf.domain)).toContain(firstPageScope('namespace:team-a', leaf.sort));
      expect(renderedRows()).toEqual([expect.stringContaining(`query-${leaf.view}`)]);

      await view.goTo({ namespace: 'namespace:all', view: leaf.view });

      expect(readScopes(leaf.domain)).toContain(firstPageScope('namespace:all', leaf.sort));
      expect(renderedRows()).toEqual([expect.stringContaining(`query-${leaf.view}`)]);
      expect(sortableColumns()).toEqual(leaf.sortable);
    }
  );

  it.each(CLUSTER_VIEWS)('the cluster $label view reads its typed page', async (leaf) => {
    await start(leaf, { clusterView: leaf.view });

    expect(readScopes(leaf.domain)).toContain(firstPageScope('', leaf.sort));
    expect(renderedRows()).toEqual([expect.stringContaining(`query-${leaf.view}`)]);
    expect(sortableColumns()).toEqual(leaf.sortable);
  });

  // A restricted identity (docs/architecture/namespace-scope.md): every read of
  // the domain answers a typed 403. The denial settles the table; the warm-up
  // retry must not re-arm into an endless first-load spinner.
  it('settles a permission-denied view on the permission state without retrying', async () => {
    app.startScreen(dev);
    app.snapshots.respond(({ domain }) =>
      domain === 'namespace-autoscaling'
        ? statusResponse(
            makeErrorStatus(
              'Forbidden',
              'permission denied for domain namespace-autoscaling (autoscaling/horizontalpodautoscalers)'
            )
          )
        : undefined
    );
    view = await app.mountApp();
    vi.useFakeTimers();
    await view.goTo({ namespace: 'namespace:all', view: 'autoscaling' });
    const reads = readScopes('namespace-autoscaling').length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    await app.settle();

    expect(readScopes('namespace-autoscaling')).toHaveLength(reads);
    expect(view.container.textContent).toContain('Insufficient permissions');
    expect(renderedRows()).toEqual([]);
  });
});
