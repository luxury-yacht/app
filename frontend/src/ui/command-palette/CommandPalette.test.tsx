/**
 * frontend/src/ui/command-palette/CommandPalette.test.tsx
 *
 * Test suite for CommandPalette.
 * Covers key behaviors and edge cases for CommandPalette.
 */

import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogItem } from '@/core/refresh/types';
import { KeyboardScopePriority } from '@ui/shortcuts/priorities';
import type { Command } from './CommandPaletteCommands';
import { CommandPalette, buildCatalogDisplayEntries, parseQueryTokens } from './CommandPalette';

const baseTimestamp = '2024-01-01T00:00:00Z';

const createCatalogItem = (overrides: Partial<CatalogItem>): CatalogItem => ({
  kind: 'Pod',
  group: '',
  version: 'v1',
  resource: 'pods',
  namespace: 'default',
  name: 'example',
  uid: 'uid-default',
  resourceVersion: '1',
  creationTimestamp: baseTimestamp,
  scope: 'Namespace',
  clusterId: 'alpha:ctx',
  clusterName: 'alpha',
  ...overrides,
});

const sampleCatalog: CatalogItem[] = [
  createCatalogItem({
    kind: 'Pod',
    resource: 'pods',
    namespace: 'kube-system',
    name: 'aws-node-abc123',
    uid: 'pod-kube-system',
  }),
  createCatalogItem({
    kind: 'Pod',
    resource: 'pods',
    namespace: 'default',
    name: 'frontend-123',
    uid: 'pod-default',
  }),
  createCatalogItem({
    kind: 'Ingress',
    group: 'networking.k8s.io',
    resource: 'ingresses',
    namespace: 'test-namespace',
    name: 'test-gateway',
    uid: 'ingress-test',
  }),
  createCatalogItem({
    kind: 'Ingress',
    group: 'networking.k8s.io',
    resource: 'ingresses',
    namespace: 'kube-system',
    name: 'metrics',
    uid: 'ingress-metrics',
  }),
  createCatalogItem({
    kind: 'ConfigMap',
    resource: 'configmaps',
    namespace: 'kube-system',
    name: 'aws-config',
    uid: 'cm-aws',
  }),
  createCatalogItem({
    kind: 'Deployment',
    group: 'apps',
    resource: 'deployments',
    namespace: 'default',
    name: 'frontend',
    uid: 'deploy-frontend',
    scope: 'Namespace',
  }),
  createCatalogItem({
    kind: 'Deployment',
    group: 'apps',
    resource: 'deployments',
    namespace: 'test-namespace',
    name: 'gateway',
    uid: 'deploy-gateway',
    scope: 'Namespace',
  }),
  createCatalogItem({
    kind: 'Deployment',
    group: 'apps',
    resource: 'deployments',
    namespace: 'kube-system',
    name: 'metrics-server',
    uid: 'deploy-metrics',
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

const openWithObjectMock = vi.fn();
const fetchSnapshotMock = vi.fn();
let registeredGlobalShortcuts: Array<{
  key: string;
  modifiers?: Record<string, boolean>;
  handler: () => boolean | void;
}> = [];
let registeredPaletteShortcuts: Array<{
  key: string;
  handler: () => boolean | void;
  enabled?: boolean;
}> = [];
const pushContextMock = vi.fn();
const popContextMock = vi.fn();
const useKeyboardNavigationScopeMock = vi.fn();

vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => ({
    openWithObject: openWithObjectMock,
  }),
}));

vi.mock('@hooks/useShortNames', () => ({
  useShortNames: () => false,
}));

vi.mock('@/core/refresh/client', () => ({
  fetchSnapshot: (...args: unknown[]) => fetchSnapshotMock(...args),
}));

vi.mock('@ui/shortcuts', () => ({
  useShortcut: (options: {
    key: string;
    modifiers?: Record<string, boolean>;
    handler: () => boolean | void;
  }) => {
    registeredGlobalShortcuts.push(options);
  },
  useShortcuts: (
    shortcuts: Array<{ key: string; handler: () => boolean | void; enabled?: boolean }>,
    _config: Record<string, unknown> = {}
  ) => {
    registeredPaletteShortcuts = shortcuts;
  },
  useKeyboardContext: () => ({
    pushContext: pushContextMock,
    popContext: popContextMock,
  }),
  useSearchShortcutTarget: () => undefined,
  useKeyboardNavigationScope: (...args: unknown[]) =>
    useKeyboardNavigationScopeMock(...(args as [unknown])),
}));

describe('CommandPalette component behaviour', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  const renderPalette = async (commands: Command[]) => {
    await act(async () => {
      root.render(<CommandPalette commands={commands} />);
      await Promise.resolve();
    });
  };

  const modifierKeys: Array<'ctrl' | 'meta' | 'shift' | 'alt'> = ['ctrl', 'meta', 'shift', 'alt'];

  const modifiersEqual = (
    actual: Record<string, boolean> | undefined,
    expected: Record<string, boolean>
  ) => modifierKeys.every((mod) => (actual?.[mod] ?? false) === (expected[mod] ?? false));

  const findGlobalShortcut = (expected: Record<string, boolean>) =>
    registeredGlobalShortcuts.find((shortcut) => modifiersEqual(shortcut.modifiers, expected));

  const macPlatform =
    typeof navigator !== 'undefined' &&
    /Mac/i.test((navigator.platform || '') + (navigator.userAgent || ''));
  const defaultOpenShortcut: Record<string, boolean> = macPlatform
    ? { meta: true, shift: true }
    : { ctrl: true, shift: true };
  const openPalette = async (modifiers?: Record<string, boolean>) => {
    const shortcut =
      (modifiers ? findGlobalShortcut(modifiers) : undefined) ??
      findGlobalShortcut(defaultOpenShortcut) ??
      findGlobalShortcut(macPlatform ? { ctrl: true, shift: true } : { meta: true, shift: true });
    expect(shortcut).toBeTruthy();
    await act(async () => {
      shortcut?.handler();
      await Promise.resolve();
    });
  };

  const queryItems = () =>
    Array.from(container.querySelectorAll<HTMLDivElement>('.command-palette-item'));

  const triggerShortcut = async (key: string) => {
    const shortcut = registeredPaletteShortcuts.find((entry) => entry.key === key);
    expect(shortcut).toBeTruthy();
    if (shortcut?.enabled === false) {
      throw new Error(`Shortcut ${key} is not enabled`);
    }
    await act(async () => {
      shortcut!.handler();
      await Promise.resolve();
    });
  };

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    if (!Element.prototype.scrollIntoView) {
      Element.prototype.scrollIntoView = vi.fn();
    }
  });

  beforeEach(() => {
    registeredGlobalShortcuts = [];
    registeredPaletteShortcuts = [];
    fetchSnapshotMock.mockReset();
    openWithObjectMock.mockReset();
    pushContextMock.mockReset();
    popContextMock.mockReset();
    useKeyboardNavigationScopeMock.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
  });

  it('navigates commands with the keyboard and executes the selection', async () => {
    vi.useFakeTimers();
    const firstAction = vi.fn();
    const secondAction = vi.fn();
    const commands: Command[] = [
      {
        id: 'open-settings',
        label: 'Open Settings',
        category: 'Application',
        action: firstAction,
      },
      {
        id: 'toggle-sidebar',
        label: 'Toggle Sidebar',
        category: 'Application',
        action: secondAction,
      },
    ];

    await renderPalette(commands);
    await openPalette({ ctrl: true, shift: true });

    expect(container.querySelector('.command-palette')).not.toBeNull();
    expect(queryItems()).toHaveLength(2);
    expect(queryItems()[0].classList.contains('selected')).toBe(true);

    const input = container.querySelector<HTMLInputElement>('.command-palette-input');
    expect(input).not.toBeNull();
    expect(pushContextMock).toHaveBeenCalled();

    await triggerShortcut('ArrowDown');
    expect(queryItems()[1].classList.contains('selected')).toBe(true);

    await triggerShortcut('Enter');

    expect(container.querySelector('.command-palette')).toBeNull();

    await vi.advanceTimersByTimeAsync(150);
    expect(secondAction).toHaveBeenCalledTimes(1);
    expect(firstAction).not.toHaveBeenCalled();
  });

  it('enters namespace selection mode via the appropriate command', async () => {
    const namespaceCommand: Command = {
      id: 'namespace:prod',
      label: 'Namespace: prod',
      category: 'Namespaces',
      action: vi.fn(),
    };
    const commands: Command[] = [
      {
        id: 'select-namespace',
        label: 'Switch Namespace…',
        category: 'Navigation',
        action: vi.fn(),
      },
      namespaceCommand,
    ];

    await renderPalette(commands);
    await openPalette();

    const input = container.querySelector<HTMLInputElement>('.command-palette-input');
    expect(input).not.toBeNull();
    expect(input!.placeholder).toBe('Type a command or search...');

    await triggerShortcut('Enter');

    expect(input!.placeholder).toBe('Select a namespace...');
    const headers = Array.from(
      container.querySelectorAll<HTMLDivElement>('.command-palette-group-header')
    ).map((el) => el.textContent);
    expect(headers).toEqual(['Namespaces']);

    const labels = Array.from(
      container.querySelectorAll<HTMLDivElement>('.command-palette-item-label')
    ).map((el) => el.textContent);
    expect(labels).toEqual([namespaceCommand.label]);

    await triggerShortcut('Escape');

    expect(input!.placeholder).toBe('Type a command or search...');
    expect(container.querySelector('.command-palette')).not.toBeNull();
  });

  it('closes when Escape is pressed outside selection modes', async () => {
    const commands: Command[] = [
      {
        id: 'open-settings',
        label: 'Open Settings',
        category: 'Application',
        action: vi.fn(),
      },
    ];

    await renderPalette(commands);
    await openPalette();

    const input = container.querySelector<HTMLInputElement>('.command-palette-input');
    expect(input).not.toBeNull();

    await triggerShortcut('Escape');

    expect(container.querySelector('.command-palette')).toBeNull();
  });

  it('enters kubeconfig selection mode when prompted', async () => {
    const kubeconfigCommand: Command = {
      id: 'kubeconfig:dev',
      label: 'Kubeconfig: dev-cluster',
      category: 'Kubeconfigs',
      action: vi.fn(),
    };
    const commands: Command[] = [
      {
        id: 'select-kubeconfig',
        label: 'Switch Kubeconfig…',
        category: 'Navigation',
        action: vi.fn(),
      },
      kubeconfigCommand,
    ];

    await renderPalette(commands);
    await openPalette();

    const input = container.querySelector<HTMLInputElement>('.command-palette-input');
    expect(input).not.toBeNull();
    expect(input!.placeholder).toBe('Type a command or search...');

    await triggerShortcut('Enter');

    expect(input!.placeholder).toBe('Select a kubeconfig...');
    const headers = Array.from(
      container.querySelectorAll<HTMLDivElement>('.command-palette-group-header')
    ).map((el) => el.textContent);
    expect(headers).toEqual(['Kubeconfigs']);

    const labels = Array.from(
      container.querySelectorAll<HTMLDivElement>('.command-palette-item-label')
    ).map((el) => el.textContent);
    expect(labels).toEqual([kubeconfigCommand.label]);

    await triggerShortcut('Escape');
    expect(container.querySelector('.command-palette')).not.toBeNull();
  });

  it('debounces catalog searches and renders truncated results', async () => {
    const catalogItem = createCatalogItem({
      uid: 'catalog-pod',
      namespace: 'metrics',
      name: 'metrics-pod',
      kind: 'Pod',
      resource: 'pods',
    });

    fetchSnapshotMock.mockImplementation((domain: unknown, options: any) => {
      expect(domain).toBe('catalog');
      expect(options?.scope).toContain('limit=20');
      expect(options?.scope).toContain('kind=pod');
      expect(options?.scope).toContain('search=metrics');
      expect(options?.signal).toBeInstanceOf(AbortSignal);
      return Promise.resolve({
        snapshot: {
          payload: {
            items: [catalogItem],
            total: 4,
          },
        },
      });
    });

    await renderPalette([]);
    await openPalette();

    const input = container.querySelector<HTMLInputElement>('.command-palette-input');
    expect(input).not.toBeNull();

    await act(async () => {
      const setInputValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      )?.set;
      setInputValue?.call(input, 'pod metrics');
      input!.dispatchEvent(new InputEvent('input', { bubbles: true }));
      await Promise.resolve();
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });

    const header = Array.from(
      container.querySelectorAll<HTMLDivElement>('.command-palette-group-header')
    ).find((el) => el.textContent?.includes('Catalog Results'));
    expect(header?.textContent).toContain('Catalog Results (1 / 4)');

    const note = container.querySelector<HTMLDivElement>('.command-palette-note');
    expect(note?.textContent).toContain('Showing first 1 of 4 results');

    const catalogLabel = container.querySelector<HTMLDivElement>(
      '.command-palette-item-label.catalog'
    );
    expect(catalogLabel?.textContent).toContain('metrics/metrics-pod');

    await act(async () => {
      catalogLabel?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.querySelector('.command-palette')).toBeNull();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });
    expect(openWithObjectMock).toHaveBeenCalledTimes(1);
    expect(openWithObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'Pod',
        name: 'metrics-pod',
        namespace: 'metrics',
        resource: 'pods',
        uid: 'catalog-pod',
        clusterId: 'alpha:ctx',
      })
    );
  });

  it('shows empty state when no commands are available', async () => {
    await renderPalette([]);
    await openPalette();

    const emptyState = container.querySelector<HTMLDivElement>('.command-palette-empty');
    expect(emptyState?.textContent).toBe('No commands available');
  });

  it('closes when clicking outside and does not reopen from the same shortcut', async () => {
    await renderPalette([
      { id: 'open-settings', label: 'Open Settings', category: 'Application', action: vi.fn() },
    ]);
    await openPalette(defaultOpenShortcut);

    const paletteBefore = container.querySelector('.command-palette');
    expect(paletteBefore).not.toBeNull();

    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      await Promise.resolve();
    });

    expect(container.querySelector('.command-palette')).toBeNull();

    const globalShortcut = findGlobalShortcut(defaultOpenShortcut);
    expect(globalShortcut).toBeTruthy();
    await act(async () => {
      const result = globalShortcut?.handler();
      expect(result).toBe(true);
      await Promise.resolve();
    });

    expect(container.querySelector('.command-palette')).not.toBeNull();

    await act(async () => {
      globalShortcut?.handler();
      await Promise.resolve();
    });

    expect(container.querySelector('.command-palette')).not.toBeNull();
  });

  it('supports page navigation shortcuts and hides cursor until mouse movement', async () => {
    const commands: Command[] = Array.from({ length: 8 }).map((_, index) => ({
      id: `cmd-${index}`,
      label: `Command ${index + 1}`,
      category: 'Application',
      action: vi.fn(),
    }));

    await renderPalette(commands);
    await openPalette();

    const results = container.querySelector('.command-palette-results') as HTMLElement;
    const originalClientHeight = Object.getOwnPropertyDescriptor(results, 'clientHeight');
    Object.defineProperty(results, 'clientHeight', {
      configurable: true,
      get: () => 120,
    });
    const originalOffsetHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'offsetHeight'
    );
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get() {
        return this.classList.contains('command-palette-item')
          ? 30
          : (originalOffsetHeight?.get?.call(this) ?? 0);
      },
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(results.clientHeight).toBe(120);
    const firstItem = container.querySelector('.command-palette-item') as HTMLElement;
    expect(firstItem.offsetHeight).toBe(30);

    await triggerShortcut('PageDown');
    const afterPageDownIndex = queryItems().findIndex((item) =>
      item.classList.contains('selected')
    );
    expect(afterPageDownIndex).toBeGreaterThan(0);
    expect(container.querySelector('.command-palette')?.classList.contains('hide-cursor')).toBe(
      true
    );

    await triggerShortcut('PageUp');
    const afterPageUpIndex = queryItems().findIndex((item) => item.classList.contains('selected'));
    expect(afterPageUpIndex).toBeLessThan(afterPageDownIndex);

    await triggerShortcut('End');
    expect(queryItems().findIndex((item) => item.classList.contains('selected'))).toBe(
      commands.length - 1
    );

    await triggerShortcut('Home');
    expect(queryItems().findIndex((item) => item.classList.contains('selected'))).toBe(0);

    const paletteContainer = container.querySelector('.command-palette') as HTMLElement;
    await act(async () => {
      paletteContainer.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
      await Promise.resolve();
    });
    expect(container.querySelector('.command-palette')?.classList.contains('hide-cursor')).toBe(
      false
    );

    if (originalClientHeight) {
      Object.defineProperty(results, 'clientHeight', originalClientHeight);
    } else {
      delete (results as any).clientHeight;
    }
    if (originalOffsetHeight) {
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', originalOffsetHeight);
    } else {
      delete (HTMLElement.prototype as any).offsetHeight;
    }
  });

  it('selects all text via Ctrl+A and keeps catalog loading state consistent on errors', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchSnapshotMock.mockRejectedValueOnce(new Error('network down'));

    await renderPalette([]);
    await openPalette();

    const input = container.querySelector<HTMLInputElement>('.command-palette-input');
    expect(input).not.toBeNull();
    const selectSpy = vi.spyOn(input!, 'select');

    const event = new KeyboardEvent('keydown', {
      key: 'a',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    const dispatchResult = input!.dispatchEvent(event);
    expect(dispatchResult).toBe(false);
    expect(selectSpy).toHaveBeenCalled();

    await act(async () => {
      const setInputValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      )?.set;
      setInputValue?.call(input, 'svc metrics');
      input!.dispatchEvent(new InputEvent('input', { bubbles: true }));
      await Promise.resolve();
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });

    expect(errorSpy).toHaveBeenCalledWith('Catalog search failed', expect.any(Error));
    expect(container.querySelector('.command-palette-loading')).toBeNull();
    expect(container.querySelector('.command-palette-note')).toBeNull();

    errorSpy.mockRestore();
  });

  it('registers a highest-priority navigation scope that keeps focus on the input', async () => {
    const commands: Command[] = [
      { id: 'open-settings', label: 'Open Settings', category: 'Application', action: vi.fn() },
    ];

    await renderPalette(commands);
    await openPalette();

    const scopeCall =
      useKeyboardNavigationScopeMock.mock.calls[
        useKeyboardNavigationScopeMock.mock.calls.length - 1
      ];
    expect(scopeCall).toBeTruthy();
    const scopeConfig = scopeCall?.[0] as {
      priority: number;
      disabled?: boolean;
      onEnter?: (args: { direction: 'forward' | 'backward' }) => void;
      onNavigate?: (args: {
        direction: 'forward' | 'backward';
        event: KeyboardEvent;
      }) => 'handled' | 'bubble' | 'native' | void;
    };

    expect(scopeConfig?.priority).toBe(KeyboardScopePriority.COMMAND_PALETTE);
    expect(scopeConfig?.disabled).toBe(false);

    const input = container.querySelector('.command-palette-input') as HTMLInputElement;
    expect(input).not.toBeNull();
    input.blur();

    scopeConfig?.onEnter?.({ direction: 'forward' });
    expect(document.activeElement).toBe(input);

    const navigateResult = scopeConfig?.onNavigate?.({
      direction: 'forward',
      event: new KeyboardEvent('keydown', { key: 'Tab' }),
    } as Parameters<NonNullable<typeof scopeConfig.onNavigate>>[0]);
    expect(navigateResult).toBe('handled');
    expect(document.activeElement).toBe(input);
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
    expect(entries.map((entry) => entry.displayName).sort()).toEqual([
      'default/frontend-123',
      'kube-system/aws-node-abc123',
    ]);
  });

  it('returns deployments for partial kind searches', () => {
    const entries = evaluate('depl');
    expect(entries.map((entry) => entry.displayName).sort()).toEqual([
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
