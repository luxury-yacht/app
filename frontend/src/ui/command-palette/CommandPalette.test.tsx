/**
 * frontend/src/ui/command-palette/CommandPalette.test.tsx
 *
 * The command palette: how it opens (the native View menu, File → Open
 * Cluster, and the select-namespace shortcut) and into which picker; how the
 * keyboard and the mouse move its selection; how a command runs; and how it
 * searches the selected cluster's object catalog, ignores a search the user
 * has moved on from, and opens a found object's panel with full identity.
 * Also the pure query parsing and catalog ranking it uses. Runs in provider
 * mode inside the real app shell (keyboard, kubeconfig, and object-panel
 * owners), with only the backend boundary faked (test-utils/appState); the
 * palette receives fixed commands, as AppLayout passes it the app's.
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeCatalogSnapshotPayload } from '@/core/refresh/refreshContractTestBuilders';
import type { CanonicalRowTestOverrides, CatalogItem } from '@/core/refresh/types';
import { compareUtf16Strings } from '@/shared/utils/sort';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { snapshotResponse, statusResponse } from '@/test-utils/appState/transport';
import { makeErrorStatus } from '@/test-utils/errorStatusFixtures';
import { requireValue } from '@/test-utils/requireValue';
import { isMacPlatform } from '@/utils/platform';
import { buildCatalogDisplayEntries, CommandPalette, parseQueryTokens } from './CommandPalette';
import type { Command } from './CommandPaletteCommands';

const baseTimestamp = '2024-01-01T00:00:00Z';

const createCatalogItem = (overrides: CanonicalRowTestOverrides<CatalogItem>): CatalogItem => {
  const { ref, ...row } = overrides;
  return {
    ref: {
      clusterId: 'alpha:ctx',
      group: '',
      version: 'v1',
      kind: 'Pod',
      resource: 'pods',
      namespace: 'default',
      name: 'example',
      uid: 'uid-default',
      ...ref,
    },
    resourceVersion: '1',
    creationTimestamp: baseTimestamp,
    scope: 'Namespace',
    ...row,
  };
};

const sampleCatalog: CatalogItem[] = [
  createCatalogItem({
    ref: {
      kind: 'Pod',
      resource: 'pods',
      namespace: 'kube-system',
      name: 'aws-node-abc123',
      uid: 'pod-kube-system',
    },
  }),
  createCatalogItem({
    ref: {
      kind: 'Pod',
      resource: 'pods',
      namespace: 'default',
      name: 'frontend-123',
      uid: 'pod-default',
    },
  }),
  createCatalogItem({
    ref: {
      kind: 'Ingress',
      group: 'networking.k8s.io',
      resource: 'ingresses',
      namespace: 'test-namespace',
      name: 'test-gateway',
      uid: 'ingress-test',
    },
  }),
  createCatalogItem({
    ref: {
      kind: 'Ingress',
      group: 'networking.k8s.io',
      resource: 'ingresses',
      namespace: 'kube-system',
      name: 'metrics',
      uid: 'ingress-metrics',
    },
  }),
  createCatalogItem({
    ref: {
      kind: 'ConfigMap',
      resource: 'configmaps',
      namespace: 'kube-system',
      name: 'aws-config',
      uid: 'cm-aws',
    },
  }),
  createCatalogItem({
    ref: {
      kind: 'Deployment',
      group: 'apps',
      resource: 'deployments',
      namespace: 'default',
      name: 'frontend',
      uid: 'deploy-frontend',
    },

    scope: 'Namespace',
  }),
  createCatalogItem({
    ref: {
      kind: 'Deployment',
      group: 'apps',
      resource: 'deployments',
      namespace: 'test-namespace',
      name: 'gateway',
      uid: 'deploy-gateway',
    },

    scope: 'Namespace',
  }),
  createCatalogItem({
    ref: {
      kind: 'Deployment',
      group: 'apps',
      resource: 'deployments',
      namespace: 'kube-system',
      name: 'metrics-server',
      uid: 'deploy-metrics',
    },

    scope: 'Namespace',
  }),
];

describe('parseQueryTokens', () => {
  it('derives kind aliases and de-duplicates them', () => {
    const tokens = parseQueryTokens('pods pod kube-system/aws-node');
    expect(tokens.kindTokens).toEqual(['pod']);
    expect(tokens.otherTokens).toEqual(['aws-node', 'kube-system']);
  });

  it('treats namespace/name pairs as individual tokens', () => {
    const tokens = parseQueryTokens('svc default/frontend');
    expect(tokens.kindTokens).toEqual(['service']);
    expect(tokens.otherTokens).toEqual(['frontend', 'default']);
  });

  it('promotes unique partial kind prefixes to canonical kind filters', () => {
    const tokens = parseQueryTokens('depl');
    expect(tokens.kindTokens).toEqual(['deployment']);
    expect(tokens.otherTokens).toEqual([]);
  });
});

const app = installAppStateHarness();
let dev: TestCluster;
let view: MountedApp;

const command = (id: string, label: string, category: string, action = vi.fn()): Command => ({
  id,
  label,
  category,
  action,
});

const showPalette = async (commands: Command[]) => {
  view = await app.render(null);
  await view.show(<CommandPalette commands={commands} />);
};

/** Delivers a native menu event, as the backend does. */
const menu = async (name: string) => {
  await act(async () => {
    app.events.emit(name);
  });
  await app.settle();
};

/** The native View → Command Palette menu item. */
const openFromViewMenu = () => menu('open-command-palette');
/** The native File → Open Cluster menu item. */
const openFromOpenClusterMenu = () => menu('open-cluster');

const primary = (): KeyboardEventInit => (isMacPlatform() ? { metaKey: true } : { ctrlKey: true });

const press = async (key: string, modifiers: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...modifiers,
  });
  await act(async () => {
    (document.activeElement ?? document.body).dispatchEvent(event);
  });
  await app.settle();
  return event;
};

const pressNamespaceShortcut = () => press('N', { ...primary(), shiftKey: true });

const palette = () => document.querySelector<HTMLDialogElement>('dialog.command-palette');

const input = () =>
  requireValue(
    document.querySelector<HTMLInputElement>('.command-palette [role="combobox"]'),
    'expected the command-palette input'
  );

const type = async (text: string) => {
  await act(async () => {
    const field = input();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, text);
    field.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });
};

const options = () =>
  Array.from(document.querySelectorAll<HTMLElement>('.command-palette [role="option"]'));

const optionLabels = () => options().map((option) => option.textContent?.trim());

const selectedIndex = () =>
  options().findIndex((option) => option.getAttribute('aria-selected') === 'true');

const groups = () =>
  Array.from(document.querySelectorAll('.command-palette legend')).map((legend) =>
    legend.textContent?.trim()
  );

// A command runs once the palette has closed.
const runPendingCommand = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });

// The palette searches the catalog once typing pauses.
const finishSearchDebounce = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });

const isPaletteSearch = (cluster: TestCluster, scope: string) =>
  scope.startsWith(`${cluster.clusterId}|`) && scope.includes('limit=20');

const catalogPayload = (cluster: TestCluster, items: CatalogItem[], total = items.length) =>
  makeCatalogSnapshotPayload({
    clusterId: cluster.clusterId,
    clusterName: cluster.clusterName,
    items,
    total,
  });

const catalogPod = (cluster: TestCluster, namespace: string, name: string) =>
  createCatalogItem({
    ref: { clusterId: cluster.clusterId, namespace, name, uid: `${name}-uid` },
  });

const namespaceAndKubeconfigCommands = () => [
  command('select-namespace', 'Select namespace...', 'Navigation'),
  command('select-kubeconfig', 'Select kubeconfig...', 'Navigation'),
  command('ns-prod', 'prod', 'Namespaces'),
  command('kc-a', 'cluster-a', 'Kubeconfigs'),
  command('view-x', 'Toggle X', 'View'),
];

beforeEach(() => {
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['default']);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('CommandPalette', () => {
  it('opens from the native View menu with its search focused and closes on Escape', async () => {
    await showPalette([command('open-settings', 'Open Settings', 'Application')]);
    expect(palette()).toBeNull();

    await openFromViewMenu();

    expect(palette()).not.toBeNull();
    expect(document.activeElement).toBe(input());
    expect(optionLabels()).toEqual(['Open Settings']);

    await press('Escape');
    expect(palette()).toBeNull();
  });

  it('opens straight into the kubeconfig picker from File → Open Cluster, and the first Escape closes it', async () => {
    await showPalette(namespaceAndKubeconfigCommands());

    await openFromOpenClusterMenu();

    expect(groups()).toEqual(['Kubeconfigs']);
    expect(optionLabels()).toEqual(['cluster-a']);
    await press('Escape');
    expect(palette()).toBeNull();
  });

  it('opens straight into the namespace picker from its shortcut, and the first Escape closes it', async () => {
    await showPalette(namespaceAndKubeconfigCommands());

    await pressNamespaceShortcut();

    expect(groups()).toEqual(['Namespaces']);
    expect(optionLabels()).toEqual(['prod']);
    await press('Escape');
    expect(palette()).toBeNull();
  });

  it.each([
    ['Select namespace...', 'Namespaces', 'prod'],
    ['Select kubeconfig...', 'Kubeconfigs', 'cluster-a'],
  ])(
    'enters a picker from the %s command, and Escape returns to every command',
    async (label, group, entry) => {
      await showPalette(namespaceAndKubeconfigCommands());
      await openFromViewMenu();
      while (optionLabels()[selectedIndex()] !== label) {
        await press('ArrowDown');
      }

      await press('Enter');

      expect(palette()).not.toBeNull();
      expect(groups()).toEqual([group]);
      expect(optionLabels()).toEqual([entry]);
      await press('Escape');
      expect(palette()).not.toBeNull();
      expect(groups()).toEqual(['View', 'Navigation', 'Namespaces', 'Kubeconfigs']);
    }
  );

  it('switches from the namespace picker to the kubeconfig picker without keeping namespaces', async () => {
    await showPalette(namespaceAndKubeconfigCommands());
    await openFromViewMenu();
    await type('select namespace');
    await press('Enter');
    expect(groups()).toEqual(['Namespaces']);

    await openFromOpenClusterMenu();

    expect(groups()).toEqual(['Kubeconfigs']);
    expect(optionLabels()).toEqual(['cluster-a']);
  });

  it('runs the command the keyboard selects, after the palette closes', async () => {
    const first = vi.fn();
    const second = vi.fn();
    await showPalette([
      command('open-settings', 'Open Settings', 'Application', first),
      command('toggle-sidebar', 'Toggle Sidebar', 'Application', second),
    ]);
    await openFromViewMenu();
    vi.useFakeTimers();

    await press('ArrowDown');
    await press('Enter');

    expect(palette()).toBeNull();
    await runPendingCommand();
    expect(second).toHaveBeenCalledOnce();
    expect(first).not.toHaveBeenCalled();
  });

  it('exposes its results as a combobox listbox whose active option follows the selection', async () => {
    await showPalette([
      command('first', 'First command', 'Application'),
      command('second', 'Second command', 'Application'),
    ]);
    await openFromViewMenu();

    const listbox = requireValue(
      document.querySelector<HTMLElement>('.command-palette [role="listbox"]'),
      'expected the results listbox'
    );
    expect(input().getAttribute('aria-expanded')).toBe('true');
    expect(input().getAttribute('aria-controls')).toBe(listbox.id);
    expect(input().getAttribute('aria-autocomplete')).toBe('list');
    expect(input().getAttribute('aria-activedescendant')).toBe(options()[0]?.id);
    expect(selectedIndex()).toBe(0);

    await press('ArrowDown');

    expect(input().getAttribute('aria-activedescendant')).toBe(options()[1]?.id);
    expect(selectedIndex()).toBe(1);
  });

  it('moves the selection by row (wrapping), by visible page (clamped), and to either end, and resets it when reopened', async () => {
    await showPalette(
      Array.from({ length: 8 }, (_, index) =>
        command(`cmd-${index}`, `Command ${index + 1}`, 'Application')
      )
    );
    await openFromViewMenu();
    // jsdom has no layout: the results show four 30px rows.
    const results = requireValue(
      document.querySelector<HTMLElement>('.command-palette-results'),
      'expected the results'
    );
    Object.defineProperty(results, 'clientHeight', { configurable: true, get: () => 120 });
    for (const option of options()) {
      Object.defineProperty(option, 'offsetHeight', { configurable: true, get: () => 30 });
    }

    const moves: Array<[string, number]> = [
      ['ArrowUp', 7],
      ['ArrowDown', 0],
      ['ArrowDown', 1],
      ['PageDown', 5],
      ['PageDown', 7],
      ['PageUp', 3],
      ['PageUp', 0],
      ['End', 7],
      ['Home', 0],
      ['End', 7],
    ];
    for (const [key, expected] of moves) {
      await press(key);
      expect(selectedIndex(), key).toBe(expected);
    }

    await press('Escape');
    await openFromViewMenu();
    expect(selectedIndex()).toBe(0);
  });

  it('keeps the selection until the mouse actually moves over another result', async () => {
    await showPalette([
      command('first', 'First', 'Application'),
      command('second', 'Second', 'Application'),
      command('third', 'Third', 'Application'),
    ]);
    await openFromViewMenu();
    const third = requireValue(options()[2], 'expected the third result');

    // The list opening under a resting pointer reports a hover, not a move.
    await act(async () => {
      third.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    expect(selectedIndex()).toBe(0);

    await act(async () => {
      third.dispatchEvent(new Event('pointermove', { bubbles: true }));
    });
    expect(selectedIndex()).toBe(2);
  });

  it('closes when the user clicks outside it, and opens again from the menu', async () => {
    await showPalette([command('open-settings', 'Open Settings', 'Application')]);
    await openFromViewMenu();

    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(palette()).toBeNull();

    await openFromViewMenu();
    expect(palette()).not.toBeNull();
  });

  it('selects the whole query on Cmd/Ctrl+A', async () => {
    await showPalette([command('open-settings', 'Open Settings', 'Application')]);
    await openFromViewMenu();
    await type('settings');
    input().setSelectionRange(3, 3);

    const event = await press('a', primary());

    expect(event.defaultPrevented).toBe(true);
    expect([input().selectionStart, input().selectionEnd]).toEqual([0, 'settings'.length]);
  });
});

describe('CommandPalette catalog search', () => {
  it('searches the selected cluster’s catalog once typing pauses, and opens a found object’s panel', async () => {
    const found = catalogPod(dev, 'metrics', 'metrics-pod');
    app.snapshots.answer(({ domain, scope }) =>
      domain === 'catalog' && isPaletteSearch(dev, scope)
        ? catalogPayload(dev, [found], 4)
        : undefined
    );
    await showPalette([]);
    await openFromViewMenu();
    vi.useFakeTimers();

    await type('pod');
    await type('pod metrics');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(199);
    });
    expect(app.snapshots.reads('catalog')).toEqual([]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    await app.settle();

    const searches = app.snapshots.reads('catalog');
    expect(searches).toHaveLength(1);
    const query = new URLSearchParams(
      requireValue(searches[0], 'expected the search').scope.split('|')[1]
    );
    expect(Object.fromEntries(query)).toEqual({ limit: '20', kind: 'pod', search: 'metrics' });
    expect(searches[0]?.scope.startsWith(`${dev.clusterId}|`)).toBe(true);
    // The palette shows how many of the matches it lists.
    expect(groups()).toEqual(['Catalog Results (1 / 4)']);
    expect(optionLabels()).toEqual([expect.stringContaining('metrics/metrics-pod')]);

    await press('Enter');
    await runPendingCommand();

    expect(palette()).toBeNull();
    expect(view.openPanels()).toEqual([
      {
        clusterId: dev.clusterId,
        clusterName: dev.clusterName,
        group: '',
        version: 'v1',
        kind: 'Pod',
        namespace: 'metrics',
        name: 'metrics-pod',
      },
    ]);
  });

  it.each(['resolves', 'fails'] as const)(
    'waits for the current cluster’s search when a search the user moved on from %s',
    async (settlement) => {
      const prod = app.cluster({ name: 'prod', context: 'beta' });
      app.namespaces(prod, ['default']);
      const pending = new Map<string, { resolve: () => void; reject: (error: Error) => void }>();
      const payloads = new Map([
        [dev.clusterId, catalogPayload(dev, [catalogPod(dev, 'default', 'old-pod')])],
        [prod.clusterId, catalogPayload(prod, [catalogPod(prod, 'default', 'current-pod')])],
      ]);
      app.snapshots.respond((request) => {
        const cluster = [dev, prod].find((candidate) => isPaletteSearch(candidate, request.scope));
        if (request.domain !== 'catalog' || !cluster) {
          return undefined;
        }
        return new Promise<Response>((resolve, reject) => {
          pending.set(cluster.clusterId, {
            resolve: () =>
              resolve(
                snapshotResponse({
                  domain: 'catalog',
                  scope: request.scope,
                  version: 1,
                  payload: payloads.get(cluster.clusterId),
                })
              ),
            reject,
          });
        });
      });
      await showPalette([]);
      await openFromViewMenu();
      vi.useFakeTimers();
      await type('pod');
      await finishSearchDebounce();
      expect([...pending.keys()]).toEqual([dev.clusterId]);

      // The user switches to another cluster tab while the search is in flight.
      await view.selectCluster(prod);
      await finishSearchDebounce();
      expect([...pending.keys()]).toEqual([dev.clusterId, prod.clusterId]);

      await act(async () => {
        const obsolete = requireValue(pending.get(dev.clusterId), 'expected the first search');
        if (settlement === 'resolves') {
          obsolete.resolve();
        } else {
          obsolete.reject(new Error('obsolete search failed'));
        }
      });
      await app.settle();
      expect(document.querySelector('.command-palette-loading')).not.toBeNull();
      expect(options()).toEqual([]);

      await act(async () => {
        requireValue(pending.get(prod.clusterId), 'expected the current search').resolve();
      });
      await app.settle();
      expect(document.querySelector('.command-palette-loading')).toBeNull();
      expect(optionLabels()).toEqual([expect.stringContaining('current-pod')]);
    }
  );

  it('reports a failed search and stops showing it as loading', async () => {
    app.snapshots.respond(({ domain, scope }) =>
      domain === 'catalog' && isPaletteSearch(dev, scope)
        ? statusResponse(makeErrorStatus('InternalError', 'catalog unavailable'))
        : undefined
    );
    await showPalette([]);
    await openFromViewMenu();
    vi.useFakeTimers();

    await type('svc metrics');
    await finishSearchDebounce();
    await app.settle();

    expect(app.errors.take((record) => record.context?.action === 'searchCatalog')).toEqual([
      expect.objectContaining({ kinds: ['operational'] }),
    ]);
    expect(document.querySelector('.command-palette-loading')).toBeNull();
    expect(options()).toEqual([]);
  });
});

describe('buildCatalogDisplayEntries', () => {
  const noShortNames = false;

  const evaluate = (query: string, limit?: number) =>
    buildCatalogDisplayEntries(sampleCatalog, parseQueryTokens(query), noShortNames, limit);

  it('matches pods within a fuzzy namespace search', () => {
    const entries = evaluate('pod kube-sys');
    expect(entries.map((entry) => entry.displayName)).toEqual(['kube-system/aws-node-abc123']);
  });

  it('matches ingresses by partial name search', () => {
    const entries = evaluate('ingress test');
    expect(entries).toHaveLength(1);
    expect(entries[0].displayName).toBe('test-namespace/test-gateway');
  });

  it('returns pods when only a kind is provided', () => {
    const entries = evaluate('pod');
    expect(entries.map((entry) => entry.displayName).sort(compareUtf16Strings)).toEqual([
      'default/frontend-123',
      'kube-system/aws-node-abc123',
    ]);
  });

  it('returns deployments for partial kind searches', () => {
    const entries = evaluate('depl');
    expect(entries.map((entry) => entry.displayName).sort(compareUtf16Strings)).toEqual([
      'default/frontend',
      'kube-system/metrics-server',
      'test-namespace/gateway',
    ]);
  });

  it('limits results based on provided limit', () => {
    const entries = evaluate('ingress', 1);
    expect(entries).toHaveLength(1);
  });
});
