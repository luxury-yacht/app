/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Shell/ShellTab.tsx
 */

import * as XtermClipboard from '@xterm/addon-clipboard';
import * as XtermFit from '@xterm/addon-fit';
import * as Xterm from '@xterm/xterm';
import { useCallback, useEffect, useMemo, useRef, useState, type WheelEvent } from 'react';
import {
  readShellSessionBacklog,
  readShellSessions,
  requestAppState,
} from '@/core/app-state-access';
import { readPodContainers, requestData } from '@/core/data-access';
import '@xterm/xterm/css/xterm.css';
import type { types } from '@core/backend-api/models';
import { type DesktopEventPayload, onEvent } from '@core/desktop-runtime';
import {
  buildObjectActionTarget,
  runCreateDebugContainer,
} from '@shared/actions/objectActionClient';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import ContextMenu from '@shared/components/ContextMenu';
import type { DropdownOption } from '@shared/components/dropdowns/Dropdown';
import { ErrorSurface } from '@shared/components/errors/ErrorSurface';
import { useVirtualScrollbar } from '@shared/scrollbars/useVirtualScrollbar';
import { resolveTerminalTheme, toXtermThemeDefinition } from '@shared/terminal/terminalTheme';
import { useDockablePanelState } from '@ui/dockable';
import { useKeyboardSurface } from '@ui/shortcuts';
import { errorHandler } from '@utils/errorHandler';
import {
  CloseShellSession,
  ResizeShellSession,
  SendShellInput,
  StartShellSession,
} from '@/core/backend-api';
import ShellConnectionControls from './ShellConnectionControls';
import './ShellTab.css';

interface ShellTabProps {
  namespace: string;
  resourceName: string;
  disabledReason?: string;
  debugDisabledReason?: string;
  isActive: boolean;
  availableContainers: string[];
  clusterId?: string | null;
}

interface ShellTarget {
  clusterId: string;
  namespace: string;
  resourceName: string;
}

type ShellStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

type ShellOutputEvent = DesktopEventPayload<'object-shell:output'>;

interface PendingReplayState {
  sessionId: string;
  bufferedOutput: string[];
}

interface ShellContextMenuState {
  position: { x: number; y: number };
}

const ANSI_ESCAPE_SEQUENCE_PATTERN_SOURCE = '\\u001b\\[[0-9;]*[A-Za-z]';

function deriveConnectionFailureReason(output: string, fallbackReason?: string): string {
  const normalizedFallback = fallbackReason?.trim();
  if (normalizedFallback) {
    return normalizedFallback;
  }

  const normalizedOutput = output
    .replace(new RegExp(ANSI_ESCAPE_SEQUENCE_PATTERN_SOURCE, 'g'), '')
    .replace(/\r/g, '\n');
  const lines = normalizedOutput
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return 'Shell command failed to start in the selected container.';
  }

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (
      /not found|no such file|exec failed|executable file|permission denied|exit code/i.test(line)
    ) {
      return line;
    }
  }

  return lines[lines.length - 1];
}

function trimBacklogOverlap(backlog: string, bufferedOutput: string): string {
  if (!backlog || !bufferedOutput) {
    return bufferedOutput;
  }
  const maxOverlap = Math.min(backlog.length, bufferedOutput.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    if (backlog.endsWith(bufferedOutput.slice(0, overlap))) {
      return bufferedOutput.slice(overlap);
    }
  }
  return bufferedOutput;
}

async function startTrackedShellSession(
  clusterId: string,
  request: Parameters<typeof StartShellSession>[1],
  isCancelled: () => boolean
): Promise<types.ShellSession | null> {
  const session = await StartShellSession(clusterId, request);
  if (!session) {
    throw new Error('Shell session was not created');
  }
  if (isCancelled()) {
    await CloseShellSession(session.sessionId);
    return null;
  }
  return session;
}

async function createDebugShellContainer(
  target: ShellTarget,
  options: Parameters<typeof runCreateDebugContainer>[1]
): Promise<types.DebugContainerResponse> {
  const response = await runCreateDebugContainer(
    buildObjectActionTarget(
      {
        clusterId: target.clusterId,
        group: '',
        version: 'v1',
        kind: 'Pod',
        namespace: target.namespace,
        name: target.resourceName,
      },
      'create debug container for'
    ),
    options
  );
  const debugContainer = response.debugContainer as types.DebugContainerResponse | undefined;
  if (!debugContainer) {
    throw new Error('Backend did not return debug container details');
  }
  return debugContainer;
}

type TrackedShellSession = Awaited<ReturnType<typeof readShellSessions>>[number];

function attachedShellSession(session: TrackedShellSession): types.ShellSession {
  return {
    sessionId: session.sessionId,
    namespace: session.namespace,
    podName: session.podName,
    container: session.container,
    command: session.command ?? [],
    containers: [],
  } as types.ShellSession;
}

const resolveCustomOption = (selected: string, custom: string): string =>
  selected === '__custom__' ? custom.trim() : selected;

function handleShellClipboardKey(
  event: KeyboardEvent,
  terminal: Xterm.Terminal,
  copySelection: () => boolean,
  pasteClipboard: () => Promise<boolean>
): boolean {
  if (event.type !== 'keydown' || !(event.ctrlKey || event.metaKey)) {
    return true;
  }
  const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
  const key = event.key.toLowerCase();
  if (key === 'c' && clipboard?.writeText && terminal.hasSelection() && copySelection()) {
    event.preventDefault();
    event.stopPropagation();
    return false;
  }
  if (key === 'v' && clipboard?.readText) {
    event.preventDefault();
    event.stopPropagation();
    void pasteClipboard();
    return false;
  }
  return true;
}

const ShellTab: React.FC<ShellTabProps> = ({
  namespace,
  resourceName,
  isActive,
  disabledReason,
  debugDisabledReason,
  availableContainers,
  clusterId,
}) => {
  const panelState = useDockablePanelState('object-panel');
  const [session, setSession] = useState<types.ShellSession | null>(null);
  const [startDebugContainer, setStartDebugContainer] = useState(false);
  const [status, setStatus] = useState<ShellStatus>('idle');
  const [containerOverride, setContainerOverride] = useState<string | null>(null);
  const [commandOverride, setCommandOverride] = useState<string>('/bin/sh');
  const [customShell, setCustomShell] = useState('');
  const resolvedShell = resolveCustomOption(commandOverride, customShell);
  const [debugImage, setDebugImage] = useState('busybox:latest');
  const [customImage, setCustomImage] = useState('');
  const [debugTarget, setDebugTarget] = useState<string | null>(null);
  const [debugCreating, setDebugCreating] = useState(false);
  const [discoveredContainers, setDiscoveredContainers] = useState<string[]>([]);
  const [reconnectToken, setReconnectToken] = useState(0);
  const [statusReason, setStatusReason] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ShellContextMenuState | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const statusRef = useRef<ShellStatus>('idle');
  const terminalRef = useRef<Xterm.Terminal | null>(null);
  const fitAddonRef = useRef<XtermFit.FitAddon | null>(null);
  const terminalContainerRef = useRef<HTMLDivElement | null>(null);
  const terminalWrapperRef = useRef<HTMLDivElement | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const terminalDataDisposableRef = useRef<{ dispose: () => void } | null>(null);
  const terminalScrollDisposableRef = useRef<{ dispose: () => void } | null>(null);
  const terminalResizeDisposableRef = useRef<{ dispose: () => void } | null>(null);
  const terminalWriteParsedDisposableRef = useRef<{ dispose: () => void } | null>(null);
  const pendingReplayRef = useRef<PendingReplayState | null>(null);
  const sessionOpenedAtRef = useRef<number | null>(null);
  const sessionOutputBufferRef = useRef('');
  const skipNextResizeRef = useRef(false);
  const renderedSessionIdRef = useRef<string | null>(null);
  const attachInFlightRef = useRef<ShellTarget | null>(null);
  const [terminalReady, setTerminalReady] = useState(false);
  const resolvedClusterId = clusterId?.trim() ?? '';
  const writeToTerminal = useCallback((text: string) => {
    if (!terminalRef.current) {
      return;
    }
    terminalRef.current.write(text);
  }, []);
  const writeLine = useCallback((text: string) => {
    if (!terminalRef.current) {
      return;
    }
    terminalRef.current.writeln(text);
  }, []);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const setConnectionStatus = useCallback((nextStatus: ShellStatus) => {
    statusRef.current = nextStatus;
    setStatus(nextStatus);
  }, []);

  const clearSession = useCallback(() => {
    sessionIdRef.current = null;
    sessionOpenedAtRef.current = null;
    setSession(null);
  }, []);

  const resolveThemeColors = useCallback(() => {
    const container = terminalContainerRef.current;
    return resolveTerminalTheme(container ? getComputedStyle(container) : null);
  }, []);

  const pasteTextToTerminal = useCallback((text: string) => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }

    terminal.focus();
    terminal.paste(text);
  }, []);

  const pasteClipboardToTerminal = useCallback(async () => {
    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
    if (!clipboard?.readText) {
      return false;
    }

    try {
      const text = await clipboard.readText();
      pasteTextToTerminal(text ?? '');
      return true;
    } catch {
      return false;
    }
  }, [pasteTextToTerminal]);

  const copyTerminalSelection = useCallback(() => {
    const terminal = terminalRef.current;
    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
    if (!terminal || !clipboard?.writeText || !terminal.hasSelection()) {
      return false;
    }

    const selection = terminal.getSelection();
    if (!selection) {
      return false;
    }

    void clipboard.writeText(selection).catch(() => {
      /* ignore clipboard write failures */
    });
    return true;
  }, []);

  const selectAllTerminalText = useCallback(() => {
    const terminal = terminalRef.current as (Xterm.Terminal & { selectAll?: () => void }) | null;
    if (!terminal?.selectAll) {
      return false;
    }

    terminal.selectAll();
    terminal.focus();
    return true;
  }, []);

  const getShellScrollbarHost = useCallback(() => terminalContainerRef.current, []);

  const getShellScrollbarMetrics = useCallback(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return null;
    }

    const buffer = terminal.buffer.active;
    return {
      contentSize: buffer.baseY + terminal.rows,
      scrollOffset: buffer.viewportY,
      viewportSize: terminal.rows,
    };
  }, []);

  const scrollShellBy = useCallback((delta: number) => {
    terminalRef.current?.scrollLines(delta);
  }, []);

  const scrollShellTo = useCallback((offset: number) => {
    terminalRef.current?.scrollToLine(offset);
  }, []);

  const scrollShellByWheel = useCallback((event: WheelEvent<HTMLElement>) => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }

    const rawDelta = event.deltaY !== 0 ? event.deltaY : event.deltaX;
    const lineDelta = event.deltaMode === 1 ? rawDelta : rawDelta / 40;
    if (lineDelta === 0) {
      return;
    }
    terminal.scrollLines(Math.sign(lineDelta) * Math.max(1, Math.round(Math.abs(lineDelta))));
  }, []);

  const shellScrollbar = useVirtualScrollbar({
    axis: 'vertical',
    getHostElement: getShellScrollbarHost,
    getMetrics: getShellScrollbarMetrics,
    scrollBy: scrollShellBy,
    scrollByWheel: scrollShellByWheel,
    scrollTo: scrollShellTo,
  });
  const {
    onSurfacePointerLeave: handleShellScrollbarPointerLeave,
    onSurfacePointerMove: handleShellScrollbarPointerMove,
    reset: resetShellScrollbar,
    scrollbar: shellScrollbarElement,
    show: showShellScrollbar,
    updateGeometry: updateShellScrollbarGeometry,
  } = shellScrollbar;

  const disposeTerminal = useCallback(() => {
    terminalDataDisposableRef.current?.dispose();
    terminalDataDisposableRef.current = null;
    terminalScrollDisposableRef.current?.dispose();
    terminalScrollDisposableRef.current = null;
    terminalResizeDisposableRef.current?.dispose();
    terminalResizeDisposableRef.current = null;
    terminalWriteParsedDisposableRef.current?.dispose();
    terminalWriteParsedDisposableRef.current = null;
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = null;
    resetShellScrollbar();
    terminalRef.current?.dispose();
    terminalRef.current = null;
    fitAddonRef.current = null;
    if (terminalContainerRef.current) {
      terminalContainerRef.current.innerHTML = '';
    }
    renderedSessionIdRef.current = null;
    skipNextResizeRef.current = false;
    setTerminalReady(false);
  }, [resetShellScrollbar]);

  const applyTerminalTheme = useCallback(() => {
    const terminal = terminalRef.current as
      | (Xterm.Terminal & {
          options?: {
            theme?: ReturnType<typeof toXtermThemeDefinition>;
            overviewRuler?: { width?: number };
          };
          refresh?: (start: number, end: number) => void;
        })
      | null;
    if (!terminal?.options) {
      return;
    }

    const theme = resolveThemeColors();
    terminal.options.theme = toXtermThemeDefinition(theme);
    terminal.options.overviewRuler = {
      width: theme.scrollbarWidth,
    };
    terminal.refresh?.(0, Math.max(0, terminal.rows - 1));
  }, [resolveThemeColors]);

  const ensureTerminal = useCallback(() => {
    if (terminalRef.current || !terminalContainerRef.current) {
      return;
    }

    const theme = resolveThemeColors();
    const terminal = new Xterm.Terminal({
      cursorBlink: true,
      cursorStyle: 'underline',
      scrollback: 5000,
      fontFamily: "'JetBrains Mono', 'SFMono-Regular', Consolas, monospace",
      fontSize: 12,
      lineHeight: 1.2,
      overviewRuler: {
        width: theme.scrollbarWidth,
      },
      theme: toXtermThemeDefinition(theme),
    });
    const fitAddon = new XtermFit.FitAddon();
    terminal.loadAddon(fitAddon);
    // Enable OSC 52 clipboard integration for in-terminal apps (tmux/vim/etc).
    terminal.loadAddon(new XtermClipboard.ClipboardAddon());
    terminal.open(terminalContainerRef.current);
    fitAddon.fit();
    terminal.focus();

    // Provide standard OS copy/paste shortcuts when the terminal is focused.
    terminal.attachCustomKeyEventHandler((event) =>
      handleShellClipboardKey(event, terminal, copyTerminalSelection, pasteClipboardToTerminal)
    );

    terminalDataDisposableRef.current = terminal.onData((data) => {
      if (!sessionIdRef.current || statusRef.current !== 'open') {
        return;
      }
      void SendShellInput(sessionIdRef.current, data).catch(() => {
        /* ignore */
      });
    });
    terminalScrollDisposableRef.current = terminal.onScroll(() => {
      showShellScrollbar();
    });
    terminalResizeDisposableRef.current = terminal.onResize(() => {
      updateShellScrollbarGeometry();
    });
    terminalWriteParsedDisposableRef.current = terminal.onWriteParsed(() => {
      updateShellScrollbarGeometry();
    });

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      updateShellScrollbarGeometry();
      if (sessionIdRef.current && statusRef.current === 'open') {
        if (skipNextResizeRef.current) {
          skipNextResizeRef.current = false;
          return;
        }
        void ResizeShellSession(sessionIdRef.current, terminal.cols, terminal.rows).catch(() => {
          /* ignore */
        });
      }
    });
    resizeObserver.observe(terminalContainerRef.current);

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    resizeObserverRef.current = resizeObserver;
    updateShellScrollbarGeometry();
    setTerminalReady(true);
  }, [
    copyTerminalSelection,
    pasteClipboardToTerminal,
    resolveThemeColors,
    showShellScrollbar,
    updateShellScrollbarGeometry,
  ]);

  useKeyboardSurface({
    kind: 'editor',
    rootRef: terminalContainerRef,
    active: isActive && terminalReady,
    onNativeAction: ({ action, text }) => {
      if (action === 'copy') {
        return copyTerminalSelection();
      }
      if (action === 'selectAll') {
        return selectAllTerminalText();
      }
      if (action !== 'paste') {
        return false;
      }
      if (typeof text === 'string' && text.length > 0) {
        pasteTextToTerminal(text);
        return true;
      }
      void pasteClipboardToTerminal();
      return true;
    },
  });

  useEffect(() => {
    return () => {
      disposeTerminal();
    };
  }, [disposeTerminal]);

  useEffect(() => {
    const checkAppearanceMode = () => {
      applyTerminalTheme();
    };

    const observer = new MutationObserver(checkAppearanceMode);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-appearance-mode', 'class'],
    });

    return () => observer.disconnect();
  }, [applyTerminalTheme]);

  useEffect(() => {
    void panelState.position;
    void panelState.size.width;
    void panelState.size.height;
    if (!terminalReady || !isActive) {
      return;
    }
    terminalRef.current?.focus();
  }, [terminalReady, isActive, panelState.position, panelState.size.width, panelState.size.height]);

  const activeContainer = containerOverride ?? session?.container ?? '';

  const appendOutput = useCallback(
    (entry: ShellOutputEvent) => {
      if (!entry?.data) {
        return;
      }
      const combined = `${sessionOutputBufferRef.current}${entry.data}`;
      sessionOutputBufferRef.current =
        combined.length > 4000 ? combined.slice(combined.length - 4000) : combined;
      writeToTerminal(entry.data);
    },
    [writeToTerminal]
  );

  const initiateConnection = useCallback(() => {
    pendingReplayRef.current = null;
    renderedSessionIdRef.current = null;
    skipNextResizeRef.current = false;
    sessionOpenedAtRef.current = null;
    sessionOutputBufferRef.current = '';
    setStatusReason(null);
    ensureTerminal();
    terminalRef.current?.reset();
    setConnectionStatus('connecting');
    setReconnectToken((token) => token + 1);
  }, [ensureTerminal, setConnectionStatus]);

  const lastTargetRef = useRef<ShellTarget | null>(null);

  useEffect(
    () => () => {
      lastTargetRef.current = null;
      pendingReplayRef.current = null;
    },
    []
  );

  const resetTargetSession = useCallback(() => {
    pendingReplayRef.current = null;
    sessionIdRef.current = null;
    sessionOpenedAtRef.current = null;
    sessionOutputBufferRef.current = '';
    setSession(null);
    setDiscoveredContainers([]);
    setContainerOverride(null);
    setDebugTarget(null);
    setDebugCreating(false);
    setConnectionStatus('idle');
    setStatusReason(null);
    disposeTerminal();
  }, [disposeTerminal, setConnectionStatus]);

  useEffect(() => {
    if (!namespace || !resourceName || !resolvedClusterId) {
      lastTargetRef.current = null;
      resetTargetSession();
      return;
    }
    const previous = lastTargetRef.current;
    if (
      previous &&
      (previous.clusterId !== resolvedClusterId ||
        previous.namespace !== namespace ||
        previous.resourceName !== resourceName)
    ) {
      resetTargetSession();
    }
    lastTargetRef.current = { clusterId: resolvedClusterId, namespace, resourceName };
  }, [resetTargetSession, namespace, resourceName, resolvedClusterId]);

  useEffect(() => {
    void reconnectToken;
    if (!isActive || statusRef.current !== 'connecting' || !namespace || !resourceName) {
      return;
    }

    let cancelled = false;
    const request = {
      namespace,
      podName: resourceName,
      container: containerOverride ?? undefined,
      command: resolvedShell ? [resolvedShell] : undefined,
    };
    const start = async () => {
      try {
        const shellSession = await startTrackedShellSession(
          resolvedClusterId,
          request,
          () => cancelled
        );
        if (!shellSession) {
          return;
        }
        sessionIdRef.current = shellSession.sessionId;
        sessionOpenedAtRef.current = Date.now();
        setSession(shellSession);
        setConnectionStatus('open');
        setStatusReason(null);
      } catch (error) {
        if (cancelled) {
          return;
        }
        const details = errorHandler.handleInline(error, {
          action: 'startShellSession',
          source: 'ShellTab',
          clusterId: resolvedClusterId,
        });
        clearSession();
        setConnectionStatus('error');
        setStatusReason(details.message);
        disposeTerminal();
      }
    };

    void start();
    return () => {
      cancelled = true;
    };
  }, [
    resolvedShell,
    containerOverride,
    clearSession,
    setConnectionStatus,
    disposeTerminal,
    isActive,
    namespace,
    resourceName,
    resolvedClusterId,
    reconnectToken,
  ]);

  const handleSessionClosed = useCallback(
    (reason?: string) => {
      pendingReplayRef.current = null;
      const previousStatus = statusRef.current;
      const closedTooSoon =
        previousStatus === 'connecting' ||
        (previousStatus === 'open' &&
          sessionOpenedAtRef.current !== null &&
          Date.now() - sessionOpenedAtRef.current < 1500);
      clearSession();
      disposeTerminal();
      if (statusRef.current === 'error') {
        return;
      }
      if (closedTooSoon) {
        const details = errorHandler.handleInline(
          new Error(deriveConnectionFailureReason(sessionOutputBufferRef.current, reason)),
          {
            action: 'runShellSession',
            source: 'ShellTab',
            clusterId: resolvedClusterId,
          }
        );
        setConnectionStatus('error');
        setStatusReason(details.message);
        return;
      }
      setConnectionStatus('closed');
      setStatusReason(reason || 'Session closed.');
    },
    [clearSession, disposeTerminal, resolvedClusterId, setConnectionStatus]
  );

  useEffect(() => {
    const offOutput = onEvent('object-shell:output', (evt) => {
      if (!evt || !sessionIdRef.current || evt.sessionId !== sessionIdRef.current) {
        return;
      }
      const pendingReplay = pendingReplayRef.current;
      if (pendingReplay?.sessionId === evt.sessionId) {
        pendingReplay.bufferedOutput.push(evt.data);
        return;
      }
      renderedSessionIdRef.current = evt.sessionId;
      appendOutput(evt);
    });

    const offStatus = onEvent('object-shell:status', (evt) => {
      if (!evt || !sessionIdRef.current || evt.sessionId !== sessionIdRef.current) {
        return;
      }
      switch (evt.status) {
        case 'error': {
          const details = errorHandler.handleInline(
            new Error(evt.reason || 'Shell session failed.'),
            {
              action: 'runShellSession',
              source: 'ShellTab',
              clusterId: resolvedClusterId,
            }
          );
          pendingReplayRef.current = null;
          sessionOpenedAtRef.current = null;
          setConnectionStatus('error');
          setStatusReason(details.message);
          sessionIdRef.current = null;
          setSession(null);
          disposeTerminal();
          return;
        }
        case 'closed':
        case 'timeout':
          handleSessionClosed(evt.reason);
          return;
        case 'open':
          sessionOpenedAtRef.current = Date.now();
          ensureTerminal();
          writeLine('\x1b[32mConnected\x1b[0m\r\n');
          setConnectionStatus('open');
          setStatusReason(null);
      }
    });

    return () => {
      offOutput();
      offStatus();
    };
  }, [
    appendOutput,
    handleSessionClosed,
    setConnectionStatus,
    disposeTerminal,
    ensureTerminal,
    resolvedClusterId,
    writeLine,
  ]);

  useEffect(() => {
    void session;
    if (!isActive || !terminalReady) {
      return;
    }
    terminalRef.current?.focus();
  }, [isActive, terminalReady, session]);

  const handleReconnect = useCallback(() => {
    initiateConnection();
  }, [initiateConnection]);

  const refreshContainers = useCallback(async () => {
    const target = lastTargetRef.current;
    if (!target) {
      setDiscoveredContainers([]);
      return;
    }
    try {
      const result = await requestData({
        resource: 'pod-containers',
        reason: 'user',
        read: () => readPodContainers(resolvedClusterId, namespace, resourceName),
      });
      if (lastTargetRef.current !== target) {
        return;
      }
      const containerNames = result.status === 'executed' ? (result.data ?? []) : [];
      const normalized = Array.from(
        new Set(
          containerNames
            .map((name) => name.trim())
            // init containers are not valid exec targets
            .filter((name) => !name.endsWith(' (init)'))
            .map((name) => (name.endsWith(' (debug)') ? name.replace(' (debug)', '') : name))
            .filter((name) => name.length > 0)
        )
      );
      setDiscoveredContainers(normalized);
    } catch {
      // Keep existing fallback list from details/session if fetch fails.
    }
  }, [namespace, resourceName, resolvedClusterId]);

  const finishReplay = useCallback(
    (replayState: PendingReplayState, backlog: string) => {
      if (pendingReplayRef.current !== replayState) {
        return;
      }
      const bufferedOutput = replayState.bufferedOutput.join('');
      const replayRemainder = trimBacklogOverlap(backlog, bufferedOutput);
      if (replayRemainder) {
        renderedSessionIdRef.current = replayState.sessionId;
        writeToTerminal(replayRemainder);
      }
      pendingReplayRef.current = null;
    },
    [writeToTerminal]
  );

  const replaySessionOutput = useCallback(
    async (sessionId: string) => {
      if (renderedSessionIdRef.current === sessionId && terminalRef.current) {
        pendingReplayRef.current = null;
        return;
      }
      const replayState: PendingReplayState = {
        sessionId,
        bufferedOutput: [],
      };
      pendingReplayRef.current = replayState;
      let backlog = '';
      try {
        // Replay buffered output captured while this tab was detached.
        backlog = await requestAppState({
          resource: 'shell-session-backlog',
          adapter: 'runtime-read',
          read: () => readShellSessionBacklog(sessionId),
        });
        if (backlog && pendingReplayRef.current === replayState) {
          renderedSessionIdRef.current = sessionId;
          writeToTerminal(backlog);
        }
      } catch {
        // Ignore replay failures; user can continue with live output.
      } finally {
        finishReplay(replayState, backlog);
      }
    },
    [finishReplay, writeToTerminal]
  );

  const installTrackedSession = useCallback(
    (tracked: TrackedShellSession) => {
      sessionIdRef.current = tracked.sessionId;
      // Reattach should not immediately send a resize event because many shells
      // redraw the prompt, which duplicates the backlog tail prompt.
      skipNextResizeRef.current = true;
      setSession(attachedShellSession(tracked));
      setContainerOverride(tracked.container || null);
      setStatus('open');
      setStatusReason(null);
      ensureTerminal();
    },
    [ensureTerminal]
  );

  const attachLatestTrackedSession = useCallback(async () => {
    const target = lastTargetRef.current;
    if (
      !namespace ||
      !resourceName ||
      !resolvedClusterId ||
      !target ||
      sessionIdRef.current ||
      attachInFlightRef.current === target
    ) {
      return;
    }
    attachInFlightRef.current = target;
    try {
      const sessions = await requestAppState({
        resource: 'shell-sessions',
        adapter: 'runtime-read',
        read: () => readShellSessions(),
      });
      if (lastTargetRef.current !== target) {
        return;
      }
      const matching = sessions.filter(
        (tracked) =>
          tracked.clusterId === resolvedClusterId &&
          tracked.namespace === namespace &&
          tracked.podName === resourceName
      );
      if (matching.length === 0) {
        return;
      }
      const latest = matching[matching.length - 1];
      installTrackedSession(latest);
      await replaySessionOutput(latest.sessionId);
    } catch {
      // Ignore attach failures; user can still start a new session.
    } finally {
      if (attachInFlightRef.current === target) {
        attachInFlightRef.current = null;
      }
    }
  }, [installTrackedSession, namespace, resourceName, resolvedClusterId, replaySessionOutput]);

  useEffect(() => {
    if (!isActive) {
      return;
    }
    void refreshContainers();
    void attachLatestTrackedSession();
  }, [attachLatestTrackedSession, isActive, refreshContainers]);

  const containerOptions = useMemo<DropdownOption[]>(() => {
    const merged = new Set<string>();
    availableContainers.forEach((name) => {
      if (name) {
        merged.add(name);
      }
    });
    discoveredContainers.forEach((name) => {
      if (name) {
        merged.add(name);
      }
    });
    session?.containers?.forEach((name) => {
      if (name) {
        merged.add(name);
      }
    });
    return Array.from(merged).map((name) => ({ value: name, label: name }));
  }, [availableContainers, discoveredContainers, session?.containers]);

  useEffect(() => {
    if (
      (status === 'idle' || status === 'closed') &&
      !containerOverride &&
      containerOptions.length > 0
    ) {
      setContainerOverride(containerOptions[0].value);
    }
  }, [containerOptions, containerOverride, status]);

  const resolvedDebugImage = resolveCustomOption(debugImage, customImage);

  const handleContainerChange = useCallback((value: string | string[]) => {
    const nextValue = Array.isArray(value) ? value[0] : value;
    if (!nextValue) {
      setContainerOverride(null);
    } else {
      setContainerOverride(nextValue);
    }
  }, []);

  const handleShellChange = useCallback((value: string | string[]) => {
    const nextValue = Array.isArray(value) ? value[0] : value;
    setCommandOverride(nextValue || '/bin/sh');
  }, []);
  const handleDebugImageChange = useCallback((value: string | string[]) => {
    const nextValue = Array.isArray(value) ? value[0] : value;
    setDebugImage(nextValue || 'busybox:latest');
  }, []);
  const handleDebugTargetChange = useCallback((value: string | string[]) => {
    const nextValue = Array.isArray(value) ? value[0] : value;
    if (!nextValue) {
      setDebugTarget(null);
      return;
    }
    setDebugTarget(nextValue);
  }, []);

  useEffect(() => {
    if (!debugTarget && containerOptions.length > 0) {
      setDebugTarget(containerOptions[0].value);
    }
  }, [containerOptions, debugTarget]);

  const reportDebugFailure = useCallback(
    (target: ShellTarget, error: unknown) => {
      if (lastTargetRef.current !== target) {
        return;
      }
      const details = errorHandler.handleInline(error, {
        action: 'createDebugContainer',
        source: 'ShellTab',
        clusterId: resolvedClusterId,
      });
      const reason = details.message;
      ensureTerminal();
      terminalRef.current?.reset();
      writeLine(`\r\n\x1b[31mFailed to create debug container: ${reason}\x1b[0m`);
      setStatus('error');
      setStatusReason(reason);
    },
    [ensureTerminal, resolvedClusterId, writeLine]
  );

  const handleDebug = useCallback(async () => {
    const target = lastTargetRef.current;
    if (!resolvedDebugImage || !target || debugDisabledReason || disabledReason) {
      return;
    }

    setDebugCreating(true);
    setStatusReason(null);
    try {
      const debugContainer = await createDebugShellContainer(target, {
        image: resolvedDebugImage,
        targetContainer: debugTarget || containerOptions[0]?.value || '',
      });
      if (lastTargetRef.current !== target) {
        return;
      }
      // Revert to default shell controls, target the new container, and connect.
      // The backend debug-container action polls until the ephemeral container
      // is Running, so we can initiate the connection immediately.
      setStartDebugContainer(false);
      setContainerOverride(debugContainer.containerName);
      void refreshContainers();
      initiateConnection();
    } catch (error) {
      reportDebugFailure(target, error);
    } finally {
      if (lastTargetRef.current === target) {
        setDebugCreating(false);
      }
    }
  }, [
    containerOptions,
    debugDisabledReason,
    debugTarget,
    initiateConnection,
    resolvedDebugImage,
    disabledReason,
    refreshContainers,
    reportDebugFailure,
  ]);
  const hasActiveSession = status === 'open' || status === 'connecting';
  const connectionErrorMessage =
    status === 'error' ? statusReason || 'Shell session failed.' : null;
  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
    terminalRef.current?.focus();
  }, []);

  const handleTerminalContextMenu = useCallback((event: globalThis.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    terminalRef.current?.focus();
    setContextMenu({
      position: { x: event.clientX, y: event.clientY },
    });
  }, []);

  useEffect(() => {
    const wrapper = terminalWrapperRef.current;
    if (!wrapper) {
      return;
    }
    wrapper.addEventListener('contextmenu', handleTerminalContextMenu);
    wrapper.addEventListener('pointerleave', handleShellScrollbarPointerLeave);
    wrapper.addEventListener('pointermove', handleShellScrollbarPointerMove);
    wrapper.addEventListener('wheel', showShellScrollbar);
    return () => {
      wrapper.removeEventListener('contextmenu', handleTerminalContextMenu);
      wrapper.removeEventListener('pointerleave', handleShellScrollbarPointerLeave);
      wrapper.removeEventListener('pointermove', handleShellScrollbarPointerMove);
      wrapper.removeEventListener('wheel', showShellScrollbar);
    };
  }, [
    handleShellScrollbarPointerLeave,
    handleShellScrollbarPointerMove,
    handleTerminalContextMenu,
    showShellScrollbar,
  ]);

  const contextMenuItems: ContextMenuItem[] = [
    {
      label: 'Copy',
      disabled: !terminalRef.current?.hasSelection(),
      onClick: () => {
        copyTerminalSelection();
      },
    },
    {
      label: 'Paste',
      onClick: () => {
        void pasteClipboardToTerminal();
      },
    },
    {
      divider: true,
    },
    {
      label: 'Select All',
      onClick: () => {
        selectAllTerminalText();
      },
    },
  ];

  return (
    <div className="object-panel-shell-tab">
      {!hasActiveSession && (
        <ShellConnectionControls
          startDebugContainer={startDebugContainer}
          setStartDebugContainer={setStartDebugContainer}
          debugImage={debugImage}
          handleDebugImageChange={handleDebugImageChange}
          customImage={customImage}
          setCustomImage={setCustomImage}
          containerOptions={containerOptions}
          debugTarget={debugTarget}
          handleDebugTargetChange={handleDebugTargetChange}
          commandOverride={commandOverride}
          handleShellChange={handleShellChange}
          customShell={customShell}
          setCustomShell={setCustomShell}
          activeContainer={activeContainer}
          handleContainerChange={handleContainerChange}
          handleDebug={handleDebug}
          handleReconnect={handleReconnect}
          debugCreating={debugCreating}
          resolvedDebugImage={resolvedDebugImage}
          debugDisabledReason={debugDisabledReason}
          disabledReason={disabledReason}
        />
      )}
      {startDebugContainer && !hasActiveSession && debugDisabledReason && (
        <div className="shell-tab__debug-warning">
          Debug unavailable: <span>{debugDisabledReason}</span>
        </div>
      )}
      {!!connectionErrorMessage && (
        <div className="shell-tab__connection-error" role="status" aria-live="polite">
          Connection failed:{' '}
          <span>
            <ErrorSurface kind="reported" message={connectionErrorMessage} />
          </span>
        </div>
      )}

      {!!disabledReason && (
        <div className="shell-tab__notice">
          Shell access blocked: <span>{disabledReason}</span>
        </div>
      )}

      <div
        ref={terminalWrapperRef}
        className="shell-tab__terminal-wrapper"
        data-tab-native="true"
        role="application"
        aria-label="Shell terminal"
        tabIndex={-1}
      >
        <div
          className={`shell-tab__terminal${terminalReady ? '' : ' shell-tab__terminal--hidden'}`}
          ref={terminalContainerRef}
          data-tab-native="true"
        />
        {shellScrollbarElement}
      </div>
      {!!contextMenu && (
        <ContextMenu
          items={contextMenuItems}
          position={contextMenu.position}
          onClose={handleCloseContextMenu}
        />
      )}
    </div>
  );
};

export default ShellTab;
