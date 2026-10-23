/**
 * frontend/src/ui/layout/Sidebar.test.tsx
 *
 * The workspace sidebar: which views it offers directly and under its
 * Resources and Extensions groups (including extension views the visible
 * cluster discovered), navigation through the real view state, namespace
 * expansion, the namespace list's loading, paused, dimmed, and unavailable
 * states, the visible cluster's Attention counts, persisted group
 * disclosure, the Global section, keyboard traversal, and hiding the
 * sidebar. Runs in the full app, acting through the sidebar's DOM as the user
 * does, over a faked backend (test-utils/appState). Scope editing is covered
 * by NamespaceScopeEditor.test.tsx; revealing an object's view by
 * Sidebar.navigation.test.tsx.
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  makeCatalogSnapshotPayload,
  makeClusterAttentionSnapshot,
} from '@/core/refresh/refreshContractTestBuilders';
import { buildClusterRefreshScope } from '@/core/refresh/scopeSelector';
import type { NamespaceSummary } from '@/core/refresh/types';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { snapshotResponse } from '@/test-utils/appState/transport';
import { requireValue } from '@/test-utils/requireValue';

const app = installAppStateHarness();
let dev: TestCluster;
let view: MountedApp;

type Families = { cluster?: string[]; namespaced?: string[] };
type SeverityCounts = { info: number; warning: number; error: number };

/**
 * Serves what the sidebar and the views these tests open read for `cluster`:
 * its namespaces, start screen, discovered extension families (every catalog
 * read), Attention counts, and the Config and namespace RBAC tables.
 */
const serveCluster = (
  cluster: TestCluster,
  {
    namespaces = ['default'],
    families = {},
    attention,
  }: { namespaces?: string[]; families?: Families; attention?: SeverityCounts } = {}
) => {
  const identity = { clusterId: cluster.clusterId, clusterName: cluster.clusterName };
  app.namespaces(cluster, namespaces);
  app.startScreen(cluster);
  app.snapshots.answer(({ domain, scope }) =>
    domain === 'catalog' && scope.startsWith(`${cluster.clusterId}|`)
      ? makeCatalogSnapshotPayload({ ...identity, resourceFamilies: families })
      : undefined
  );
  if (attention) {
    app.snapshots.serve(
      'cluster-attention',
      buildClusterRefreshScope('cluster-attention', cluster.clusterId),
      makeClusterAttentionSnapshot({ ...identity, severityCounts: attention })
    );
  }
  app.serveTable(cluster, 'cluster-config');
  app.serveTable(cluster, 'namespace-config');
  app.serveTable(cluster, 'namespace-rbac');
};

/** A namespaces row as backend/refresh/snapshot/namespaces.go projects it. */
const namespaceRow = (
  cluster: TestCluster,
  name: string,
  row: Partial<NamespaceSummary> = {}
): NamespaceSummary => ({
  ref: {
    clusterId: cluster.clusterId,
    group: '',
    version: 'v1',
    kind: 'Namespace',
    resource: 'namespaces',
    namespace: '',
    name,
    uid: `${name}-uid`,
  },
  phase: 'Active',
  resourceVersion: '1',
  creationTimestamp: 0,
  hasWorkloads: true,
  warningEventsState: 'available',
  quotaPressureState: 'available',
  ...row,
});

const serveNamespaceRows = (cluster: TestCluster, rows: NamespaceSummary[]) => {
  app.snapshots.serve(
    'namespaces',
    buildClusterRefreshScope('namespaces', cluster.clusterId),
    { clusterId: cluster.clusterId, clusterName: cluster.clusterName, namespaces: rows },
    rows.length
  );
};

const viewState = () => requireValue(view.owners().viewState, 'expected workspace view state');
const sidebar = () =>
  requireValue(view.container.querySelector<HTMLElement>('nav.sidebar'), 'expected the sidebar');

const entry = (selector: string) => sidebar().querySelector<HTMLButtonElement>(selector);
const requireEntry = (selector: string) => requireValue(entry(selector), `expected ${selector}`);
const clusterView = (id: string) =>
  entry(`[data-sidebar-target-kind="cluster-view"][data-sidebar-target-view="${id}"]`);
const clusterGroup = (id: string) =>
  requireEntry(`[data-sidebar-target-kind="cluster-toggle"][data-sidebar-target-id="${id}"]`);
/**
 * A namespace's sidebar entry of `kind`, matched on its data attributes (a
 * cluster id may hold characters a selector would need escaped).
 */
const namespaceEntry = (
  kind: string,
  namespace: string,
  cluster: TestCluster,
  match: { view?: string; id?: string } = {}
) =>
  Array.from(
    sidebar().querySelectorAll<HTMLButtonElement>(`[data-sidebar-target-kind="${kind}"]`)
  ).find(
    (item) =>
      item.dataset.sidebarTargetNamespace === `${cluster.clusterId}|${namespace}` &&
      (match.view === undefined || item.dataset.sidebarTargetView === match.view) &&
      (match.id === undefined || item.dataset.sidebarTargetId === match.id)
  ) ?? null;
const namespaceToggle = (namespace: string, cluster = dev) =>
  requireValue(
    namespaceEntry('namespace-toggle', namespace, cluster),
    `expected the ${namespace} namespace`
  );
const namespaceView = (namespace: string, id: string, cluster = dev) =>
  namespaceEntry('namespace-view', namespace, cluster, { view: id });
const namespaceGroup = (namespace: string, id: string, cluster = dev) =>
  requireValue(
    namespaceEntry('namespace-group-toggle', namespace, cluster, { id }),
    `expected the ${namespace} namespace's ${id} group`
  );
const expanded = (element: HTMLElement) => element.getAttribute('aria-expanded') === 'true';
const buttonNamed = (label: string) =>
  requireValue(
    Array.from(view.container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.getAttribute('aria-label') === label
    ),
    `expected the ${label} button`
  );

/** The view a sidebar entry targets, or its group toggle's id. */
const describeTarget = (element: HTMLElement) =>
  element.dataset.sidebarTargetView ??
  `${element.dataset.sidebarTargetKind}:${element.dataset.sidebarTargetId ?? ''}`;

const click = async (element: HTMLElement) => {
  await act(async () => element.click());
  await app.settle();
};

const press = async (key: string, init: KeyboardEventInit = {}) => {
  const target = requireValue(document.activeElement, 'expected a focused control');
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  await act(async () => {
    target.dispatchEvent(event);
  });
  await app.settle();
  return event;
};

const focus = async (element: HTMLElement) => {
  await act(async () => element.focus());
};

/** Group expansions the sidebar persisted, as UpdateAppPreferences received them. */
const persistedDisclosures = () =>
  app.backend.calls('UpdateAppPreferences').flatMap(([request]) => request.changes ?? []);

beforeEach(() => {
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  // Mirrors backend/preferences_settings.go UpdateAppPreferences.
  app.backend.answer('UpdateAppPreferences', (request) => ({
    settings: null,
    changedKeys: (request.changes ?? []).map((change) => change.key),
  }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Sidebar', () => {
  it('offers only the primary views directly, with Resources open and Extensions closed', async () => {
    serveCluster(dev);
    view = await app.mountApp();

    const clusterItems = requireValue(
      sidebar().querySelector<HTMLElement>('.cluster-items'),
      'expected the cluster entries'
    );
    expect(
      Array.from(clusterItems.querySelectorAll<HTMLElement>(':scope > button'), describeTarget)
    ).toEqual(['overview:', 'attention', 'browse', 'events', 'identities']);
    expect(requireEntry('[data-sidebar-target-kind="overview"]').getAttribute('aria-current')).toBe(
      'page'
    );
    const resources = clusterGroup('resources');
    expect(expanded(resources)).toBe(true);
    expect(
      document
        .getElementById(resources.getAttribute('aria-controls') ?? '')
        ?.contains(clusterView('nodes'))
    ).toBe(true);
    expect(expanded(clusterGroup('extensions'))).toBe(false);
    expect(clusterView('crds')).toBeNull();

    const defaultNamespace = namespaceToggle('default');
    expect(expanded(defaultNamespace)).toBe(false);
    await click(defaultNamespace);
    expect(expanded(defaultNamespace)).toBe(true);
    const namespaceViews = requireValue(
      document.getElementById(defaultNamespace.getAttribute('aria-controls') ?? ''),
      'expected the namespace’s views'
    );
    expect(
      Array.from(namespaceViews.querySelectorAll<HTMLElement>(':scope > button'), describeTarget)
    ).toEqual(['browse', 'events', 'map']);
    expect(expanded(namespaceGroup('default', 'resources'))).toBe(true);
    expect(namespaceView('default', 'workloads')).not.toBeNull();
    expect(expanded(namespaceGroup('default', 'extensions'))).toBe(false);
    expect(
      Array.from(sidebar().querySelectorAll('[data-sidebar-target-kind]')).every(
        (item) => item.tagName === 'BUTTON'
      )
    ).toBe(true);
  });

  it('navigates through the real view state from cluster, namespace, and Overview entries', async () => {
    serveCluster(dev);
    view = await app.mountApp();

    // Expanding a namespace only reveals its views.
    await click(namespaceToggle('default'));
    expect(viewState().viewType).toBe('overview');
    expect(view.owners().namespace.selectedNamespace).toBeUndefined();

    await view.goTo({ clusterView: 'config' });
    expect(viewState()).toMatchObject({
      viewType: 'cluster',
      activeClusterTab: 'config',
      sidebarSelection: { type: 'cluster', value: 'cluster' },
    });
    expect(clusterView('config')?.getAttribute('aria-current')).toBe('page');

    await view.goTo({ namespace: 'default', view: 'config' });
    expect(viewState()).toMatchObject({
      viewType: 'namespace',
      activeNamespaceTab: 'config',
      sidebarSelection: { type: 'namespace', value: 'default' },
    });
    expect(view.owners().namespace).toMatchObject({
      selectedNamespace: 'default',
      selectedNamespaceClusterId: dev.clusterId,
    });

    // Another view of the namespace already selected keeps the selection.
    await view.goTo({ namespace: 'default', view: 'rbac' });
    expect(viewState()).toMatchObject({
      viewType: 'namespace',
      activeNamespaceTab: 'rbac',
      sidebarSelection: { type: 'namespace', value: 'default' },
    });
    expect(namespaceView('default', 'rbac')?.getAttribute('aria-current')).toBe('page');

    await view.goTo({ clusterView: 'overview' });
    expect(viewState()).toMatchObject({
      viewType: 'overview',
      sidebarSelection: { type: 'overview', value: 'overview' },
    });
  });

  it.each([true, false])(
    'expands one namespace at a time only while exclusive namespaces is on (%s)',
    async (exclusive) => {
      app.preferences({ exclusiveNamespaces: exclusive });
      serveCluster(dev, { namespaces: ['default', 'kube-system'] });
      view = await app.mountApp();

      await click(namespaceToggle('default'));
      await click(namespaceToggle('kube-system'));
      expect(expanded(namespaceToggle('kube-system'))).toBe(true);
      expect(expanded(namespaceToggle('default'))).toBe(!exclusive);

      await click(namespaceToggle('kube-system'));
      expect(expanded(namespaceToggle('kube-system'))).toBe(false);
      expect(namespaceView('kube-system', 'browse')).toBeNull();
    }
  );

  it('expands All Namespaces without selecting a namespace and offers only views that span namespaces', async () => {
    app.preferences({ exclusiveNamespaces: false });
    serveCluster(dev);
    view = await app.mountApp();

    await click(namespaceToggle('namespace:all'));
    await click(namespaceToggle('default'));

    expect(view.owners().namespace.selectedNamespace).toBeUndefined();
    expect(viewState().viewType).toBe('overview');
    expect(namespaceView('namespace:all', 'config')).not.toBeNull();
    expect(namespaceView('namespace:all', 'map')).toBeNull();
    expect(namespaceView('default', 'map')).not.toBeNull();
  });

  it.each([true, false])(
    'dims only namespaces confirmed to have no workloads (dimming on: %s)',
    async (dim) => {
      app.preferences({ dimInactiveNamespaces: dim });
      serveCluster(dev);
      serveNamespaceRows(dev, [
        namespaceRow(dev, 'active'),
        namespaceRow(dev, 'empty', { hasWorkloads: false }),
        namespaceRow(dev, 'pending', { hasWorkloads: false, workloadsUnknown: true }),
      ]);
      view = await app.mountApp();

      expect(namespaceToggle('empty').classList.contains('dimmed')).toBe(dim);
      // Not-yet-known workloads (ingest still settling) look like any namespace.
      expect(namespaceToggle('pending').className).toBe(namespaceToggle('active').className);
    }
  );

  it('keeps a scope namespace the backend cannot find from expanding or taking keyboard focus', async () => {
    serveCluster(dev);
    serveNamespaceRows(dev, [
      namespaceRow(dev, 'default'),
      namespaceRow(dev, 'ghost', { scopeStatus: 'not-found', workloadsUnknown: true }),
      namespaceRow(dev, 'team-a'),
    ]);
    view = await app.mountApp();

    const ghost = namespaceToggle('ghost');
    expect(ghost.disabled).toBe(true);
    await click(ghost);
    expect(namespaceView('ghost', 'browse')).toBeNull();

    await focus(namespaceToggle('default'));
    await press('ArrowDown');
    expect(document.activeElement).toBe(namespaceToggle('team-a'));
  });

  it('shows the namespace list as loading until the backend answers', async () => {
    serveCluster(dev);
    let answerNamespaces: (() => void) | undefined;
    app.snapshots.respond(({ domain, scope }) =>
      domain === 'namespaces'
        ? new Promise<Response>((resolve) => {
            answerNamespaces = () =>
              resolve(
                snapshotResponse({
                  domain,
                  scope,
                  version: 1,
                  payload: {
                    clusterId: dev.clusterId,
                    clusterName: dev.clusterName,
                    namespaces: [namespaceRow(dev, 'default')],
                  },
                })
              );
          })
        : undefined
    );
    view = await app.mountApp();
    const namespacesSection = () =>
      requireValue(
        sidebar().querySelector<HTMLElement>('.namespaces-section'),
        'expected the namespaces section'
      );
    expect(namespacesSection().textContent).toContain('Loading namespaces');

    await act(async () => answerNamespaces?.());
    await app.settle();

    expect(namespacesSection().textContent).not.toContain('Loading namespaces');
    expect(namespaceToggle('default')).toBeDefined();
  });

  it('shows the paused state instead of loading namespaces while auto-refresh is off', async () => {
    app.preferences({ autoRefreshEnabled: false });
    serveCluster(dev);
    view = await app.mountApp();

    expect(app.snapshots.reads('namespaces')).toEqual([]);
    expect(sidebar().querySelector('.namespaces-section')?.textContent).toContain(
      'Auto-refresh is disabled'
    );
    expect(sidebar().querySelector('[data-sidebar-target-kind="namespace-toggle"]')).toBeNull();
  });

  it('shows the visible cluster’s Attention counts and follows a cluster switch', async () => {
    const staging = app.cluster({ name: 'dev', context: 'staging' });
    serveCluster(dev, { attention: { info: 2, warning: 3, error: 1 } });
    serveCluster(staging, { attention: { info: 0, warning: 4, error: 2 } });
    view = await app.mountApp();
    const attention = () => requireValue(clusterView('attention'), 'expected Attention');
    const visibleCounts = () =>
      Array.from(attention().querySelectorAll('.sidebar-attention-badge'), (badge) =>
        badge.textContent?.trim()
      );

    expect(attention().getAttribute('aria-label')).toBe('Attention: 2 info, 3 warnings, 1 error');
    expect(visibleCounts()).toEqual(['2', '3', '1']);

    await view.selectCluster(staging);

    expect(attention().getAttribute('aria-label')).toBe('Attention: 0 info, 4 warnings, 2 errors');
    expect(visibleCounts()).toEqual(['4', '2']);
  });

  it('offers discovered extension views only in the cluster that discovered them', async () => {
    app.preferences({
      sidebarClusterExtensionsExpanded: true,
      sidebarNamespaceExtensionsExpanded: true,
    });
    const staging = app.cluster({ name: 'dev', context: 'staging' });
    serveCluster(dev, { families: { cluster: ['karpenter'], namespaced: ['argocd'] } });
    serveCluster(staging);
    view = await app.mountApp();

    await click(namespaceToggle('default'));
    expect(clusterView('karpenter')).not.toBeNull();
    expect(namespaceView('default', 'argocd')).not.toBeNull();
    // A namespaced family is never offered as a cluster view.
    expect(clusterView('argocd')).toBeNull();

    await view.selectCluster(staging);
    await click(namespaceToggle('default', staging));
    expect(clusterView('karpenter')).toBeNull();
    expect(namespaceView('default', 'argocd', staging)).toBeNull();
    expect(namespaceView('default', 'events', staging)).not.toBeNull();
  });

  it('keeps primary views reachable while the groups collapse, and persists each disclosure', async () => {
    app.preferences({ sidebarClusterResourcesExpanded: false });
    serveCluster(dev, { families: { cluster: ['karpenter'] } });
    view = await app.mountApp();
    const resources = clusterGroup('resources');
    const extensions = clusterGroup('extensions');
    expect(expanded(resources)).toBe(false);
    expect(expanded(extensions)).toBe(false);
    expect(clusterView('nodes')).toBeNull();
    expect(clusterView('karpenter')).toBeNull();
    expect(clusterView('browse')).not.toBeNull();
    expect(clusterView('events')).not.toBeNull();

    await focus(resources);
    await press('ArrowDown');
    expect(document.activeElement).toBe(extensions);
    await press('Enter');
    expect(expanded(extensions)).toBe(true);
    expect(clusterView('karpenter')).not.toBeNull();
    expect(clusterView('nodes')).toBeNull();

    await press('ArrowUp');
    expect(document.activeElement).toBe(resources);
    await press(' ');
    expect(expanded(resources)).toBe(true);
    await press('ArrowDown');
    expect(document.activeElement).toBe(clusterView('config'));
    await press('Enter');
    expect(viewState()).toMatchObject({ viewType: 'cluster', activeClusterTab: 'config' });

    expect(persistedDisclosures()).toEqual([
      { key: 'sidebarClusterExtensionsExpanded', value: true },
      { key: 'sidebarClusterResourcesExpanded', value: true },
    ]);
  });

  it('shares namespace group disclosure across namespaces and clusters, apart from the cluster groups', async () => {
    app.preferences({ exclusiveNamespaces: false });
    const staging = app.cluster({ name: 'dev', context: 'staging' });
    serveCluster(dev, { namespaces: ['default', 'other'] });
    serveCluster(staging);
    view = await app.mountApp();
    await click(namespaceToggle('default'));
    await click(namespaceToggle('other'));

    await click(namespaceGroup('default', 'resources'));

    expect(expanded(namespaceGroup('default', 'resources'))).toBe(false);
    expect(expanded(namespaceGroup('other', 'resources'))).toBe(false);
    expect(namespaceView('other', 'workloads')).toBeNull();
    expect(expanded(clusterGroup('resources'))).toBe(true);
    expect(persistedDisclosures()).toEqual([
      { key: 'sidebarNamespaceResourcesExpanded', value: false },
    ]);

    await view.selectCluster(staging);
    await click(namespaceToggle('default', staging));
    expect(expanded(namespaceGroup('default', 'resources', staging))).toBe(false);
    expect(expanded(clusterGroup('resources'))).toBe(true);
  });

  it('keeps a manual collapse when the sidebar is hidden and shown while a grouped view is open', async () => {
    serveCluster(dev);
    view = await app.mountApp();
    await view.goTo({ clusterView: 'config' });

    await click(clusterGroup('resources'));
    expect(clusterView('config')).toBeNull();
    await click(buttonNamed('Hide Sidebar'));
    await click(buttonNamed('Show Sidebar'));

    expect(expanded(clusterGroup('resources'))).toBe(false);
    expect(clusterView('config')).toBeNull();
    expect(viewState().activeClusterTab).toBe('config');
  });

  it('scrolls the whole expanded namespace group into view, after toggling and after its animation', async () => {
    // A kubeconfig context name may contain quotes; the group is still found.
    const quoted = app.cluster({ name: 'dev', context: 'team"b' });
    serveCluster(dev);
    serveCluster(quoted);
    view = await app.mountApp();
    await view.selectCluster(quoted);
    const toggle = namespaceToggle('default', quoted);
    vi.useFakeTimers();

    await act(async () => toggle.click());
    const list = requireValue(toggle.closest<HTMLElement>('.namespace-items'), 'expected the list');
    const group = requireValue(
      toggle.closest<HTMLElement>('.sidebar-namespace-group'),
      'expected the namespace group'
    );
    let groupBottom = 900;
    list.getBoundingClientRect = () => DOMRect.fromRect({ y: 200, height: 600 });
    group.getBoundingClientRect = () => DOMRect.fromRect({ y: 450, height: groupBottom - 450 });
    const scrollGroup = vi.fn();
    const scrollName = vi.fn();
    group.scrollIntoView = scrollGroup;
    toggle.scrollIntoView = scrollName;

    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(scrollGroup).toHaveBeenCalledWith({ block: 'nearest', behavior: 'smooth' });
    expect(scrollName).not.toHaveBeenCalled();

    // The group grows as its views animate open; the end of the animation checks again.
    scrollGroup.mockClear();
    groupBottom = 700;
    const views = requireValue(group.querySelector('.sidebar-views'), 'expected the views');
    await act(async () => views.dispatchEvent(new Event('animationend', { bubbles: true })));
    expect(scrollGroup).not.toHaveBeenCalled();
    groupBottom = 900;
    await act(async () => views.dispatchEvent(new Event('animationend', { bubbles: true })));
    expect(scrollGroup).toHaveBeenCalledWith({ block: 'nearest', behavior: 'smooth' });
  });

  it('enters Global from the cluster tabs and offers only cross-cluster views there', async () => {
    const staging = app.cluster({ name: 'dev', context: 'staging' });
    serveCluster(dev);
    serveCluster(staging);
    view = await app.mountApp();
    const globalEntries = () =>
      Array.from(
        sidebar().querySelectorAll<HTMLElement>('[data-sidebar-target-kind="global-view"]'),
        describeTarget
      );
    expect(globalEntries()).toEqual([]);
    await view.goTo({ clusterView: 'config' });
    expect(globalEntries()).toEqual([]);
    await view.goTo({ namespace: 'default', view: 'config' });
    expect(globalEntries()).toEqual([]);

    const globalTab = requireValue(
      Array.from(view.container.querySelectorAll<HTMLElement>('[role="tab"]')).find(
        (tab) => tab.textContent?.trim() === 'Global'
      ),
      'expected the Global tab'
    );
    await click(globalTab);

    expect(globalEntries()).toEqual(['fleet', 'global-namespaces']);
    expect(
      requireEntry('[data-sidebar-target-kind="overview"]').closest('[hidden]')
    ).not.toBeNull();
    expect(sidebar().querySelector('.namespaces-section')?.hasAttribute('hidden')).toBe(true);

    await view.goTo({ globalView: 'global-namespaces' });
    expect(viewState()).toMatchObject({
      viewType: 'global',
      activeGlobalTab: 'global-namespaces',
    });
  });

  it('opens the namespace command palette from the Namespaces header', async () => {
    serveCluster(dev);
    view = await app.mountApp();

    await click(buttonNamed('Select namespace'));

    expect(document.querySelector('dialog.command-palette[open]')).not.toBeNull();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Select a namespace');
  });

  it('hides and shows the sidebar from its toggle and persists the choice', async () => {
    const lastVisibility = () => {
      const calls = app.backend.calls('SetSidebarVisible');
      return calls[calls.length - 1]?.[0];
    };
    serveCluster(dev);
    view = await app.mountApp();

    await click(buttonNamed('Hide Sidebar'));

    expect(viewState().isSidebarVisible).toBe(false);
    expect(sidebar().tabIndex).toBe(-1);
    expect(sidebar().querySelector('[data-sidebar-target-kind]')).toBeNull();
    expect(lastVisibility()).toBe(false);

    await click(buttonNamed('Show Sidebar'));

    expect(viewState().isSidebarVisible).toBe(true);
    expect(sidebar().querySelector('[data-sidebar-target-kind="overview"]')).not.toBeNull();
    expect(lastVisibility()).toBe(true);
  });
});

describe('Sidebar keyboard traversal', () => {
  it('Tabs from a clicked entry through the sidebar’s other controls and back without navigating', async () => {
    serveCluster(dev);
    view = await app.mountApp();
    const config = requireValue(clusterView('config'), 'expected Config');
    await focus(config);
    await click(config);
    const hide = buttonNamed('Hide Sidebar');
    const selectNamespace = buttonNamed('Select namespace');

    await press('Tab');
    expect(document.activeElement).toBe(hide);
    expect(hide.classList.contains('keyboard-programmatic-focus')).toBe(true);
    await press('Tab');
    expect(document.activeElement).toBe(selectNamespace);
    await press('Tab', { shiftKey: true });
    expect(document.activeElement).toBe(hide);
    await press('Tab', { shiftKey: true });
    expect(document.activeElement).toBe(config);
    expect(viewState().activeClusterTab).toBe('config');
  });

  it.each([
    ['forward from the header', false],
    ['backward from the content', true],
  ])(
    'Control+Tab %s lands on the current list entry, even after other sidebar controls',
    async (_, backwards) => {
      serveCluster(dev);
      view = await app.mountApp();
      const outside = requireValue(
        view.container.querySelector<HTMLElement>(
          backwards ? '[data-app-region="content"]' : '[data-app-region="header"] button'
        ),
        'expected a control outside the sidebar'
      );
      const overview = requireEntry('[data-sidebar-target-kind="overview"]');
      const enterSidebar = async () => {
        await focus(outside);
        await press('Tab', { ctrlKey: true, shiftKey: backwards });
      };

      await enterSidebar();
      expect(document.activeElement).toBe(overview);
      for (const control of [buttonNamed('Hide Sidebar'), buttonNamed('Select namespace')]) {
        await focus(control);
        await enterSidebar();
        expect(document.activeElement).toBe(overview);
      }
      await press('ArrowDown');
      expect(document.activeElement).toBe(clusterView('attention'));
      await enterSidebar();
      expect(document.activeElement).toBe(clusterView('attention'));
      expect(viewState().viewType).toBe('overview');

      await press('Tab');
      expect(document.activeElement).toBe(buttonNamed('Hide Sidebar'));
    }
  );

  it.each(['Enter', ' '])('leaves %j on the Select namespace button to the button', async (key) => {
    serveCluster(dev);
    view = await app.mountApp();
    const selectNamespace = buttonNamed('Select namespace');
    await focus(selectNamespace);

    expect((await press(key)).defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(selectNamespace);
    expect(viewState().viewType).toBe('overview');
  });

  it('lets modified arrow and Space keys through to global shortcuts', async () => {
    serveCluster(dev);
    view = await app.mountApp();
    await focus(requireEntry('[data-sidebar-target-kind="overview"]'));

    expect((await press('ArrowDown', { metaKey: true })).defaultPrevented).toBe(false);
    expect((await press(' ', { code: 'Space', shiftKey: true })).defaultPrevented).toBe(false);
    expect((await press('ArrowDown')).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(clusterView('attention'));
  });
});
