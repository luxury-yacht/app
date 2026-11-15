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
  fixture: { open?: boolean; namespaces?: string[] } = {}
) => {
  const { namespaces = ['default', 'team-a'], ...clusterFixture } = fixture;
  const cluster = app.cluster({ name, context, ...clusterFixture });
  app.namespaces(cluster, namespaces);
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

const press = (element: Element, key: string) =>
  act(async () => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });

/** Presses `key` where focus is, as a keyboard user does. */
const pressFocused = (key: string) =>
  press(requireValue(document.activeElement, 'expected a focused element'), key);

const closePalette = () => pressFocused('Escape');

/** Lets a chosen result's command run, which happens once the palette has closed. */
const runChosenCommand = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
  await app.settle();
};

/** Clicks a result; its command runs once the palette has closed. */
const click = async (option: HTMLElement) => {
  await act(async () => option.click());
  await runChosenCommand();
};

// The results the palette marks as highlighted (what Enter runs).
const highlightedLabels = () =>
  options()
    .filter((option) => option.getAttribute('aria-selected') === 'true')
    .map(labelOf);

// The result the search field names as its active option for assistive technology.
const activeOptionLabel = () => {
  const id = document
    .querySelector('.command-palette [role="combobox"]')
    ?.getAttribute('aria-activedescendant');
  const active = id ? document.getElementById(id) : null;
  return active ? labelOf(active) : null;
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

/** The kubeconfig picker's contexts under the group headed `category`. */
const groupContexts = (category: string) =>
  [...document.querySelectorAll<HTMLFieldSetElement>('.command-palette .command-palette-group')]
    .filter((group) => group.querySelector('legend')?.textContent === category)
    .flatMap((group) => [...group.querySelectorAll<HTMLElement>('[role="option"]')].map(contextOf));

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

  // cert-manager installs into a namespace named like its view, so both results
  // appear together; each must be highlighted, announced, and run on its own.
  it('keeps a namespace named like a namespace view a separate result from that view', async () => {
    dev = openCluster(
      'dev',
      'alpha',
      { namespaced: ['cert-manager'] },
      { namespaces: ['default', 'team-a', 'cert-manager'] }
    );
    await showPalette();
    vi.useFakeTimers();
    await run('team-a', 'team-a');

    expect(await search('cert-manager')).toEqual(['Namespace - Cert Manager', 'cert-manager']);
    expect(highlightedLabels()).toEqual(['Namespace - Cert Manager']);
    expect(activeOptionLabel()).toBe('Namespace - Cert Manager');

    await pressFocused('ArrowDown');
    expect(highlightedLabels()).toEqual(['cert-manager']);
    expect(activeOptionLabel()).toBe('cert-manager');

    await pressFocused('Enter');
    await runChosenCommand();
    expect(view.owners().namespace.selectedNamespace).toBe('cert-manager');
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

    await run('close', 'Close cluster');

    expect(app.backend.calls('CloseClusterView')).toEqual([]);
    expect(kubeconfig().selectedKubeconfigs).toEqual([dev.selection, prod.selection]);
  });

  it('closes the active cluster tab and keeps the others', async () => {
    dev = openCluster('dev', 'alpha');
    const prod = openCluster('prod', 'beta');
    await showPalette();
    await view.selectCluster(prod);
    vi.useFakeTimers();

    await run('close', 'Close cluster');

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

  it('lists favorite clusters in their own group above the rest, each group by context name', async () => {
    dev = openCluster('zfile', 'charlie');
    const alpha = openCluster('afile', 'alpha', {}, { open: false });
    openCluster('mfile', 'bravo', {}, { open: false });
    const delta = openCluster('dfile', 'delta', {}, { open: false });
    app.backend.answer('GetFavoriteClusters', () => [delta.selection, alpha.selection]);
    await showPalette();

    await menu('open-cluster');

    expect(groupContexts('Favorite Clusters')).toEqual(['alpha', 'delta']);
    expect(groupContexts('Clusters')).toEqual(['bravo', 'charlie']);
    expect(contextLabels()).toEqual(['alpha', 'delta', 'bravo', 'charlie']);
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

    await run('About', 'About Luxury Yacht');
    expect(viewState().isAboutOpen).toBe(true);
    await act(async () => viewState().setIsAboutOpen(false));

    await run('Check for Updates', 'Check for updates…');
    expect(app.backend.calls('CheckForUpdates')).toHaveLength(1);
    expect(viewState().isAboutOpen).toBe(true);

    await run('Settings', 'Settings…');
    expect(viewState().isSettingsOpen).toBe(true);

    await run('Diff objects', 'Diff objects');
    expect(viewState().isObjectDiffOpen).toBe(true);

    const sidebarVisible = viewState().isSidebarVisible;
    await run('sidebar', sidebarVisible ? 'Hide sidebar' : 'Show sidebar');
    expect(viewState().isSidebarVisible).toBe(!sidebarVisible);

    await run('Application logs', 'Application logs');
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

describe('saved workspaces', () => {
  /** The labels the palette lists under `category`, in order. */
  const groupLabels = (category: string) => {
    const group = [
      ...document.querySelectorAll<HTMLFieldSetElement>('.command-palette .command-palette-group'),
    ].find((candidate) => candidate.querySelector('legend')?.textContent === category);
    return group ? [...group.querySelectorAll<HTMLElement>('[role="option"]')].map(labelOf) : [];
  };

  const emptyMessage = () =>
    document.querySelector('.command-palette .command-palette-empty')?.textContent ?? null;

  const workspaceCommands = ['Open workspace…', 'Save workspace…', 'Manage workspaces…'];

  it('lists saved workspaces alone in their section, with the workspace commands under Navigation, and opens the chosen one', async () => {
    app.backend.answer('ListNamedWorkspaces', () => [
      { name: 'Incident', revision: 'rev-incident' },
      { name: 'Release', revision: 'rev-release' },
    ]);
    app.backend.answer('OpenNamedWorkspace', () => undefined);
    view = await app.mountApp();
    await menu('open-command-palette');
    vi.useFakeTimers();
    // Like Open cluster… and Select namespace… beside their listed entries.
    expect(groupLabels('Workspaces')).toEqual(['Incident', 'Release']);
    const navigation = groupLabels('Navigation');
    const pickers = navigation.indexOf('Select namespace…');
    expect(navigation.slice(pickers + 1, pickers + 4)).toEqual(workspaceCommands);

    await choose('Release');
    // The revision it listed: a workspace replaced since then is refused, not opened.
    expect(app.backend.calls('OpenNamedWorkspace')).toEqual([
      [app.windowName, 'Release', 'rev-release'],
    ]);
  });

  it('opens from File → Open Workspace… on the saved workspaces alone, and opens the chosen one', async () => {
    app.backend.answer('ListNamedWorkspaces', () => [
      { name: 'Incident', revision: 'rev-incident' },
      { name: 'Release', revision: 'rev-release' },
    ]);
    app.backend.answer('OpenNamedWorkspace', () => undefined);
    view = await app.mountApp();
    await menu('open-workspace');
    vi.useFakeTimers();
    expect(optionLabels()).toEqual(['Incident', 'Release']);

    await choose('Incident');
    expect(app.backend.calls('OpenNamedWorkspace')).toEqual([
      [app.windowName, 'Incident', 'rev-incident'],
    ]);
  });

  it('switches to the same picker from the palette’s Open workspace… command', async () => {
    app.backend.answer('ListNamedWorkspaces', () => [
      { name: 'Incident', revision: 'rev-incident' },
    ]);
    view = await app.mountApp();
    await menu('open-command-palette');
    vi.useFakeTimers();
    await choose('Open workspace…');

    expect(palette()).not.toBeNull();
    expect(optionLabels()).toEqual(['Incident']);
  });

  it('says nothing is saved only once the list has arrived empty', async () => {
    const release = app.backend.hold('ListNamedWorkspaces');
    view = await app.mountApp();
    await menu('open-workspace');
    // Still reading: no claim that nothing is saved.
    expect(optionLabels()).toEqual([]);
    expect(emptyMessage()).toBeNull();

    await act(async () => release());
    await app.settle();
    expect(emptyMessage()).not.toBeNull();
  });

  it('says the picker could not read the list instead of claiming nothing is saved', async () => {
    let unreadable = false;
    app.backend.answer('ListNamedWorkspaces', () => {
      if (unreadable) {
        throw new Error('workspace state is unreadable');
      }
      return [];
    });
    view = await app.mountApp();
    await menu('open-workspace');
    const noneSaved = emptyMessage();
    await closePalette();

    unreadable = true;
    await menu('open-workspace');
    expect(emptyMessage()).not.toBeNull();
    expect(emptyMessage()).not.toBe(noneSaved);
    const reports = app.errors.take((record) => record.context?.action === 'list');
    expect(reports.map((record) => record.kinds)).toEqual([['operational']]);
  });

  it('reads the saved list each time it opens, so changes from another window show', async () => {
    let saved = [{ name: 'Incident', revision: 'rev-incident' }];
    app.backend.answer('ListNamedWorkspaces', () => saved);
    view = await app.mountApp();
    await menu('open-command-palette');
    expect(groupLabels('Workspaces')).toEqual(['Incident']);
    await closePalette();

    // Another window renames it while the palette is closed.
    saved = [{ name: 'Outage', revision: 'rev-incident' }];
    await menu('open-command-palette');
    expect(groupLabels('Workspaces')).toEqual(['Outage']);
  });

  it('tells the user when opening a saved workspace is refused', async () => {
    app.backend.answer('ListNamedWorkspaces', () => [{ name: 'Incident', revision: 'rev-listed' }]);
    app.backend.answer('OpenNamedWorkspace', () => {
      throw new Error('workspace changed since it was listed');
    });
    view = await app.mountApp();
    await menu('open-command-palette');
    vi.useFakeTimers();
    await choose('Incident');

    expect(app.backend.calls('OpenNamedWorkspace')).toEqual([
      [app.windowName, 'Incident', 'rev-listed'],
    ]);
    // The palette has closed, so a notification is the only place to say so.
    expect(
      app.errors.take(
        (record) => record.context?.action === 'open' && record.kinds.includes('toast')
      )
    ).toHaveLength(1);
  });

  it('lists no saved workspaces when the list cannot be read, without notifying on every open', async () => {
    app.backend.answer('ListNamedWorkspaces', () => {
      throw new Error('workspace state is unreadable');
    });
    view = await app.mountApp();
    await menu('open-command-palette');

    expect(groupLabels('Workspaces')).toEqual([]);
    expect(groupLabels('Navigation')).toEqual(expect.arrayContaining(workspaceCommands));
    const reports = app.errors.take((record) => record.context?.action === 'list');
    expect(reports.map((record) => record.kinds)).toEqual([['operational']]);
  });
});

it('saves a named workspace from the full app command palette', async () => {
  app.backend.answer('ListNamedWorkspaces', () => [
    { name: 'Existing workspace', revision: 'rev-existing' },
  ]);
  app.backend.answer('SaveNamedWorkspace', () => undefined);
  view = await app.mountApp();
  await menu('open-command-palette');
  vi.useFakeTimers();
  await type('save workspace');
  await choose('Save workspace…');
  const input = requireValue(
    document.querySelector<HTMLInputElement>('[role="dialog"] input[name="workspace-name"]'),
    'expected the workspace name input'
  );
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
      input,
      'Existing workspace'
    );
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });
  const save = requireValue(
    document.querySelector<HTMLButtonElement>('[role="dialog"] button[type="submit"]'),
    'expected the replacement button'
  );
  await act(async () => save.click());
  expect(app.backend.calls('SaveNamedWorkspace')).toEqual([
    [app.windowName, 'Existing workspace', true, 'rev-existing'],
  ]);
  expect(document.body.contains(input)).toBe(false);
});

// The dialogs below are driven as the user drives them; some start from a list
// that another window then changes.
const openWorkspaceDialog = async (query: string, command: string) => {
  view = await app.mountApp();
  await menu('open-command-palette');
  vi.useFakeTimers();
  await type(query);
  await choose(command);
};

const dialogButtons = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].filter(
    (candidate) => candidate.textContent === label
  );

// An icon-only control, found by its accessible name.
const dialogControl = (label: string) =>
  requireValue(
    document.querySelector<HTMLButtonElement>(`[role="dialog"] button[aria-label="${label}"]`),
    `expected the ${label} control`
  );

const dialogInput = (name: string) =>
  document.querySelector<HTMLInputElement>(`[role="dialog"] input[name="${name}"]`);

const enterInDialog = (name: string, value: string) =>
  act(async () => {
    const input = requireValue(dialogInput(name), `expected the ${name} input`);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });

const submitDialog = () =>
  act(async () =>
    requireValue(
      document.querySelector<HTMLButtonElement>('[role="dialog"] button[type="submit"]'),
      'expected the submit button'
    ).click()
  );

const clickInDialog = (element: HTMLElement) => act(async () => element.click());

/** The saved-workspace picker, found by its visible label. */
const workspacePicker = () => {
  const label = requireValue(
    [...document.querySelectorAll<HTMLLabelElement>('[role="dialog"] label')].find(
      (candidate) => candidate.textContent === 'Workspace'
    ),
    'expected the Workspace label'
  );
  return requireValue(
    document.getElementById(label.htmlFor) as HTMLButtonElement | null,
    'expected the saved-workspace picker'
  );
};

/** Opens the picker and returns its options. */
const openPicker = async () => {
  const picker = workspacePicker();
  await clickInDialog(picker);
  const listbox = requireValue(
    document.getElementById(picker.getAttribute('aria-controls') ?? ''),
    'expected the saved-workspace options'
  );
  return [...listbox.querySelectorAll<HTMLElement>('[role="option"]')];
};

const optionName = (option: HTMLElement) => option.textContent?.trim() ?? '';

/** What the picker lists and which entry it has selected, read by opening it. */
const pickerState = async () => {
  const offered = await openPicker();
  const state = {
    listed: offered.map(optionName),
    selected: offered
      .filter((option) => option.getAttribute('aria-selected') === 'true')
      .map(optionName),
  };
  await clickInDialog(workspacePicker());
  return state;
};

it('renames the selected saved workspace in place, but never onto another workspace', async () => {
  let saved = [
    { name: 'Incident', revision: 'rev-incident' },
    { name: 'Release', revision: 'rev-release' },
  ];
  app.backend.answer('ListNamedWorkspaces', () => saved);
  app.backend.answer('RenameNamedWorkspace', () => {
    saved = [
      { name: 'Outage', revision: 'rev-incident' },
      { name: 'Release', revision: 'rev-release' },
    ];
  });
  await openWorkspaceDialog('manage workspace', 'Manage workspaces…');
  await clickInDialog(dialogControl('Rename workspace'));
  const input = requireValue(dialogInput('workspace-new-name'), 'expected the new name input');
  expect(input.value).toBe('Incident');
  expect(document.activeElement).toBe(input);
  expect(dialogControl('Save new name').disabled).toBe(true);
  // Another workspace's name would discard that workspace's layout, and Enter
  // must not get around the disabled Save.
  await enterInDialog('workspace-new-name', 'Release');
  expect(dialogControl('Save new name').disabled).toBe(true);
  await press(input, 'Enter');
  expect(app.backend.calls('RenameNamedWorkspace')).toEqual([]);

  await enterInDialog('workspace-new-name', ' Outage ');
  await press(input, 'Enter');
  expect(app.backend.calls('RenameNamedWorkspace')).toEqual([
    [app.windowName, 'Incident', 'Outage', 'rev-incident'],
  ]);
  expect(dialogInput('workspace-new-name')).toBeNull();
  expect(await pickerState()).toEqual({ listed: ['Outage', 'Release'], selected: ['Outage'] });
});

it('cancels a rename with Escape and keeps the dialog open on the same workspace', async () => {
  app.backend.answer('ListNamedWorkspaces', () => [
    { name: 'Incident', revision: 'rev-incident' },
    { name: 'Release', revision: 'rev-release' },
  ]);
  await openWorkspaceDialog('manage workspace', 'Manage workspaces…');
  await clickInDialog(dialogControl('Rename workspace'));
  await enterInDialog('workspace-new-name', 'Outage');
  await press(requireValue(dialogInput('workspace-new-name'), 'expected the input'), 'Escape');

  expect(dialogInput('workspace-new-name')).toBeNull();
  expect(app.backend.calls('RenameNamedWorkspace')).toEqual([]);
  expect(await pickerState()).toEqual({ listed: ['Incident', 'Release'], selected: ['Incident'] });
});

it('deletes the selected saved workspace only after confirmation', async () => {
  app.backend.answer('ListNamedWorkspaces', () => [
    { name: 'Incident', revision: 'rev-incident' },
    { name: 'Release', revision: 'rev-release' },
  ]);
  app.backend.answer('DeleteNamedWorkspace', () => undefined);
  await openWorkspaceDialog('manage workspace', 'Manage workspaces…');
  await clickInDialog(dialogControl('Delete workspace'));
  expect(app.backend.calls('DeleteNamedWorkspace')).toEqual([]);
  // The confirmation is the topmost dialog; its Delete button confirms.
  await clickInDialog(
    requireValue(dialogButtons('Delete').pop(), 'expected the confirming Delete button')
  );
  expect(app.backend.calls('DeleteNamedWorkspace')).toEqual([
    [app.windowName, 'Incident', 'rev-incident'],
  ]);
  expect(await pickerState()).toEqual({ listed: ['Release'], selected: ['Release'] });
});

it('offers to save the current windows when nothing is saved yet', async () => {
  app.backend.answer('ListNamedWorkspaces', () => []);
  await openWorkspaceDialog('manage workspace', 'Manage workspaces…');
  await clickInDialog(
    requireValue(dialogButtons('Save Current As…')[0], 'expected the Save Current As… button')
  );
  await app.settle();
  expect(dialogButtons('Save Current As…')).toEqual([]);
  expect(dialogInput('workspace-name')).not.toBeNull();
});

it('reloads the saved workspaces when the one it listed was replaced under the same name', async () => {
  let saved = [
    { name: 'Incident', revision: 'rev-listed' },
    { name: 'Release', revision: 'rev-release' },
  ];
  app.backend.answer('ListNamedWorkspaces', () => saved);
  // The backend refuses a change that names a snapshot it no longer holds.
  app.backend.answer('DeleteNamedWorkspace', (_window, name, revision) => {
    if (!saved.some((entry) => entry.name === name && entry.revision === revision)) {
      throw new Error('workspace changed since it was listed');
    }
    saved = saved.filter((entry) => entry.name !== name);
  });
  await openWorkspaceDialog('manage workspace', 'Manage workspaces…');
  // Another window deletes Incident, saves a new one, and renames Release.
  saved = [
    { name: 'Incident', revision: 'rev-resaved' },
    { name: 'Outage', revision: 'rev-release' },
  ];
  const confirmDelete = async () => {
    await clickInDialog(dialogControl('Delete workspace'));
    // The confirmation is the topmost dialog; its Delete button confirms.
    await clickInDialog(
      requireValue(dialogButtons('Delete').pop(), 'expected the confirming Delete button')
    );
  };

  await confirmDelete();
  expect(app.backend.calls('DeleteNamedWorkspace')).toEqual([
    [app.windowName, 'Incident', 'rev-listed'],
  ]);
  expect(app.errors.take((record) => record.context?.action === 'delete')).toHaveLength(1);
  expect(document.querySelector('[role="dialog"] [role="alert"]')).not.toBeNull();
  expect((await pickerState()).listed).toEqual(['Incident', 'Outage']);

  // The reloaded entry is the one the user now sees, so deleting it applies.
  await confirmDelete();
  expect(app.backend.calls('DeleteNamedWorkspace')[1]).toEqual([
    app.windowName,
    'Incident',
    'rev-resaved',
  ]);
  expect((await pickerState()).listed).toEqual(['Outage']);
});

it('leaves rename mode when the workspace being renamed is gone', async () => {
  let saved = [
    { name: 'Incident', revision: 'rev-incident' },
    { name: 'Release', revision: 'rev-release' },
  ];
  app.backend.answer('ListNamedWorkspaces', () => saved);
  app.backend.answer('RenameNamedWorkspace', () => {
    throw new Error('workspace was not found');
  });
  await openWorkspaceDialog('manage workspace', 'Manage workspaces…');
  await clickInDialog(dialogControl('Rename workspace'));
  // Another window deletes Incident while it is being renamed.
  saved = [{ name: 'Release', revision: 'rev-release' }];
  await enterInDialog('workspace-new-name', 'Postmortem');
  await clickInDialog(dialogControl('Save new name'));

  expect(app.backend.calls('RenameNamedWorkspace')).toEqual([
    [app.windowName, 'Incident', 'Postmortem', 'rev-incident'],
  ]);
  expect(app.errors.take((record) => record.context?.action === 'rename')).toHaveLength(1);
  // Staying in rename mode would rename Release, which the user never chose.
  expect(dialogInput('workspace-new-name')).toBeNull();
  // Nothing is selected, so neither action can reach another workspace.
  expect(dialogControl('Rename workspace').disabled).toBe(true);
  expect(dialogControl('Delete workspace').disabled).toBe(true);
  expect(await pickerState()).toEqual({ listed: ['Release'], selected: [] });
});

it('replaces a workspace that changed since the save dialog listed it only on a second attempt', async () => {
  let saved = [{ name: 'Triage', revision: 'rev-listed' }];
  app.backend.answer('ListNamedWorkspaces', () => saved);
  app.backend.answer('SaveNamedWorkspace', (_window, name, _replace, revision) => {
    if (!saved.some((entry) => entry.name === name && entry.revision === revision)) {
      throw new Error('workspace changed since it was listed');
    }
  });
  await openWorkspaceDialog('save workspace', 'Save workspace…');
  // Another window replaces Triage with its own windows.
  saved = [{ name: 'Triage', revision: 'rev-replaced' }];
  await enterInDialog('workspace-name', 'Triage');
  await submitDialog();

  expect(app.backend.calls('SaveNamedWorkspace')).toEqual([
    [app.windowName, 'Triage', true, 'rev-listed'],
  ]);
  expect(app.errors.take((record) => record.context?.action === 'save')).toHaveLength(1);
  expect(dialogInput('workspace-name')).not.toBeNull();

  // The user has been told; replacing again targets what is saved now.
  await submitDialog();
  expect(app.backend.calls('SaveNamedWorkspace')[1]).toEqual([
    app.windowName,
    'Triage',
    true,
    'rev-replaced',
  ]);
  expect(dialogInput('workspace-name')).toBeNull();
});
