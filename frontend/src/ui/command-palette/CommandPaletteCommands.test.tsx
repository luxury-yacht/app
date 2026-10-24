/**
 * frontend/src/ui/command-palette/CommandPaletteCommands.test.tsx
 *
 * The app's commands in the command palette, as AppLayout wires them
 * (useCommandPaletteCommands into CommandPalette): the views each one opens
 * in the real navigation state, offered only where they exist (a discovered
 * API family, a selected namespace, two open clusters for Global views); the
 * namespace and kubeconfig pickers, which select a namespace, open a closed
 * context as a cluster tab, switch to an open one, and refuse an invalid one;
 * closing the active cluster tab, except from the Global workspace; the
 * application commands; and the settings commands, which persist their new
 * value and report a failure under their own name. Runs in provider mode
 * inside the real app shell (kubeconfig, view-state, namespace, zoom,
 * favorites, and preference owners), with only the backend boundary faked
 * (test-utils/appState); the app header's and sidebar's palette buttons run
 * in the full app.
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backend } from '@/core/backend-api/models';
import { makeCatalogSnapshotPayload } from '@/core/refresh/refreshContractTestBuilders';
import { buildRefreshScope, CLUSTER_SELECTOR } from '@/core/refresh/scopeSelector';
import type { CatalogSnapshotPayload } from '@/core/refresh/types';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';
import { CommandPalette } from './CommandPalette';
import { useCommandPaletteCommands } from './CommandPaletteCommands';

const app = installAppStateHarness();
let dev: TestCluster;
let view: MountedApp;

/** The palette with the app's commands, as AppLayout renders it. */
function AppCommandPalette() {
  return <CommandPalette commands={useCommandPaletteCommands()} />;
}

/**
 * Adds an open cluster with its namespaces and the API families its catalog
 * discovered (core/navigation/useAvailableResourceViews.ts).
 */
const openCluster = (
  name: string,
  context: string,
  families: CatalogSnapshotPayload['resourceFamilies'] = {},
  fixture: { open?: boolean } = {}
) => {
  const cluster = app.cluster({ name, context, ...fixture });
  app.namespaces(cluster, ['default', 'team-a']);
  app.snapshots.serve(
    'catalog',
    buildRefreshScope('catalog', {
      clusterId: cluster.clusterId,
      selector: CLUSTER_SELECTOR,
      query: 'limit=1',
    }),
    makeCatalogSnapshotPayload({
      clusterId: cluster.clusterId,
      clusterName: cluster.clusterName,
      resourceFamilies: families,
    })
  );
  return cluster;
};

const showPalette = async () => {
  view = await app.render(null);
  await view.show(<AppCommandPalette />);
};

const viewState = () => requireValue(view.owners().viewState, 'expected the view state');
const kubeconfig = () => view.owners().kubeconfig;

/** Delivers a native menu event, as the backend does. */
const menu = async (name: string) => {
  await act(async () => {
    app.events.emit(name);
  });
  await app.settle();
};

const palette = () => document.querySelector('dialog.command-palette');

const type = async (text: string) => {
  const input = requireValue(
    document.querySelector<HTMLInputElement>('.command-palette [role="combobox"]'),
    'expected the command-palette input'
  );
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, text);
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });
};

const options = () =>
  Array.from(document.querySelectorAll<HTMLElement>('.command-palette [role="option"]'));

// A result's label, without its icon or shortcut keycaps.
const labelOf = (option: HTMLElement) =>
  option.querySelector('.command-palette-item-label')?.textContent?.trim() ?? '';

const optionLabels = () => options().map(labelOf);

// A kubeconfig result's context name (KubeconfigContextLabel).
const contextOf = (option: HTMLElement) =>
  option.querySelector('.kubeconfig-label__context')?.textContent ?? '';

/** Opens the palette from the View menu and lists what `query` finds. */
const search = async (query: string) => {
  if (!palette()) {
    await menu('open-command-palette');
  }
  await type(query);
  return optionLabels();
};

const closePalette = async () => {
  await act(async () => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
  });
};

/** Clicks a result; its command runs once the palette has closed. */
const click = async (option: HTMLElement) => {
  await act(async () => option.click());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
  await app.settle();
};

/** Clicks the result labelled `label`. */
const choose = (label: string) =>
  click(
    requireValue(
      options().find((option) => labelOf(option) === label),
      `expected the ${label} result among ${optionLabels().join(', ')}`
    )
  );

/** Clicks the kubeconfig picker's result for `context`. */
const chooseContext = (context: string) =>
  click(
    requireValue(
      options().find((option) => contextOf(option) === context),
      `expected the ${context} context`
    )
  );

/** Searches for `query` and runs the result labelled `label`. */
const run = async (query: string, label: string) => {
  await search(query);
  await choose(label);
};

const contextLabels = () => options().map(contextOf);

beforeEach(() => {
  // Typing also searches the selected cluster's catalog; these searches find nothing.
  app.snapshots.answer(({ domain, scope }) =>
    domain === 'catalog' && scope.includes('limit=20')
      ? makeCatalogSnapshotPayload({ clusterId: scope.split('|')[0] })
      : undefined
  );
  app.backend.answer('UpdateAppPreferences', (request) => ({
    settings: null,
    changedKeys: (request.changes ?? []).map((change) => change.key),
  }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('navigation commands', () => {
  it('offers Karpenter only in a cluster that discovered its APIs, and opens it there', async () => {
    dev = openCluster('dev', 'alpha');
    const prod = openCluster('prod', 'beta', { cluster: ['karpenter'] });
    await showPalette();
    vi.useFakeTimers();

    expect(await search('karpenter')).not.toContain('Cluster - Karpenter');
    await closePalette();
    expect(palette()).toBeNull();
    await view.selectCluster(prod);
    await run('karpenter', 'Cluster - Karpenter');

    expect(viewState().viewType).toBe('cluster');
    expect(viewState().activeClusterTab).toBe('karpenter');
  });

  it('finds a cluster view by its vocabulary and opens it', async () => {
    dev = openCluster('dev', 'alpha');
    await showPalette();
    vi.useFakeTimers();

    expect(await search('inventory')).toContain('Cluster - Browse');
    await run('capacity', 'Cluster - Nodes');

    expect(viewState().viewType).toBe('cluster');
    expect(viewState().activeClusterTab).toBe('nodes');
  });

  it('offers namespace views once a namespace is selected, and opens them in that namespace', async () => {
    dev = openCluster('dev', 'alpha');
    await showPalette();
    vi.useFakeTimers();
    expect(await search('Namespace - ')).toEqual([]);

    await run('team-a', 'team-a');
    expect(view.owners().namespace.selectedNamespace).toBe('team-a');
    expect(viewState().viewType).toBe('namespace');
    expect(viewState().activeNamespaceTab).toBe('workloads');

    await run('Namespace - Pods', 'Namespace - Pods');
    expect(view.owners().namespace.selectedNamespace).toBe('team-a');
    expect(viewState().activeNamespaceTab).toBe('pods');
  });

  it('opens All Namespaces on its Workloads view', async () => {
    dev = openCluster('dev', 'alpha');
    await showPalette();
    vi.useFakeTimers();
    await run('team-a', 'team-a');
    await run('Namespace - Pods', 'Namespace - Pods');

    await run('All Namespaces', 'All Namespaces');

    expect(view.owners().namespace.selectedNamespace).toBe('namespace:all');
    expect(viewState().activeNamespaceTab).toBe('workloads');
  });

  it('offers no Global views with one cluster open', async () => {
    dev = openCluster('dev', 'alpha');
    await showPalette();

    expect((await search('Global')).filter((label) => label.startsWith('Global - '))).toEqual([]);
  });

  it('opens Global views with two clusters open, where closing the cluster tab does nothing', async () => {
    dev = openCluster('dev', 'alpha');
    const prod = openCluster('prod', 'beta');
    await showPalette();
    vi.useFakeTimers();

    await run('Global', 'Global - Namespaces');
    expect(viewState().viewType).toBe('global');
    expect(viewState().activeGlobalTab).toBe('global-namespaces');

    await run('close', 'Close active cluster tab');

    expect(app.backend.calls('CloseClusterView')).toEqual([]);
    expect(kubeconfig().selectedKubeconfigs).toEqual([dev.selection, prod.selection]);
  });

  it('closes the active cluster tab and keeps the others', async () => {
    dev = openCluster('dev', 'alpha');
    const prod = openCluster('prod', 'beta');
    await showPalette();
    await view.selectCluster(prod);
    vi.useFakeTimers();

    await run('close', 'Close active cluster tab');

    expect(app.backend.calls('CloseClusterView')).toEqual([[app.windowName, prod.clusterId]]);
    expect(kubeconfig().selectedKubeconfigs).toEqual([dev.selection]);
  });
});

describe('the kubeconfig picker', () => {
  it('lists contexts by context name, not file name', async () => {
    dev = openCluster('zfile', 'charlie');
    openCluster('afile', 'alpha', {}, { open: false });
    openCluster('mfile', 'bravo', {}, { open: false });
    await showPalette();

    await menu('open-cluster');

    expect(contextLabels()).toEqual(['alpha', 'bravo', 'charlie']);
  });

  it('opens a closed context as a new cluster tab, and switches to an open one without closing any', async () => {
    dev = openCluster('dev', 'alpha');
    const prod = openCluster('prod', 'beta', {}, { open: false });
    await showPalette();
    vi.useFakeTimers();

    await menu('open-cluster');
    await chooseContext('beta');
    expect(kubeconfig().selectedKubeconfigs).toEqual([dev.selection, prod.selection]);
    expect(kubeconfig().selectedClusterId).toBe(prod.clusterId);

    await menu('open-cluster');
    await chooseContext('alpha');
    expect(kubeconfig().selectedKubeconfigs).toEqual([dev.selection, prod.selection]);
    expect(kubeconfig().selectedClusterId).toBe(dev.clusterId);
  });

  it('marks a context that cannot be used and does not open it', async () => {
    dev = openCluster('dev', 'alpha');
    // The backend lists a context it cannot use (backend/kubeconfigs.go), beside dev's.
    app.backend.answer('GetKubeconfigs', () => ({
      kubeconfigs: [
        {
          name: 'dev',
          path: '/kube/dev',
          context: 'alpha',
          isDefault: false,
          isCurrentContext: false,
          invalid: false,
          invalidReason: '',
        },
        {
          name: 'broken',
          path: '/kube/broken',
          context: 'gone',
          isDefault: false,
          isCurrentContext: false,
          invalid: true,
          invalidReason: 'cluster "gone" not found',
        },
      ],
      state: backend.KubeconfigDiscoveryState.KubeconfigDiscoveryStateAvailable,
      searchPaths: ['/kube'],
    }));
    await showPalette();
    vi.useFakeTimers();
    await menu('open-cluster');
    const broken = requireValue(
      options().find((option) => contextOf(option) === 'gone'),
      'expected the invalid context'
    );
    // The row carries the backend's reason the context cannot be used.
    expect(
      Array.from(broken.querySelectorAll('[title]')).map((marker) => marker.getAttribute('title'))
    ).toEqual(['cluster "gone" not found']);

    await chooseContext('gone');

    expect(kubeconfig().selectedKubeconfigs).toEqual([dev.selection]);
    expect(kubeconfig().selectedClusterId).toBe(dev.clusterId);
  });
});

describe('application commands', () => {
  it('opens About, checks for updates, opens Settings and the object diff, and toggles the sidebar and Application Logs', async () => {
    app.backend.answer('CheckForUpdates', () => ({ status: 'checking' }) as never);
    dev = openCluster('dev', 'alpha');
    await showPalette();
    vi.useFakeTimers();

    await run('About', 'About');
    expect(viewState().isAboutOpen).toBe(true);
    await act(async () => viewState().setIsAboutOpen(false));

    await run('Check for Updates', 'Check for Updates…');
    expect(app.backend.calls('CheckForUpdates')).toHaveLength(1);
    expect(viewState().isAboutOpen).toBe(true);

    await run('Settings', 'Settings');
    expect(viewState().isSettingsOpen).toBe(true);

    await run('Diff objects', 'Diff objects');
    expect(viewState().isObjectDiffOpen).toBe(true);

    const sidebarVisible = viewState().isSidebarVisible;
    await run('sidebar', sidebarVisible ? 'Hide Sidebar' : 'Show Sidebar');
    expect(viewState().isSidebarVisible).toBe(!sidebarVisible);

    await run('Application Logs', 'Application Logs panel');
    expect(viewState().showAppLogsPanel).toBe(true);
  });
});

describe('shortcut keycaps', () => {
  const keycaps = async () => {
    dev = openCluster('dev', 'alpha');
    await showPalette();
    await menu('open-command-palette');
    return options().flatMap((option) =>
      Array.from(option.querySelectorAll('kbd'), (kbd) => kbd.textContent ?? '')
    );
  };
  const macSymbols = (keys: string[]) => keys.filter((key) => /[⌘⌃⇧⌥]/.test(key));

  it('names the modifier keys outside macOS', async () => {
    const keys = await keycaps();

    expect(keys).toEqual(expect.arrayContaining(['Ctrl', 'Shift']));
    expect(macSymbols(keys)).toEqual([]);
  });

  it('shows the modifier symbols on macOS', async () => {
    const platform = vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    try {
      const keys = await keycaps();

      expect(keys).toEqual(expect.arrayContaining(['⌘', '⇧']));
      expect(keys).not.toContain('Ctrl');
    } finally {
      platform.mockRestore();
    }
  });
});

describe('settings commands', () => {
  const persisted = () =>
    app.backend.calls('UpdateAppPreferences').flatMap(([request]) => request.changes ?? []);

  it('persists the chosen appearance mode and the inverse of each toggled preference', async () => {
    app.preferences({
      dimInactiveNamespaces: true,
      exclusiveNamespaces: true,
      autoRefreshEnabled: true,
      useShortResourceNames: true,
    });
    dev = openCluster('dev', 'alpha');
    await showPalette();
    vi.useFakeTimers();

    await run('Dark mode', 'Dark mode');
    await run('dimming', 'Disable inactive namespace dimming');
    await run('exclusive', 'Disable exclusive namespaces');
    await run('auto-refresh', 'Disable auto-refresh');
    await run('short names', 'Disable short names');

    expect(persisted()).toEqual([
      { key: 'appearanceMode', value: 'dark' },
      { key: 'dimInactiveNamespaces', value: false },
      { key: 'exclusiveNamespaces', value: false },
      { key: 'autoRefreshEnabled', value: false },
      { key: 'useShortResourceNames', value: false },
    ]);
  });

  it.each([
    ['Dark mode', 'setDarkAppearanceMode'],
    ['Enable short names', 'toggleShortResourceNames'],
  ])('reports a failed %s under the command’s name', async (label, action) => {
    app.backend.answer('UpdateAppPreferences', () => {
      throw new Error('settings unavailable');
    });
    dev = openCluster('dev', 'alpha');
    await showPalette();
    vi.useFakeTimers();

    await run(label, label);

    expect(
      app.errors.take(
        (record) => record.context?.source === 'CommandPalette' && record.context.action === action
      )
    ).toEqual([expect.objectContaining({ kinds: ['operational'] })]);
  });
});

describe('in the full app', () => {
  const clickControl = async (label: string) => {
    const control = requireValue(
      view.container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`),
      `expected the ${label} button`
    );
    await act(async () => control.click());
    await app.settle();
  };

  it('opens from the header button with the app’s commands, and from the sidebar’s namespace search into the namespace picker', async () => {
    dev = openCluster('dev', 'alpha');
    app.startScreen(dev);
    // The namespace's Workloads view, where choosing a namespace lands.
    app.serveTable(dev, 'namespace-workloads');
    view = await app.mountApp();

    await clickControl('Command Palette');
    expect(await search('capacity')).toContain('Cluster - Nodes');
    await closePalette();
    expect(palette()).toBeNull();

    await clickControl('Select namespace');
    vi.useFakeTimers();
    expect(optionLabels()).toEqual(['All Namespaces', 'default', 'team-a']);
    await choose('team-a');

    expect(view.owners().namespace.selectedNamespace).toBe('team-a');
    expect(viewState().viewType).toBe('namespace');
  });
});
