/**
 * frontend/src/ui/layout/Sidebar.navigation.test.tsx
 *
 * Revealing an object's view (Alt+click on an object link) selects the
 * view's sidebar entry and opens the namespace and group that hold it, even
 * after the user collapsed them, without opening the other group; an
 * extension view is revealed once the visible cluster's discovery offers it.
 * Runs in the full app with an object link beside the layout, over a faked
 * backend (test-utils/appState) that lists the revealed object in its view.
 */

import { ObjectPanelLink } from '@shared/components/ObjectPanelLink';
import { peekPendingFocusRequest } from '@shared/components/tables/hooks/useGridTableExternalFocus';
import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  makeCatalogSnapshotPayload,
  makeClusterNodeSnapshotEntry,
} from '@/core/refresh/refreshContractTestBuilders';
import {
  buildClusterRefreshScope,
  buildRefreshScope,
  CLUSTER_SELECTOR,
} from '@/core/refresh/scopeSelector';
import type { CatalogSnapshotPayload, NamespaceConfigSummary } from '@/core/refresh/types';
import {
  installAppStateHarness,
  type MountedApp,
  type ObjectIdentity,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { snapshotResponse } from '@/test-utils/appState/transport';
import { requireValue } from '@/test-utils/requireValue';

const app = installAppStateHarness();
let dev: TestCluster;
let view: MountedApp;

type Target = ObjectIdentity & {
  resource: string;
  view: string;
  sidebarGroup: 'resources' | 'extensions';
};

const targets: Target[] = [
  {
    group: '',
    version: 'v1',
    kind: 'ConfigMap',
    resource: 'configmaps',
    namespace: 'default',
    name: 'example',
    view: 'config',
    sidebarGroup: 'resources',
  },
  {
    group: 'argoproj.io',
    version: 'v1alpha1',
    kind: 'Application',
    resource: 'applications',
    namespace: 'other',
    name: 'example',
    view: 'argocd',
    sidebarGroup: 'extensions',
  },
  {
    group: '',
    version: 'v1',
    kind: 'Node',
    resource: 'nodes',
    namespace: '',
    name: 'example',
    view: 'nodes',
    sidebarGroup: 'resources',
  },
  {
    group: 'karpenter.sh',
    version: 'v1',
    kind: 'NodePool',
    resource: 'nodepools',
    namespace: '',
    name: 'example',
    view: 'karpenter',
    sidebarGroup: 'extensions',
  },
];

const refOf = ({ resource, ...identity }: Target) => ({
  clusterId: dev.clusterId,
  group: identity.group,
  version: identity.version,
  kind: identity.kind,
  resource,
  namespace: identity.namespace,
  name: identity.name,
  uid: `${identity.name}-uid`,
});

/** The visible cluster's discovery and catalog pages, listing `target` (backend/objectcatalog). */
const catalogPage = (target: Target): CatalogSnapshotPayload =>
  makeCatalogSnapshotPayload({
    clusterId: dev.clusterId,
    clusterName: dev.clusterName,
    resourceFamilies: { cluster: ['karpenter'], namespaced: ['argocd'] },
    items: [
      {
        ref: refOf(target),
        resourceVersion: '1',
        creationTimestamp: '2026-10-01T00:00:00Z',
        scope: target.namespace ? 'Namespace' : 'Cluster',
      },
    ],
    total: 1,
    unfilteredTotal: 1,
  });

/** Serves the start screen and the revealed object's view, which lists the object. */
const serveReveal = (target: Target) => {
  app.namespaces(dev, ['default', 'other']);
  app.startScreen(dev);
  app.snapshots.answer(({ domain }) => (domain === 'catalog' ? catalogPage(target) : undefined));
  const configMap: NamespaceConfigSummary = { ref: refOf(target), data: 1, age: '1d' };
  app.serveTable(dev, 'namespace-config', {
    rows: target.kind === 'ConfigMap' ? [configMap] : [],
  });
  app.serveTable(dev, 'nodes', {
    rows: target.kind === 'Node' ? [makeClusterNodeSnapshotEntry({ ref: refOf(target) })] : [],
  });
  app.snapshots.serve(
    'object-maintenance',
    buildClusterRefreshScope('object-maintenance', dev.clusterId),
    { clusterId: dev.clusterId, clusterName: dev.clusterName, drains: [] }
  );
  // backend/refresh_object_catalog.go HydrateCatalogCustomRows: an extension
  // view's rows with their CRD and projected status.
  app.backend.answer(
    'HydrateCatalogCustomRows',
    (_clusterId, rows) =>
      (rows ?? []).map((row) => ({
        ref: row,
        crdName: `${row.resource}.${row.group}`,
        status: 'Ready',
        statusPresentation: 'ready',
        age: '1d',
      })) as never
  );
};

const start = async (target: Target) => {
  const { resource: _resource, view: _view, sidebarGroup: _group, ...identity } = target;
  view = await app.mountApp(
    <ObjectPanelLink objectRef={{ ...identity, clusterId: dev.clusterId }}>Reveal</ObjectPanelLink>
  );
};

const sidebar = () =>
  requireValue(view.container.querySelector<HTMLElement>('nav.sidebar'), 'expected the sidebar');
const sidebarEntry = (kind: string, match: { namespace?: string; view?: string; id?: string }) =>
  Array.from(
    sidebar().querySelectorAll<HTMLButtonElement>(`[data-sidebar-target-kind="${kind}"]`)
  ).find(
    (item) =>
      (match.namespace === undefined ||
        item.dataset.sidebarTargetNamespace === `${dev.clusterId}|${match.namespace}`) &&
      (match.view === undefined || item.dataset.sidebarTargetView === match.view) &&
      (match.id === undefined || item.dataset.sidebarTargetId === match.id)
  ) ?? null;
const destination = (target: Target) =>
  target.namespace
    ? sidebarEntry('namespace-view', { namespace: target.namespace, view: target.view })
    : sidebarEntry('cluster-view', { view: target.view });
const groupToggle = (target: Target, id: string) =>
  requireValue(
    target.namespace
      ? sidebarEntry('namespace-group-toggle', { namespace: target.namespace, id })
      : sidebarEntry('cluster-toggle', { id }),
    `expected the ${id} group`
  );
const namespaceToggle = (namespace: string) =>
  requireValue(sidebarEntry('namespace-toggle', { namespace }), `expected ${namespace}`);

const click = async (element: HTMLElement) => {
  await act(async () => element.click());
  await app.settle();
};

/** Alt+clicks the object link, as the user reveals the object's view. */
const reveal = async () => {
  const link = requireValue(
    view.container.querySelector<HTMLElement>('.object-panel-link'),
    'expected the object link'
  );
  await act(async () => {
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, altKey: true }));
  });
  await app.settle();
};

beforeEach(() => {
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  // Start from saved collapsed groups so every destination needs revealing.
  app.preferences({
    sidebarClusterResourcesExpanded: false,
    sidebarNamespaceResourcesExpanded: false,
  });
  // Mirrors backend/preferences_settings.go UpdateAppPreferences.
  app.backend.answer('UpdateAppPreferences', (request) => ({
    settings: null,
    changedKeys: (request.changes ?? []).map((change) => change.key),
  }));
});

describe('revealing an object’s view in the sidebar', () => {
  it.each(targets)(
    'reveals the $kind view and reveals it again after the user collapses it',
    async (target) => {
      serveReveal(target);
      await start(target);
      expect(destination(target)).toBeNull();

      await reveal();
      expect(destination(target)?.getAttribute('aria-current')).toBe('page');
      expect(view.owners().viewState).toMatchObject(
        target.namespace
          ? { viewType: 'namespace', activeNamespaceTab: target.view }
          : { viewType: 'cluster', activeClusterTab: target.view }
      );
      // The destination table lists the object, so the reveal lands on its row.
      expect(peekPendingFocusRequest()).toBeNull();
      const otherGroup = target.sidebarGroup === 'resources' ? 'extensions' : 'resources';
      expect(groupToggle(target, otherGroup).getAttribute('aria-expanded')).toBe('false');

      await click(groupToggle(target, target.sidebarGroup));
      expect(destination(target)).toBeNull();
      await reveal();
      expect(destination(target)?.getAttribute('aria-current')).toBe('page');

      if (target.namespace) {
        await click(namespaceToggle(target.namespace));
        expect(destination(target)).toBeNull();
        await reveal();
        expect(destination(target)?.getAttribute('aria-current')).toBe('page');
        const otherNamespace = target.namespace === 'default' ? 'other' : 'default';
        expect(namespaceToggle(otherNamespace).getAttribute('aria-expanded')).toBe('false');
        expect(view.owners().namespace.selectedNamespace).toBe(target.namespace);
      }
    }
  );

  it('reveals an extension view once the cluster’s discovery offers it', async () => {
    const target = requireValue(
      targets.find((candidate) => candidate.view === 'argocd'),
      'expected the Argo CD target'
    );
    serveReveal(target);
    const discoveryScope = buildRefreshScope('catalog', {
      clusterId: dev.clusterId,
      selector: CLUSTER_SELECTOR,
      query: 'limit=1',
    });
    let answerDiscovery: (() => void) | undefined;
    app.snapshots.respond(({ domain, scope }) =>
      domain === 'catalog' && scope === discoveryScope
        ? new Promise<Response>((resolve) => {
            answerDiscovery = () =>
              resolve(
                snapshotResponse({ domain, scope, version: 1, payload: catalogPage(target) })
              );
          })
        : undefined
    );
    await start(target);

    await reveal();
    expect(destination(target)).toBeNull();
    expect(groupToggle(target, 'extensions').getAttribute('aria-expanded')).toBe('false');

    app.snapshots.respond(null);
    await act(async () => answerDiscovery?.());
    await app.settle();

    expect(destination(target)?.getAttribute('aria-current')).toBe('page');
  });
});
