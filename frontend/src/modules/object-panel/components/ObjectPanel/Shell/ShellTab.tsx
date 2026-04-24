/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Shell/ShellTab.tsx
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type WheelEvent,
} from 'react';
import {
  readShellSessionBacklog,
  readShellSessions,
  requestAppState,
} from '@/core/app-state-access';
import { readPodContainers, requestData } from '@/core/data-access';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { ClipboardAddon } from '@xterm/addon-clipboard';
import '@xterm/xterm/css/xterm.css';
import ContextMenu from '@shared/components/ContextMenu';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import Tooltip from '@shared/components/Tooltip';
import { resolveTerminalTheme, toXtermThemeDefinition } from '@shared/terminal/terminalTheme';
import { EventsOn } from '@wailsjs/runtime/runtime';
import {
  CloseShellSession,
  CreateDebugContainer,
  ResizeShellSession,
  SendShellInput,
  StartShellSession,
} from '@wailsjs/go/backend/App';
import { types } from '@wailsjs/go/models';
import { Dropdown } from '@shared/components/dropdowns/Dropdown';
import type { DropdownOption } from '@shared/components/dropdowns/Dropdown';
import { useVirtualScrollbar } from '@shared/scrollbars/useVirtualScrollbar';
import { useDockablePanelState } from '@ui/dockable';
import { useKeyboardSurface } from '@ui/shortcuts';
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

type ShellStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

interface ShellOutputEvent {
  sessionId: string;
  stream: 'stdout' | 'stderr';
  data: string;
}

interface ShellStatusEvent {
  sessionId: string;
  status: string;
  reason?: string;
}

interface PendingReplayState {
  sessionId: string;
  bufferedOutput: string[];
}

interface ShellContextMenuState {
  position: { x: number; y: number };
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
  const shellDropdownMenuClassName = 'shell-tab__dropdown-menu';
  const panelState = useDockablePanelState('object-panel');
  const [session, setSession] = useState<types.ShellSession | null>(null);
  const [startDebugContainer, setStartDebugContainer] = useState(false);
  const [status, setStatus] = useState<ShellStatus>('idle');
  const [containerOverride, setContainerOverride] = useState<string | null>(null);
  const [commandOverride, setCommandOverride] = useState<string>('/bin/sh');
  const [customShell, setCustomShell] = useState('');
  const resolvedShell = commandOverride === '__custom__' ? customShell.trim() : commandOverride;
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
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const terminalContainerRef = useRef<HTMLDivElement | null>(null);
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
  const attachInFlightRef = useRef(false);
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
    const terminal = terminalRef.current as (Terminal & { selectAll?: () => void }) | null;
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
      | (Terminal & {
          options?: {
            theme?: ReturnType<typeof toXtermThemeDefinition>;
            overviewRuler?: { width?: number };
          };
          refresh?: (start: number, end: number) => void;
        })
      | null;
    if (!terminal || !terminal.options) {
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
    const terminal = new Terminal({
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
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    // Enable OSC 52 clipboard integration for in-terminal apps (tmux/vim/etc).
    terminal.loadAddon(new ClipboardAddon());
    terminal.open(terminalContainerRef.current);
    fitAddon.fit();
    terminal.focus();

    // Provide standard OS copy/paste shortcuts when the terminal is focused.
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') {
        return true;
      }

      const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
      const isModifier = event.ctrlKey || event.metaKey;
      if (!isModifier) {
        return true;
      }

      const key = event.key.toLowerCase();
      if (key === 'c') {
        if (!clipboard?.writeText || !terminal.hasSelection()) {
          return true;
        }
        if (!copyTerminalSelection()) {
          return true;
        }
        event.preventDefault();
        event.stopPropagation();
        return false;
      }

      if (key === 'v') {
        if (!clipboard?.readText) {
          return true;
        }
        event.preventDefault();
        event.stopPropagation();
        void pasteClipboardToTerminal();
        return false;
      }

      return true;
    });

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
    const checkTheme = () => {
      applyTerminalTheme();
    };

    const observer = new MutationObserver(checkTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'class'],
    });

    return () => observer.disconnect();
  }, [applyTerminalTheme]);

  useEffect(() => {
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

  const deriveConnectionFailureReason = useCallback((fallbackReason?: string) => {
    const normalizedFallback = fallbackReason?.trim();
    if (normalizedFallback) {
      return normalizedFallback;
    }

    const normalizedOutput = sessionOutputBufferRef.current
      .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
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
  }, []);

  const trimBacklogOverlap = useCallback((backlog: string, bufferedOutput: string) => {
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
  }, []);

  const initiateConnection = useCallback(() => {
    pendingReplayRef.current = null;
    renderedSessionIdRef.current = null;
    skipNextResizeRef.current = false;
    sessionOpenedAtRef.current = null;
    sessionOutputBufferRef.current = '';
    setStatusReason(null);
    ensureTerminal();
    terminalRef.current?.reset();
    statusRef.current = 'connecting';
    setStatus('connecting');
    setReconnectToken((token) => token + 1);
  }, [ensureTerminal]);

  const lastTargetRef = useRef<{ namespace: string; resourceName: string } | null>(null);

  useEffect(() => {
    if (!namespace || !resourceName) {
      lastTargetRef.current = null;
      pendingReplayRef.current = null;
      sessionIdRef.current = null;
      sessionOpenedAtRef.current = null;
      sessionOutputBufferRef.current = '';
      setSession(null);
      statusRef.current = 'idle';
      setStatus('idle');
      setStatusReason(null);
      disposeTerminal();
      return;
    }
    const previous = lastTargetRef.current;
    if (previous && (previous.namespace !== namespace || previous.resourceName !== resourceName)) {
      pendingReplayRef.current = null;
      sessionIdRef.current = null;
      sessionOpenedAtRef.current = null;
      sessionOutputBufferRef.current = '';
      setSession(null);
      statusRef.current = 'idle';
      setStatus('idle');
      setStatusReason(null);
      disposeTerminal();
    }
    lastTargetRef.current = { namespace, resourceName };
  }, [disposeTerminal, namespace, resourceName]);

  useEffect(() => {
    if (!isActive || statusRef.current !== 'connecting' || !namespace || !resourceName) {
      return;
    }

    let cancelled = false;
    const start = async () => {
      try {
        const shellSession = await StartShellSession(resolvedClusterId, {
          namespace,
          podName: resourceName,
          container: containerOverride ?? undefined,
          command: resolvedShell ? [resolvedShell] : undefined,
        });
        if (cancelled) {
          // If a superseding connect was started before this one returned, clean up this session.
          await CloseShellSession(shellSession.sessionId);
          return;
        }
        sessionIdRef.current = shellSession.sessionId;
        sessionOpenedAtRef.current = Date.now();
        setSession(shellSession);
        statusRef.current = 'open';
        setStatus('open');
        setStatusReason(null);
      } catch (error) {
        if (!cancelled) {
          const reason = error instanceof Error ? error.message : String(error);
          sessionIdRef.current = null;
          sessionOpenedAtRef.current = null;
          setSession(null);
          statusRef.current = 'error';
          setStatus('error');
          setStatusReason(reason);
          disposeTerminal();
        }
      }
    };

    void start();
    return () => {
      cancelled = true;
    };
  }, [
    resolvedShell,
    containerOverride,
    disposeTerminal,
    isActive,
    namespace,
    reconnectToken,
    resourceName,
    resolvedClusterId,
  ]);

  useEffect(() => {
    const offOutput = EventsOn('object-shell:output', (evt: ShellOutputEvent) => {
      if (!evt || !sessionIdRef.current || evt.sessionId !== sessionIdRef.current) {
        return;
      }
      const pendingReplay = pendingReplayRef.current;
      if (pendingReplay && pendingReplay.sessionId === evt.sessionId) {
        pendingReplay.bufferedOutput.push(evt.data);
        return;
      }
      renderedSessionIdRef.current = evt.sessionId;
      appendOutput(evt);
    });

    const offStatus = EventsOn('object-shell:status', (evt: ShellStatusEvent) => {
      if (!evt || !sessionIdRef.current || evt.sessionId !== sessionIdRef.current) {
        return;
      }
      if (evt.status === 'error') {
        pendingReplayRef.current = null;
        sessionOpenedAtRef.current = null;
        statusRef.current = 'error';
        setStatus('error');
        setStatusReason(evt.reason || 'Shell session failed.');
        sessionIdRef.current = null;
        setSession(null);
        disposeTerminal();
      } else if (evt.status === 'closed' || evt.status === 'timeout') {
        pendingReplayRef.current = null;
        const previousStatus = statusRef.current;
        const closedTooSoon =
          previousStatus === 'connecting' ||
          (previousStatus === 'open' &&
            sessionOpenedAtRef.current !== null &&
            Date.now() - sessionOpenedAtRef.current < 1500);
        sessionIdRef.current = null;
        sessionOpenedAtRef.current = null;
        setSession(null);
        disposeTerminal();
        if (statusRef.current === 'error') {
          return;
        }
        if (closedTooSoon) {
          statusRef.current = 'error';
          setStatus('error');
          setStatusReason(deriveConnectionFailureReason(evt.reason));
          return;
        }
        statusRef.current = 'closed';
        setStatus('closed');
        setStatusReason(evt.reason || 'Session closed.');
      } else if (evt.status === 'open') {
        sessionOpenedAtRef.current = Date.now();
        ensureTerminal();
        writeLine('\x1b[32mConnected\x1b[0m\r\n');
        statusRef.current = 'open';
        setStatus('open');
        setStatusReason(null);
      }
    });

    return () => {
      offOutput();
      offStatus();
    };
  }, [appendOutput, deriveConnectionFailureReason, disposeTerminal, ensureTerminal, writeLine]);

  useEffect(() => {
    if (!isActive || !terminalReady) {
      return;
    }
    terminalRef.current?.focus();
  }, [isActive, session, terminalReady]);

  const handleReconnect = useCallback(() => {
    initiateConnection();
  }, [initiateConnection]);

  const refreshContainers = useCallback(async () => {
    if (!namespace || !resourceName || !resolvedClusterId) {
      setDiscoveredContainers([]);
      return;
    }
    try {
      const result = await requestData({
        resource: 'pod-containers',
        reason: 'user',
        read: () => readPodContainers(resolvedClusterId, namespace, resourceName),
      });
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

  const attachLatestTrackedSession = useCallback(async () => {
    if (
      !namespace ||
      !resourceName ||
      !resolvedClusterId ||
      sessionIdRef.current ||
      attachInFlightRef.current
    ) {
      return;
    }
    attachInFlightRef.current = true;
    try {
      const sessions = await requestAppState({
        resource: 'shell-sessions',
        adapter: 'runtime-read',
        read: () => readShellSessions(),
      });
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
      sessionIdRef.current = latest.sessionId;
      // Reattach should not immediately send a resize event because many shells
      // redraw the prompt, which duplicates the backlog tail prompt.
      skipNextResizeRef.current = true;
      setSession({
        sessionId: latest.sessionId,
        namespace: latest.namespace,
        podName: latest.podName,
        container: latest.container,
        command: latest.command ?? [],
        containers: [],
      } as types.ShellSession);
      setContainerOverride(latest.container || null);
      setStatus('open');
      setStatusReason(null);
      ensureTerminal();
      if (renderedSessionIdRef.current === latest.sessionId && terminalRef.current) {
        pendingReplayRef.current = null;
        return;
      }
      pendingReplayRef.current = {
        sessionId: latest.sessionId,
        bufferedOutput: [],
      };
      let backlog = '';
      try {
        // Replay buffered output captured while this tab was detached.
        backlog = await requestAppState({
          resource: 'shell-session-backlog',
          adapter: 'runtime-read',
          read: () => readShellSessionBacklog(latest.sessionId),
        });
        if (backlog) {
          renderedSessionIdRef.current = latest.sessionId;
          writeToTerminal(backlog);
        }
      } catch {
        // Ignore replay failures; user can continue with live output.
      } finally {
        const replayState = pendingReplayRef.current;
        if (replayState && replayState.sessionId === latest.sessionId) {
          const bufferedOutput = replayState.bufferedOutput.join('');
          const replayRemainder = trimBacklogOverlap(backlog, bufferedOutput);
          if (replayRemainder) {
            renderedSessionIdRef.current = latest.sessionId;
            writeToTerminal(replayRemainder);
          }
          pendingReplayRef.current = null;
        }
      }
    } catch {
      // Ignore attach failures; user can still start a new session.
    } finally {
      attachInFlightRef.current = false;
    }
  }, [
    ensureTerminal,
    namespace,
    resourceName,
    resolvedClusterId,
    trimBacklogOverlap,
    writeToTerminal,
  ]);

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
      if (name) merged.add(name);
    });
    discoveredContainers.forEach((name) => {
      if (name) merged.add(name);
    });
    session?.containers?.forEach((name) => {
      if (name) merged.add(name);
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

  const shellOptions = useMemo<DropdownOption[]>(
    () => [
      { value: '/bin/sh', label: '/bin/sh' },
      { value: '/bin/bash', label: '/bin/bash' },
      { value: '__custom__', label: 'Custom...' },
    ],
    []
  );
  const debugImageOptions = useMemo<DropdownOption[]>(
    () => [
      { value: 'busybox:latest', label: 'busybox:latest' },
      { value: 'alpine:latest', label: 'alpine:latest' },
      { value: 'nicolaka/netshoot:latest', label: 'netshoot:latest' },
      { value: '__custom__', label: 'Custom...' },
    ],
    []
  );
  const resolvedDebugImage = debugImage === '__custom__' ? customImage.trim() : debugImage;

  const handleContainerChange = useCallback(
    (value: string | string[]) => {
      const nextValue = Array.isArray(value) ? value[0] : value;
      if (!nextValue) {
        setContainerOverride(null);
      } else {
        setContainerOverride(nextValue);
      }
    },
    [setContainerOverride]
  );

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

  const handleDebug = useCallback(async () => {
    if (
      !resolvedDebugImage ||
      !namespace ||
      !resourceName ||
      !resolvedClusterId ||
      debugDisabledReason ||
      disabledReason
    ) {
      return;
    }

    setDebugCreating(true);
    setStatusReason(null);
    try {
      const response = await CreateDebugContainer(resolvedClusterId, {
        namespace,
        podName: resourceName,
        image: resolvedDebugImage,
        targetContainer: debugTarget || containerOptions[0]?.value || '',
      });
      // Revert to default shell controls, target the new container, and connect.
      // The backend's CreateDebugContainer already polls until the ephemeral
      // container is Running, so we can initiate the connection immediately.
      setStartDebugContainer(false);
      setContainerOverride(response.containerName);
      void refreshContainers();
      initiateConnection();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      ensureTerminal();
      terminalRef.current?.reset();
      writeLine(`\r\n\x1b[31mFailed to create debug container: ${reason}\x1b[0m`);
      setStatus('error');
      setStatusReason(reason);
    } finally {
      setDebugCreating(false);
    }
  }, [
    containerOptions,
    debugDisabledReason,
    debugTarget,
    ensureTerminal,
    initiateConnection,
    namespace,
    resolvedClusterId,
    resolvedDebugImage,
    resourceName,
    disabledReason,
    refreshContainers,
    writeLine,
  ]);

  const hasActiveSession = status === 'open' || status === 'connecting';
  const connectionErrorMessage =
    status === 'error' ? statusReason || 'Shell session failed.' : null;
  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
    terminalRef.current?.focus();
  }, []);

  const handleTerminalContextMenu = useCallback((event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    terminalRef.current?.focus();
    setContextMenu({
      position: { x: event.clientX, y: event.clientY },
    });
  }, []);

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
        <div className="shell-tab__toolbar">
          <div className="shell-tab__controls">
            <label className="shell-tab__debug-toggle" htmlFor="shell-tab-debug-toggle">
              <input
                id="shell-tab-debug-toggle"
                type="checkbox"
                checked={startDebugContainer}
                onChange={(event) => setStartDebugContainer(event.target.checked)}
              />
              <span>Start a debug container</span>
              <Tooltip
                content={
                  <>
                    Use a debug (ephemeral) container to troubleshoot a running pod when the
                    existing containers have no shell.
                    <br />
                    <br />
                    Debug containers persist for the lifetime of the pod and cannot be removed
                    except by deleting the pod.
                  </>
                }
                placement="bottom"
              />
            </label>
            <div className="shell-tab__controls-grid">
              {startDebugContainer ? (
                <>
                  <div className="shell-tab__control-label">Debug Image</div>
                  <div className="shell-tab__control-input">
                    <Dropdown
                      options={debugImageOptions}
                      value={debugImage}
                      onChange={handleDebugImageChange}
                      size="compact"
                      dropdownClassName={shellDropdownMenuClassName}
                      placeholder="Select image"
                      ariaLabel="Debug container image"
                    />
                    {debugImage === '__custom__' && (
                      <input
                        className="shell-tab__custom-image-input"
                        type="text"
                        value={customImage}
                        onChange={(event) => setCustomImage(event.target.value)}
                        placeholder="image:tag"
                        aria-label="Custom debug image"
                      />
                    )}
                  </div>
                  <div className="shell-tab__control-label">Target Container</div>
                  <div className="shell-tab__control-input">
                    <Dropdown
                      options={containerOptions}
                      value={debugTarget || containerOptions[0]?.value || ''}
                      onChange={handleDebugTargetChange}
                      size="compact"
                      dropdownClassName={shellDropdownMenuClassName}
                      placeholder="Target container"
                      ariaLabel="Target container for process sharing"
                    />
                  </div>
                  <div className="shell-tab__control-label">Shell</div>
                  <div className="shell-tab__control-input">
                    <Dropdown
                      options={shellOptions}
                      value={commandOverride}
                      onChange={handleShellChange}
                      size="compact"
                      dropdownClassName={shellDropdownMenuClassName}
                      placeholder="Select shell"
                      ariaLabel="Shell command selector"
                    />
                    {commandOverride === '__custom__' && (
                      <input
                        className="shell-tab__custom-image-input"
                        type="text"
                        value={customShell}
                        onChange={(event) => setCustomShell(event.target.value)}
                        placeholder="/path/to/shell"
                        aria-label="Custom shell path"
                      />
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div className="shell-tab__control-label">Container</div>
                  <div className="shell-tab__control-input">
                    <Dropdown
                      options={containerOptions}
                      value={activeContainer || containerOptions[0]?.value || ''}
                      onChange={handleContainerChange}
                      size="compact"
                      dropdownClassName={shellDropdownMenuClassName}
                      placeholder="Containers unavailable"
                      ariaLabel="Shell container selector"
                    />
                  </div>
                  <div className="shell-tab__control-label">Shell</div>
                  <div className="shell-tab__control-input">
                    <Dropdown
                      options={shellOptions}
                      value={commandOverride}
                      onChange={handleShellChange}
                      size="compact"
                      dropdownClassName={shellDropdownMenuClassName}
                      placeholder="Select shell"
                      ariaLabel="Shell command selector"
                    />
                    {commandOverride === '__custom__' && (
                      <input
                        className="shell-tab__custom-image-input"
                        type="text"
                        value={customShell}
                        onChange={(event) => setCustomShell(event.target.value)}
                        placeholder="/path/to/shell"
                        aria-label="Custom shell path"
                      />
                    )}
                  </div>
                </>
              )}
            </div>
            <button
              type="button"
              className={`button generic ${
                startDebugContainer ? 'shell-tab__debug-button' : 'shell-tab__button'
              }`}
              onClick={startDebugContainer ? handleDebug : handleReconnect}
              disabled={
                startDebugContainer
                  ? debugCreating ||
                    !resolvedDebugImage ||
                    !!debugDisabledReason ||
                    !!disabledReason
                  : false
              }
            >
              {startDebugContainer ? (debugCreating ? 'Creating...' : 'Start') : 'Connect'}
            </button>
          </div>
        </div>
      )}
      {startDebugContainer && !hasActiveSession && debugDisabledReason && (
        <div className="shell-tab__debug-warning">
          <>
            Debug unavailable: <span>{debugDisabledReason}</span>
          </>
        </div>
      )}
      {connectionErrorMessage && (
        <div className="shell-tab__connection-error" role="status" aria-live="polite">
          Connection failed: <span>{connectionErrorMessage}</span>
        </div>
      )}

      {disabledReason && (
        <div className="shell-tab__notice">
          Shell access blocked: <span>{disabledReason}</span>
        </div>
      )}

      <div
        className="shell-tab__terminal-wrapper"
        data-tab-native="true"
        onClick={() => terminalRef.current?.focus()}
        onContextMenu={handleTerminalContextMenu}
        onPointerLeave={handleShellScrollbarPointerLeave}
        onPointerMove={handleShellScrollbarPointerMove}
        onWheel={showShellScrollbar}
      >
        <div
          className={`shell-tab__terminal${terminalReady ? '' : ' shell-tab__terminal--hidden'}`}
          ref={terminalContainerRef}
          aria-label="Shell terminal"
          data-tab-native="true"
        />
        {shellScrollbarElement}
      </div>
      {contextMenu && (
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
