/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Shell/ShellTab.test.tsx
 *
 * The Shell tab: starting, attaching to, and ending pod and node shell
 * sessions, debug containers, clipboard and context-menu actions, cluster
 * switches, and the terminal scrollbar. Runs inside the real app shell
 * (keyboard, docking, app-state and data-access brokers, error reporting) over
 * a faked backend (test-utils/appState): shell RPCs are answered as
 * backend/desktop_service.go answers them, and shell output and status arrive
 * as runtime events. xterm is stubbed, since it cannot render in jsdom.
 */

import { types } from '@core/backend-api/models';
import { Clipboard } from '@wailsio/runtime';
import type React from 'react';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import type { BackendResult } from '@/test-utils/appState/transport';
import { requireValue } from '@/test-utils/requireValue';
import ShellTab from './ShellTab';

type TrackedSession = NonNullable<BackendResult<'ListShellSessions'>>[number];
type StartedSession = NonNullable<BackendResult<'StartShellSession'>>;

const terminalMocks = vi.hoisted(() => {
  class TerminalInstance {
    options: Record<string, unknown>;
    cols = 120;
    rows = 40;
    buffer = {
      active: {
        baseY: 0,
        viewportY: 0,
      },
    };
    loadAddon = vi.fn();
    open = vi.fn();
    focus = vi.fn();
    dispose = vi.fn();
    reset = vi.fn();
    write = vi.fn();
    writeln = vi.fn();
    paste = vi.fn();
    scrollLines = vi.fn((amount: number) => {
      const nextViewportY = Math.max(
        0,
        Math.min(this.buffer.active.baseY, this.buffer.active.viewportY + amount)
      );
      this.buffer.active.viewportY = nextViewportY;
      this.scrollHandler?.(nextViewportY);
    });
    scrollToLine = vi.fn((line: number) => {
      const nextViewportY = Math.max(0, Math.min(this.buffer.active.baseY, line));
      this.buffer.active.viewportY = nextViewportY;
      this.scrollHandler?.(nextViewportY);
    });
    selectAll = vi.fn();
    hasSelection = vi.fn(() => false);
    getSelection = vi.fn(() => '');
    private disposeData = vi.fn();
    private disposeScroll = vi.fn();
    private disposeResize = vi.fn();
    private disposeWriteParsed = vi.fn();
    private dataHandler: ((data: string) => void) | null = null;
    private scrollHandler: ((position: number) => void) | null = null;
    private resizeHandler: ((size: { cols: number; rows: number }) => void) | null = null;
    private writeParsedHandler: (() => void) | null = null;
    private keyHandler: ((event: KeyboardEvent) => boolean) | null = null;
    onData = vi.fn((handler: (data: string) => void) => {
      this.dataHandler = handler;
      return { dispose: this.disposeData };
    });
    onScroll = vi.fn((handler: (position: number) => void) => {
      this.scrollHandler = handler;
      return { dispose: this.disposeScroll };
    });
    onResize = vi.fn((handler: (size: { cols: number; rows: number }) => void) => {
      this.resizeHandler = handler;
      return { dispose: this.disposeResize };
    });
    onWriteParsed = vi.fn((handler: () => void) => {
      this.writeParsedHandler = handler;
      return { dispose: this.disposeWriteParsed };
    });
    attachCustomKeyEventHandler = vi.fn((handler: (event: KeyboardEvent) => boolean) => {
      this.keyHandler = handler;
    });
    triggerKey = (event: KeyboardEvent) => this.keyHandler?.(event);
    triggerData = (data: string) => {
      this.dataHandler?.(data);
    };
    triggerScroll = (position = this.buffer.active.viewportY) => {
      this.buffer.active.viewportY = position;
      this.scrollHandler?.(position);
    };
    triggerResize = () => {
      this.resizeHandler?.({ cols: this.cols, rows: this.rows });
    };
    triggerWriteParsed = () => {
      this.writeParsedHandler?.();
    };

    constructor(options: Record<string, unknown> = {}) {
      this.options = options;
    }
  }

  const instances: TerminalInstance[] = [];

  const TerminalMock = vi.fn(function TerminalConstructor(options: Record<string, unknown> = {}) {
    const instance = new TerminalInstance(options);
    instances.push(instance);
    return instance;
  });

  return { TerminalMock, instances };
});

const fitAddonMocks = vi.hoisted(() => {
  class FitAddonInstance {
    fit = vi.fn();
  }
  const FitAddon = vi.fn(function FitAddonConstructor() {
    return new FitAddonInstance();
  });
  return { FitAddon };
});

const clipboardAddonMocks = vi.hoisted(() => {
  const instances: Array<{ dispose: () => void }> = [];
  const ClipboardAddon = vi.fn(function ClipboardAddonConstructor() {
    const instance = { dispose: vi.fn() };
    instances.push(instance);
    return instance;
  });
  return { ClipboardAddon, instances };
});

vi.mock('@xterm/xterm', () => ({
  Terminal: terminalMocks.TerminalMock,
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: fitAddonMocks.FitAddon,
}));

vi.mock('@xterm/addon-clipboard', () => ({
  ClipboardAddon: clipboardAddonMocks.ClipboardAddon,
}));

vi.mock('@shared/components/dropdowns/Dropdown', () => ({
  Dropdown: ({
    value = '',
    onChange,
    options = [],
    ariaLabel,
  }: {
    value?: string;
    onChange?: (value: string) => void;
    options?: Array<{ value: string; label: string }>;
    ariaLabel?: string;
  }) => (
    <select
      value={value}
      aria-label={ariaLabel}
      onChange={(event) => onChange?.(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

const app = installAppStateHarness();

/** The last item, or undefined for an empty list. */
const last = <T,>(items: readonly T[]): T | undefined => items[items.length - 1];

// A container in the list the backend returns for a pod.
const podContainer = (name: string, kind: { isInit?: boolean; isEphemeral?: boolean } = {}) => ({
  name,
  isInit: kind.isInit ?? false,
  isEphemeral: kind.isEphemeral ?? false,
});

// Complete identity of the pod the rendered Shell tab targets.
const podTarget = (cluster: TestCluster) => ({
  clusterId: cluster.clusterId,
  group: '',
  version: 'v1',
  kind: 'Pod',
  namespace: 'team-a',
  name: 'pod-1',
});

const getLatestTerminal = () =>
  terminalMocks.instances.length > 0
    ? terminalMocks.instances[terminalMocks.instances.length - 1]
    : undefined;

describe('ShellTab', () => {
  let alpha: TestCluster;
  let beta: TestCluster;
  let mounted: MountedApp | null;

  /** A shell session the backend tracks, as ListShellSessions reports it. */
  const tracked = (
    sessionId: string,
    cluster: TestCluster,
    overrides: Partial<TrackedSession> = {}
  ): TrackedSession => ({
    sessionId,
    clusterId: cluster.clusterId,
    clusterName: cluster.clusterName,
    target: podTarget(cluster),
    container: 'app',
    command: ['/bin/sh'],
    startedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  });

  const trackSessions = (...sessions: TrackedSession[]) => {
    app.backend.answer('ListShellSessions', () => sessions);
  };

  /** Containers GetPodContainers reports, per pod cluster. */
  const answerPodContainers = (byCluster: Map<string, ReturnType<typeof podContainer>[]>) => {
    app.backend.answer('GetPodContainers', (target) => byCluster.get(target.clusterId) ?? []);
  };

  // Mirrors backend/desktop_service.go: a started session names its target and
  // container; the other shell commands succeed.
  const answerShellBackend = () => {
    app.backend.answer(
      'StartShellSession',
      (request): StartedSession => ({
        sessionId: 'sess-1',
        target: request.target,
        container: 'app',
        command: ['/bin/sh'],
        containers: ['app'],
      })
    );
    app.backend.answer('RunObjectAction', () => ({
      debugContainer: {
        containerName: 'debug-abc12345',
        namespace: 'team-a',
        podName: 'pod-1',
      },
    }));
    app.backend.answer('GetPodContainers', () => []);
    app.backend.answer('GetShellSessionBacklog', () => '');
    app.backend.answer('SendShellInput', () => undefined);
    app.backend.answer('ResizeShellSession', () => undefined);
    app.backend.answer('CloseShellSession', () => undefined);
  };

  beforeEach(() => {
    mounted = null;
    terminalMocks.instances.length = 0;
    clipboardAddonMocks.instances.length = 0;
    clipboardAddonMocks.ClipboardAddon.mockClear();
    alpha = app.cluster({ name: 'dev', context: 'alpha' });
    beta = app.cluster({ name: 'dev', context: 'beta' });
    app.namespaces(alpha, ['team-a']);
    app.namespaces(beta, ['team-a']);
    answerShellBackend();
    class TestResizeObserver {
      callback: ResizeObserverCallback;
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
      }
    }
    globalThis.ResizeObserver = TestResizeObserver;
    vi.mocked(Clipboard.Text).mockReset().mockResolvedValue('');
    vi.mocked(Clipboard.SetText).mockReset().mockResolvedValue(undefined);
    const clipboardMock = {
      readText: vi.fn().mockResolvedValue(''),
    };
    if (!navigator.clipboard) {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboardMock });
    } else {
      Object.assign(navigator.clipboard, clipboardMock);
    }
  });

  const view = () => requireValue(mounted, 'expected the workspace to be mounted');
  const container = () => view().container;
  const flush = () => app.settle();

  const emitEvent = async (name: string, payload: unknown) => {
    await act(async () => {
      app.events.emit(name, payload);
    });
    await flush();
  };

  const clickConnectButton = async () => {
    const button = container().querySelector<HTMLButtonElement>('.shell-tab__button');
    act(() => {
      requireValue(button, 'expected shell connect button').click();
    });
    await flush();
  };

  const setDebugContainerEnabled = (enabled: boolean) => {
    const checkbox = container().querySelector<HTMLInputElement>('[id$="-shell-tab-debug-toggle"]');
    const debugCheckbox = requireValue(checkbox, 'expected shell debug toggle');
    if (debugCheckbox.checked === enabled) {
      return;
    }
    act(() => {
      debugCheckbox.click();
    });
  };

  const startWorkspace = async () => {
    mounted = await app.render(null);
  };

  /** Shows the tab; a later call re-renders the same tab with new props. */
  const renderShellTab = async (props?: Partial<React.ComponentProps<typeof ShellTab>>) => {
    if (!mounted) {
      await startWorkspace();
    }
    const finalProps: React.ComponentProps<typeof ShellTab> = {
      target: podTarget(alpha),
      availableContainers: [],
      isActive: true,
      disabledReason: undefined,
      debugDisabledReason: undefined,
      ...props,
    };
    await view().show(<ShellTab {...finalProps} />);
    return finalProps;
  };

  const openContextMenu = async () => {
    const wrapper = requireValue(
      container().querySelector<HTMLDivElement>('.shell-tab__terminal-wrapper'),
      'expected the terminal wrapper'
    );
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    await act(async () => {
      wrapper.dispatchEvent(event);
      await Promise.resolve();
    });
    return event;
  };

  const chooseMenuItem = async (label: string) => {
    const item = Array.from(
      document.body.querySelectorAll<HTMLDivElement>('.context-menu-item')
    ).find((node) => node.textContent?.trim() === label);
    await act(async () => {
      requireValue(item, `expected the ${label} item`).dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      );
      await Promise.resolve();
    });
    await flush();
  };

  const inlineReports = () =>
    app.errors
      .take((record) => record.kinds.includes('inline'))
      .map((record) => ({
        message: (record.error as Error).message,
        context: record.context,
      }));

  it('starts a shell session and streams events to the terminal', async () => {
    await renderShellTab();

    expect(app.backend.calls('StartShellSession')).toEqual([]);

    await clickConnectButton();

    expect(app.backend.calls('StartShellSession')).toEqual([
      [{ target: podTarget(alpha), container: undefined, command: ['/bin/sh'] }],
    ]);

    const terminal = getLatestTerminal();
    expect(terminal).toBeTruthy();
    expect(clipboardAddonMocks.ClipboardAddon).toHaveBeenCalled();
    expect(terminal?.loadAddon).toHaveBeenCalledWith(clipboardAddonMocks.instances[0]);

    await emitEvent('object-shell:status', { sessionId: 'sess-1', status: 'open' });

    expect(terminal?.writeln).toHaveBeenCalledWith(expect.stringContaining('Connected'));

    await emitEvent('object-shell:output', {
      sessionId: 'sess-1',
      stream: 'stdout',
      data: 'hello',
    });
    expect(terminal?.write).toHaveBeenCalledWith('hello');
  });

  it('uses the shared iTerm2 ANSI palette for the terminal theme', async () => {
    await renderShellTab();
    await clickConnectButton();

    const terminal = getLatestTerminal();
    const theme = terminal?.options.theme as Record<string, string> | undefined;

    expect(theme).toMatchObject({
      red: '#b43c2a',
      green: '#00c200',
      blue: '#2744c7',
      brightBlue: '#a7abf2',
      brightWhite: '#ffffff',
    });
  });

  it('copies selection on mod+c when the terminal has a selection', async () => {
    await renderShellTab();
    await clickConnectButton();

    const terminal = getLatestTerminal();
    expect(terminal?.attachCustomKeyEventHandler).toHaveBeenCalled();

    terminal?.hasSelection.mockReturnValue(true);
    terminal?.getSelection.mockReturnValue('kubectl get pods');

    const event = {
      type: 'keydown',
      key: 'c',
      ctrlKey: true,
      metaKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as KeyboardEvent;

    const handled = terminal?.triggerKey?.(event);

    expect(Clipboard.SetText).toHaveBeenCalledWith('kubectl get pods');
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(handled).toBe(false);
  });

  it('pastes clipboard contents on mod+v', async () => {
    await renderShellTab();
    await clickConnectButton();

    const terminal = getLatestTerminal();
    vi.mocked(Clipboard.Text).mockResolvedValueOnce('echo hello\n');

    const event = {
      type: 'keydown',
      key: 'v',
      ctrlKey: true,
      metaKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as KeyboardEvent;

    const handled = terminal?.triggerKey?.(event);
    await flush();

    // The WebView gates navigator.clipboard.readText behind a "Paste" callout the
    // user must click; shell paste must read through the native clipboard.
    expect(navigator.clipboard.readText).not.toHaveBeenCalled();
    expect(terminal?.paste).toHaveBeenCalledWith('echo hello\n');
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(handled).toBe(false);
  });

  it('opens a shell-specific context menu on terminal right-click', async () => {
    await renderShellTab();
    await clickConnectButton();

    getLatestTerminal()?.hasSelection.mockReturnValue(true);

    const event = await openContextMenu();

    expect(event.defaultPrevented).toBe(true);
    const menuLabels = Array.from(document.body.querySelectorAll('.context-menu-item')).map(
      (node) => node.textContent?.trim()
    );
    expect(menuLabels).toEqual(['Copy', 'Paste', 'Select All']);

    const copyItem = Array.from(
      document.body.querySelectorAll<HTMLDivElement>('.context-menu-item')
    ).find((node) => node.textContent?.trim() === 'Copy');
    expect(copyItem?.classList.contains('disabled')).toBe(false);
  });

  it('pastes clipboard contents from the shell context menu', async () => {
    await renderShellTab();
    await clickConnectButton();

    const terminal = getLatestTerminal();
    vi.mocked(Clipboard.Text).mockResolvedValueOnce('kubectl logs pod-1\n');

    await openContextMenu();
    await chooseMenuItem('Paste');

    expect(navigator.clipboard.readText).not.toHaveBeenCalled();
    expect(terminal?.paste).toHaveBeenCalledWith('kubectl logs pod-1\n');
  });

  it('copies the terminal selection from the shell context menu', async () => {
    await renderShellTab();
    await clickConnectButton();

    const terminal = getLatestTerminal();
    terminal?.hasSelection.mockReturnValue(true);
    terminal?.getSelection.mockReturnValue('kubectl get pods');

    await openContextMenu();
    await chooseMenuItem('Copy');

    expect(Clipboard.SetText).toHaveBeenCalledWith('kubectl get pods');
  });

  it('sends stdin data to the backend when the session is open', async () => {
    await renderShellTab();
    await clickConnectButton();
    await emitEvent('object-shell:status', { sessionId: 'sess-1', status: 'open' });

    getLatestTerminal()?.triggerData?.('ls\n');
    await flush();

    expect(app.backend.calls('SendShellInput')).toContainEqual(['sess-1', 'ls\n']);
  });

  const findEndSessionButton = () =>
    Array.from(container().querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === 'End Session'
    );

  it('ends the open session from the session bar without reporting a connection failure', async () => {
    await renderShellTab();
    expect(findEndSessionButton()).toBeUndefined();
    await clickConnectButton();
    await emitEvent('object-shell:status', { sessionId: 'sess-1', status: 'open' });

    await act(async () => requireValue(findEndSessionButton(), 'expected End Session').click());
    await flush();
    expect(app.backend.calls('CloseShellSession')).toEqual([['sess-1']]);

    // The backend confirms the close right away; ending a session the user just
    // opened must not look like a failed connection.
    await emitEvent('object-shell:status', { sessionId: 'sess-1', status: 'ended' });

    expect(container().querySelector('.shell-tab__button')).not.toBeNull();
    expect(container().querySelector('.shell-tab__connection-error')).toBeNull();
    expect(app.errors.records()).toEqual([]);
  });

  it('treats a session ended from the Sessions list as a normal close right after connecting', async () => {
    await renderShellTab();
    await clickConnectButton();
    await emitEvent('object-shell:status', { sessionId: 'sess-1', status: 'open' });

    // Stop was requested outside this tab, so only the backend status says it was intentional.
    await emitEvent('object-shell:status', { sessionId: 'sess-1', status: 'ended' });

    expect(app.backend.calls('CloseShellSession')).toEqual([]);
    expect(container().querySelector('.shell-tab__button')).not.toBeNull();
    expect(container().querySelector('.shell-tab__connection-error')).toBeNull();
    expect(app.errors.records()).toEqual([]);
  });

  it('keeps the session attached and reports the failure when ending it fails', async () => {
    const failure = new Error('end failed');
    app.backend.answer('CloseShellSession', () => {
      throw failure;
    });
    await renderShellTab();
    await clickConnectButton();
    await emitEvent('object-shell:status', { sessionId: 'sess-1', status: 'open' });

    const endButton = requireValue(findEndSessionButton(), 'expected End Session');
    await act(async () => endButton.click());
    await flush();

    const reports = app.errors.take((record) => record.error === failure);
    expect(reports.map((record) => [record.kinds, record.context])).toEqual([
      [['toast'], { action: 'closeShellSession', sessionId: 'sess-1', source: 'ShellTab' }],
    ]);
    expect(endButton.disabled).toBe(false);
    getLatestTerminal()?.triggerData('pwd\n');
    await flush();
    expect(app.backend.calls('SendShellInput')).toContainEqual(['sess-1', 'pwd\n']);
  });

  it('detaches without closing the shell session when the component unmounts', async () => {
    await renderShellTab();
    await clickConnectButton();

    view().clear();
    await flush();

    expect(app.backend.calls('CloseShellSession')).toEqual([]);
  });

  it('reattaches to an existing tracked shell session for the same pod', async () => {
    trackSessions(tracked('existing-1', alpha));

    await renderShellTab();

    expect(container().querySelector('.shell-tab__controls')).toBeNull();
    expect(container().querySelector('[id$="-shell-tab-debug-toggle"]')).toBeNull();
    expect(app.backend.calls('StartShellSession')).toEqual([]);
  });

  it('closes a late start after the tab becomes inactive', async () => {
    await renderShellTab();
    app.backend.answer('StartShellSession', () => ({
      sessionId: 'late-session',
      target: podTarget(alpha),
      container: 'app',
      command: ['/bin/sh'],
      containers: ['app'],
    }));
    const finishStart = app.backend.hold('StartShellSession');
    await clickConnectButton();
    await renderShellTab({ isActive: false });

    finishStart();
    await flush();

    expect(app.backend.calls('CloseShellSession')).toEqual([['late-session']]);
    expect(app.backend.calls('SendShellInput')).toEqual([]);
  });

  it('reattaches to the matching cluster when pod names overlap', async () => {
    trackSessions(tracked('matching', alpha), tracked('other-cluster', beta));

    await renderShellTab();

    expect(app.backend.calls('GetShellSessionBacklog')).toEqual([['matching']]);
    getLatestTerminal()?.triggerData('pwd\n');
    await flush();
    expect(app.backend.calls('SendShellInput')).toContainEqual(['matching', 'pwd\n']);
  });

  it('replays buffered output when reattaching to a tracked session', async () => {
    trackSessions(tracked('existing-1', alpha));
    app.backend.answer('GetShellSessionBacklog', () => 'prior output\r\n$ ');

    await renderShellTab();

    expect(app.backend.calls('GetShellSessionBacklog')).toEqual([['existing-1']]);
    expect(getLatestTerminal()?.write).toHaveBeenCalledWith('prior output\r\n$ ');
  });

  it('detaches the old terminal and attaches the same pod in a different cluster', async () => {
    trackSessions(tracked('alpha-session', alpha), tracked('beta-session', beta));
    await renderShellTab();
    const oldTerminal = getLatestTerminal();

    await renderShellTab({ target: podTarget(beta) });

    expect(oldTerminal?.dispose).toHaveBeenCalled();
    expect(app.backend.calls('GetShellSessionBacklog')).toContainEqual(['beta-session']);
    getLatestTerminal()?.triggerData('pwd\n');
    await flush();
    expect(last(app.backend.calls('SendShellInput'))).toEqual(['beta-session', 'pwd\n']);
    expect(app.backend.calls('CloseShellSession')).toEqual([]);
  });

  it('ignores a late attachment lookup after switching clusters', async () => {
    await startWorkspace();
    trackSessions(tracked('alpha-session', alpha));
    const finishLookup = app.backend.hold('ListShellSessions');
    await renderShellTab();

    trackSessions(tracked('beta-session', beta));
    await renderShellTab({ target: podTarget(beta) });
    finishLookup();
    await flush();

    expect(app.backend.calls('GetShellSessionBacklog')).toEqual([['beta-session']]);
  });

  it('does not replay an old cluster backlog into the new terminal', async () => {
    trackSessions(tracked('alpha-session', alpha), tracked('beta-session', beta));
    const backlog = (sessionId: string) =>
      sessionId === 'beta-session' ? 'beta output' : 'alpha output';
    app.backend.answer('GetShellSessionBacklog', backlog);
    await startWorkspace();
    const finishBacklog = app.backend.hold('GetShellSessionBacklog');
    await renderShellTab();

    app.backend.answer('GetShellSessionBacklog', backlog);
    await renderShellTab({ target: podTarget(beta) });
    finishBacklog();
    await flush();

    const terminal = getLatestTerminal();
    expect(terminal?.write).toHaveBeenCalledWith('beta output');
    expect(terminal?.write).not.toHaveBeenCalledWith('alpha output');
  });

  it('ignores container discovery from the previous cluster', async () => {
    const containers = new Map([
      [alpha.clusterId, [podContainer('alpha-container')]],
      [beta.clusterId, [podContainer('beta-container')]],
    ]);
    answerPodContainers(containers);
    await startWorkspace();
    const finishDiscovery = app.backend.hold('GetPodContainers');
    await renderShellTab();

    answerPodContainers(containers);
    await renderShellTab({ target: podTarget(beta) });
    finishDiscovery();
    await flush();

    const selector = requireValue(container().querySelector('select'), 'container selector');
    expect(Array.from(selector.options, (option) => option.value)).toEqual(['beta-container']);
  });

  it('clears discovered containers and their selection when the cluster changes', async () => {
    answerPodContainers(new Map([[alpha.clusterId, [podContainer('alpha-container')]]]));
    await renderShellTab();
    await renderShellTab({
      target: podTarget(beta),
      availableContainers: ['beta-container'],
    });
    await clickConnectButton();

    expect(last(app.backend.calls('StartShellSession'))).toEqual([
      expect.objectContaining({ target: podTarget(beta), container: 'beta-container' }),
    ]);
  });

  it.each(['success', 'failure'] as const)(
    'ignores late debug creation %s after switching clusters',
    async (outcome) => {
      app.backend.answer('RunObjectAction', () => {
        if (outcome === 'failure') {
          throw new Error('alpha creation failed');
        }
        return {
          debugContainer: { containerName: 'alpha-debug', namespace: 'team-a', podName: 'pod-1' },
        };
      });
      const finishDebug = app.backend.hold('RunObjectAction');
      await renderShellTab({ availableContainers: ['alpha-container'] });
      setDebugContainerEnabled(true);
      act(() => {
        requireValue(
          container().querySelector<HTMLButtonElement>('.shell-tab__debug-button'),
          'expected debug action'
        ).click();
      });
      await renderShellTab({
        target: podTarget(beta),
        availableContainers: ['beta-container'],
      });
      finishDebug();
      await flush();

      expect(app.backend.calls('StartShellSession')).toEqual([]);
      expect(app.errors.records()).toEqual([]);
      const button = requireValue(
        container().querySelector<HTMLButtonElement>('.shell-tab__debug-button'),
        'expected new cluster debug action'
      );
      expect(button.disabled).toBe(false);
      answerShellBackend();
      await act(async () => button.click());
      await flush();
      expect(last(app.backend.calls('RunObjectAction'))).toEqual([
        expect.objectContaining({
          target: expect.objectContaining({ clusterId: beta.clusterId }),
          debugContainer: expect.objectContaining({ targetContainer: 'beta-container' }),
        }),
      ]);
      expect(last(app.backend.calls('StartShellSession'))).toEqual([
        expect.objectContaining({ target: podTarget(beta), container: 'debug-abc12345' }),
      ]);
    }
  );

  it('deduplicates replay overlap when live output arrives during backlog replay', async () => {
    trackSessions(tracked('existing-1', alpha));
    app.backend.answer('GetShellSessionBacklog', () => '# ');
    await startWorkspace();
    const finishBacklog = app.backend.hold('GetShellSessionBacklog');

    await renderShellTab();
    expect(app.backend.calls('GetShellSessionBacklog')).toEqual([['existing-1']]);

    await emitEvent('object-shell:output', {
      sessionId: 'existing-1',
      stream: 'stdout',
      data: '# ',
    });
    finishBacklog();
    await flush();

    const terminal = getLatestTerminal();
    const promptWrites = terminal?.write.mock.calls.filter((args) => args[0] === '# ') ?? [];
    expect(promptWrites).toHaveLength(1);
  });

  it('renders a debug checkbox toggle', async () => {
    await renderShellTab();
    const toggle = container().querySelector<HTMLInputElement>('[id$="-shell-tab-debug-toggle"]');
    expect(toggle).not.toBeNull();
    expect(toggle?.checked).toBe(false);
  });

  it('shows debug controls when debug container toggle is enabled', async () => {
    await renderShellTab();
    setDebugContainerEnabled(true);
    await flush();

    const debugButton = container().querySelector('.shell-tab__debug-button');
    expect(debugButton).not.toBeNull();
    expect(debugButton?.textContent).toBe('Start');
  });

  const startDebugContainer = async () => {
    const debugBtn = requireValue(
      container().querySelector<HTMLButtonElement>('.shell-tab__debug-button'),
      'expected debug action'
    );
    await act(async () => {
      debugBtn.click();
    });
    await flush();
    return debugBtn;
  };

  it('creates a debug container for the complete pod identity', async () => {
    await renderShellTab({ availableContainers: ['app'] });
    setDebugContainerEnabled(true);
    await flush();

    await startDebugContainer();

    expect(app.backend.calls('RunObjectAction')).toEqual([
      [
        {
          action: 'createDebugContainer',
          target: podTarget(alpha),
          debugContainer: {
            image: 'busybox:latest',
            targetContainer: 'app',
          },
        },
      ],
    ]);
  });

  it('shows error when debug container action fails', async () => {
    app.backend.answer('RunObjectAction', () => {
      throw new Error('ephemeral containers not supported');
    });
    await renderShellTab({ availableContainers: ['app'] });
    setDebugContainerEnabled(true);
    await flush();

    await startDebugContainer();

    expect(app.backend.calls('RunObjectAction')).toHaveLength(1);
    expect(getLatestTerminal()?.writeln).toHaveBeenCalledWith(
      expect.stringContaining('Failed to create debug container')
    );
    expect(container().textContent).toContain('Connection failed');
    expect(container().textContent).toContain('ephemeral containers not supported');
    expect(inlineReports()).toEqual([
      {
        message: 'ephemeral containers not supported',
        context: { action: 'createDebugContainer', source: 'ShellTab', clusterId: alpha.clusterId },
      },
    ]);
  });

  it('shows shell connection failure reason when start fails', async () => {
    app.backend.answer('StartShellSession', () => {
      throw new Error('exec: "/bin/sh": file not found');
    });
    await renderShellTab();

    await clickConnectButton();

    expect(container().textContent).toContain('Connection failed');
    expect(container().textContent).toContain('exec: "/bin/sh": file not found');
    expect(inlineReports()).toEqual([
      {
        message: 'exec: "/bin/sh": file not found',
        context: { action: 'startShellSession', source: 'ShellTab', clusterId: alpha.clusterId },
      },
    ]);
  });

  it('keeps the first connection error visible if a closed status follows', async () => {
    await renderShellTab();
    await clickConnectButton();

    await emitEvent('object-shell:status', {
      sessionId: 'sess-1',
      status: 'error',
      reason: 'exec: "/bin/sh": file not found',
    });
    await emitEvent('object-shell:status', {
      sessionId: 'sess-1',
      status: 'closed',
      reason: 'Session closed.',
    });

    expect(container().textContent).toContain('Connection failed');
    expect(container().textContent).toContain('exec: "/bin/sh": file not found');
    expect(inlineReports()).toEqual([
      {
        message: 'exec: "/bin/sh": file not found',
        context: { action: 'runShellSession', source: 'ShellTab', clusterId: alpha.clusterId },
      },
    ]);
  });

  it('shows a connection error when session closes immediately without an explicit reason', async () => {
    await renderShellTab();
    await clickConnectButton();

    await emitEvent('object-shell:output', {
      sessionId: 'sess-1',
      stream: 'stderr',
      data: 'exec: "/bin/bash": file not found\r\n',
    });
    await emitEvent('object-shell:status', { sessionId: 'sess-1', status: 'closed', reason: '' });

    expect(container().textContent).toContain('Connection failed');
    expect(container().textContent).toContain('exec: "/bin/bash": file not found');
    expect(inlineReports()).toEqual([
      {
        message: expect.stringContaining('exec: "/bin/bash": file not found'),
        context: { action: 'runShellSession', source: 'ShellTab', clusterId: alpha.clusterId },
      },
    ]);
  });

  it('shows custom image input when Custom... is selected', async () => {
    await renderShellTab({ availableContainers: ['app'] });
    setDebugContainerEnabled(true);
    await flush();

    expect(container().querySelector('.shell-tab__custom-image-input')).toBeNull();

    const imageSelect = requireValue(container().querySelector('select'), 'image selector');
    act(() => {
      imageSelect.value = '__custom__';
      imageSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();

    expect(container().querySelector('.shell-tab__custom-image-input')).not.toBeNull();
  });

  it('disables Debug button and shows reason when debug capability is denied', async () => {
    await renderShellTab({
      availableContainers: ['app'],
      debugDisabledReason: 'Missing permission: update pods/ephemeralcontainers',
    });
    setDebugContainerEnabled(true);
    await flush();

    const debugBtn = requireValue(
      container().querySelector<HTMLButtonElement>('.shell-tab__debug-button'),
      'expected debug action'
    );
    expect(debugBtn.disabled).toBe(true);

    const warning = container().querySelector('.shell-tab__debug-warning');
    expect(warning).not.toBeNull();
    expect(warning?.textContent).toContain('Missing permission');
  });

  it('disables Debug button when shell access is denied', async () => {
    await renderShellTab({
      availableContainers: ['app'],
      disabledReason: 'Missing permission: create pods/exec',
    });
    setDebugContainerEnabled(true);
    await flush();

    const debugBtn = await startDebugContainer();
    expect(debugBtn.disabled).toBe(true);
    expect(app.backend.calls('RunObjectAction')).toEqual([]);
  });

  it('hides controls while a shell session is active', async () => {
    await renderShellTab();
    await clickConnectButton();
    await emitEvent('object-shell:status', { sessionId: 'sess-1', status: 'open' });

    expect(container().querySelector('.shell-tab__controls')).toBeNull();
    expect(container().querySelector('[id$="-shell-tab-debug-toggle"]')).toBeNull();
  });

  /** Gives the connected terminal 200 lines of scrollback in a 200px, 40-row view. */
  const layOutScrollback = async () => {
    const terminal = requireValue(getLatestTerminal(), 'expected a terminal');
    terminal.buffer.active.baseY = 160;
    terminal.buffer.active.viewportY = 0;
    terminal.rows = 40;

    const terminalElement = requireValue(
      container().querySelector<HTMLDivElement>('.shell-tab__terminal'),
      'expected the terminal element'
    );
    Object.defineProperty(terminalElement, 'clientHeight', {
      configurable: true,
      value: 200,
    });
    terminalElement.getBoundingClientRect = () =>
      ({
        bottom: 200,
        height: 200,
        left: 0,
        right: 200,
        top: 0,
        width: 200,
        x: 0,
        y: 0,
        toJSON: () => undefined,
      }) as DOMRect;

    act(() => {
      terminal.triggerWriteParsed();
    });
    await flush();
    return terminal;
  };

  it('renders a custom shell scrollbar from xterm buffer geometry', async () => {
    await renderShellTab();
    await clickConnectButton();
    const terminal = await layOutScrollback();

    const scrollbar = container().querySelector<HTMLElement>('.scrollbar-virtual--vertical');
    expect(scrollbar).toBeTruthy();
    expect(scrollbar?.style.getPropertyValue('--scrollbar-virtual-thumb-size')).toBe('40px');
    expect(scrollbar?.style.getPropertyValue('--scrollbar-virtual-thumb-offset')).toBe('0px');

    act(() => {
      terminal.triggerScroll(80);
    });
    await flush();

    expect(scrollbar?.classList.contains('scrollbar-virtual--active')).toBe(true);
    expect(scrollbar?.style.getPropertyValue('--scrollbar-virtual-thumb-offset')).toBe('80px');

    const wrapper = requireValue(
      container().querySelector<HTMLDivElement>('.shell-tab__terminal-wrapper'),
      'expected the terminal wrapper'
    );
    act(() => {
      wrapper.dispatchEvent(
        new MouseEvent('pointermove', {
          bubbles: true,
          clientX: 198,
          clientY: 100,
        })
      );
    });
    await flush();

    expect(scrollbar?.classList.contains('scrollbar-virtual--hovered')).toBe(true);
  });

  it('supports paging and dragging the custom shell scrollbar', async () => {
    await renderShellTab();
    await clickConnectButton();
    const terminal = await layOutScrollback();

    const scrollbar = requireValue(
      container().querySelector<HTMLElement>('.scrollbar-virtual--vertical'),
      'expected the scrollbar'
    );
    const thumb = requireValue(
      container().querySelector<HTMLElement>('.scrollbar-virtual-thumb'),
      'expected the scrollbar thumb'
    );

    act(() => {
      scrollbar.dispatchEvent(
        new MouseEvent('pointerdown', {
          bubbles: true,
          button: 0,
          cancelable: true,
          clientY: 190,
        })
      );
    });
    await flush();

    expect(terminal.scrollLines).toHaveBeenCalledWith(40);

    act(() => {
      scrollbar.dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          deltaY: 80,
        })
      );
    });
    await flush();

    expect(terminal.scrollLines).toHaveBeenCalledWith(2);

    thumb.setPointerCapture = vi.fn();
    thumb.releasePointerCapture = vi.fn();
    const pointerDown = new MouseEvent('pointerdown', {
      bubbles: true,
      button: 0,
      cancelable: true,
      clientY: 50,
    }) as PointerEvent;
    Object.defineProperty(pointerDown, 'pointerId', { value: 1 });

    act(() => {
      thumb.dispatchEvent(pointerDown);
    });

    const pointerMove = new MouseEvent('pointermove', {
      bubbles: true,
      cancelable: true,
      clientY: 90,
    }) as PointerEvent;
    Object.defineProperty(pointerMove, 'pointerId', { value: 1 });

    act(() => {
      thumb.dispatchEvent(pointerMove);
    });
    await flush();

    expect(terminal.scrollToLine).toHaveBeenCalledWith(82);
  });

  it('includes debug containers in shell dropdown from backend container discovery', async () => {
    answerPodContainers(
      new Map([
        [
          alpha.clusterId,
          [
            podContainer('init-a', { isInit: true }),
            podContainer('app'),
            podContainer('debug-abc', { isEphemeral: true }),
          ],
        ],
      ])
    );
    await renderShellTab();

    const containerSelect = requireValue(container().querySelector('select'), 'container selector');
    const values = Array.from(containerSelect.options).map((option) => option.value);
    expect(values).toContain('app');
    expect(values).toContain('debug-abc');
    expect(values).not.toContain('init-a');
  });

  describe('on a node', () => {
    // Complete identity of the Node a node shell targets.
    const nodeTarget = (cluster: TestCluster) => ({
      clusterId: cluster.clusterId,
      group: '',
      version: 'v1',
      kind: 'Node',
      name: 'worker-1',
    });
    const debugPod = () => ({
      clusterId: alpha.clusterId,
      group: '',
      version: 'v1',
      kind: 'Pod',
      namespace: 'default',
      name: 'node-debugger-worker-1-abcde',
    });
    const nodeSession = (): StartedSession => ({
      sessionId: 'node-sess',
      target: nodeTarget(alpha),
      debugPod: debugPod(),
      container: 'debugger',
      command: ['/bin/bash'],
      containers: ['debugger'],
    });
    const trackedNodeSession = (overrides: Partial<TrackedSession> = {}) =>
      tracked('node-sess', alpha, {
        target: nodeTarget(alpha),
        debugPod: debugPod(),
        container: 'debugger',
        command: ['/bin/bash'],
        ...overrides,
      });

    const choose = (ariaLabel: string, value: string) => {
      const select = requireValue(
        container().querySelector<HTMLSelectElement>(`select[aria-label="${ariaLabel}"]`),
        `expected ${ariaLabel}`
      );
      act(() => {
        select.value = value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
    };
    const clickStart = async () => {
      const start = Array.from(container().querySelectorAll<HTMLButtonElement>('button')).find(
        (button) => button.textContent === 'Start'
      );
      act(() => {
        requireValue(start, 'expected node shell Start button').click();
      });
      await flush();
    };

    it('starts a node shell with the chosen image and shell', async () => {
      app.backend.answer('StartNodeShellSession', nodeSession);
      await renderShellTab({ target: nodeTarget(alpha) });

      // A node has no containers to pick or ephemeral container to add.
      expect(container().querySelector('select[aria-label="Shell container selector"]')).toBeNull();
      expect(container().querySelector('[id$="-shell-tab-debug-toggle"]')).toBeNull();
      expect(app.backend.calls('GetPodContainers')).toEqual([]);

      choose('Debug container image', 'alpine:latest');
      choose('Shell command selector', '/bin/bash');
      await clickStart();

      expect(app.backend.calls('StartNodeShellSession')).toEqual([
        [{ target: nodeTarget(alpha), image: 'alpine:latest', command: ['/bin/bash'] }],
      ]);
      expect(app.backend.calls('StartShellSession')).toEqual([]);
      // The session bar names the debug pod the shell runs in.
      expect(container().querySelector('.shell-tab__session-summary')?.textContent).toContain(
        'node-debugger-worker-1-abcde'
      );
      getLatestTerminal()?.triggerData('ls /host\n');
      await flush();
      expect(app.backend.calls('SendShellInput')).toContainEqual(['node-sess', 'ls /host\n']);
    });

    it('starts a node shell from a custom image and shell path', async () => {
      // Air-gapped or locked-down clusters pull debug images from their own registry.
      app.backend.answer('StartNodeShellSession', nodeSession);
      await renderShellTab({ target: nodeTarget(alpha) });
      const type = async (ariaLabel: string, value: string) => {
        const input = requireValue(
          container().querySelector<HTMLInputElement>(`input[aria-label="${ariaLabel}"]`),
          `expected ${ariaLabel}`
        );
        await act(async () => {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
            input,
            value
          );
          input.dispatchEvent(new Event('input', { bubbles: true }));
        });
      };

      choose('Debug container image', '__custom__');
      await type('Custom debug image', ' registry.internal/tools:1.4 ');
      choose('Shell command selector', '__custom__');
      await type('Custom shell path', '/usr/bin/zsh');
      await clickStart();

      expect(app.backend.calls('StartNodeShellSession')).toEqual([
        [
          {
            target: nodeTarget(alpha),
            image: 'registry.internal/tools:1.4',
            command: ['/usr/bin/zsh'],
          },
        ],
      ]);
    });

    it('shows why the debug pod could not start, such as an admission rejection', async () => {
      const rejection =
        'pods "node-debugger-worker-1-abcde" is forbidden: violates PodSecurity "baseline:latest": privileged';
      app.backend.answer('StartNodeShellSession', () => {
        throw new Error(rejection);
      });
      await renderShellTab({ target: nodeTarget(alpha) });

      await clickStart();

      expect(container().textContent).toContain('Connection failed');
      expect(container().textContent).toContain('violates PodSecurity');
      expect(inlineReports()).toEqual([
        {
          message: rejection,
          context: {
            action: 'startNodeShellSession',
            source: 'ShellTab',
            clusterId: alpha.clusterId,
          },
        },
      ]);
    });

    it('reattaches to the node shell tracked for this node only', async () => {
      trackSessions(
        trackedNodeSession({
          sessionId: 'other-node',
          target: { ...nodeTarget(alpha), name: 'worker-2' },
        }),
        trackedNodeSession()
      );

      await renderShellTab({ target: nodeTarget(alpha) });

      expect(app.backend.calls('GetShellSessionBacklog')).toEqual([['node-sess']]);
      expect(app.backend.calls('StartNodeShellSession')).toEqual([]);
      expect(container().querySelector('.shell-tab__session-summary')?.textContent).toContain(
        'node-debugger-worker-1-abcde'
      );
    });

    const cleanupFailure =
      'debug pod default/node-debugger-worker-1-abcde was not deleted: dial tcp: connection refused';
    const cleanupNotice = () => container().querySelector('.shell-tab__cleanup-failure');

    it('ends the session normally but names the debug pod it could not delete', async () => {
      app.backend.answer('StartNodeShellSession', nodeSession);
      await renderShellTab({ target: nodeTarget(alpha) });
      await clickStart();

      await emitEvent('object-shell:status', {
        sessionId: 'node-sess',
        status: 'cleanup-failed',
        reason: cleanupFailure,
      });

      // The shell ended; only the cleanup failed, so this is not a connection failure.
      expect(container().querySelector('.shell-tab__connection-error')).toBeNull();
      expect(cleanupNotice()?.textContent).toContain(cleanupFailure);
      expect(findEndSessionButton()).toBeUndefined();

      // A retry from the Sessions list that deletes the pod clears the notice.
      await emitEvent('object-shell:status', { sessionId: 'node-sess', status: 'ended' });
      expect(cleanupNotice()).toBeNull();
    });

    it('shows a kept debug pod instead of reattaching to its ended shell', async () => {
      trackSessions(
        trackedNodeSession({
          status: types.ShellSessionStatus.ShellSessionStatusCleanupFailed,
          statusReason: cleanupFailure,
        })
      );

      await renderShellTab({ target: nodeTarget(alpha) });

      expect(app.backend.calls('GetShellSessionBacklog')).toEqual([]);
      expect(findEndSessionButton()).toBeUndefined();
      expect(cleanupNotice()?.textContent).toContain(cleanupFailure);
    });
  });
});
