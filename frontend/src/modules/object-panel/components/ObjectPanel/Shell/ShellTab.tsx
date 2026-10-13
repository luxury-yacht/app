/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Shell/ShellTab.tsx
 */

import * as XtermClipboard from '@xterm/addon-clipboard';
import * as XtermFit from '@xterm/addon-fit';
import * as Xterm from '@xterm/xterm';
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type WheelEvent,
} from 'react';
import {
  readShellSessionBacklog,
  readShellSessions,
  requestAppState,
} from '@/core/app-state-access';
import { readPodContainers, requestData } from '@/core/data-access';
import '@xterm/xterm/css/xterm.css';
import { types } from '@core/backend-api/models';
import {
  type DesktopEventPayload,
  onEvent,
  readClipboardText,
  writeClipboardText,
} from '@core/desktop-runtime';
import type { ResourceRef } from '@core/refresh/types';
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
import { buildCanonicalObjectRowKey } from '@shared/utils/objectIdentity';
import { useKeyboardSurface } from '@ui/shortcuts';
import { errorHandler } from '@utils/errorHandler';
import {
  CloseShellSession,
  ResizeShellSession,
  SendShellInput,
  StartNodeShellSession,
  StartShellSession,
} from '@/core/backend-api';
import NodeShellControls from './NodeShellControls';
import { isNodeShellTarget } from './nodeShell';
import ShellConnectionControls from './ShellConnectionControls';
import { CUSTOM_OPTION_VALUE } from './ShellControlFields';
import ShellSessionBar from './ShellSessionBar';
import './ShellTab.css';

// Complete identity of the object: a Pod to exec into, or a Node for a node shell.
type ShellTargetRef = ResourceRef & { name: string };

interface ShellTabProps {
  target: ShellTargetRef;
  disabledReason?: string;
  debugDisabledReason?: string;
  isActive: boolean;
  availableContainers: string[];
}

interface ShellStartOptions {
  container?: string;
  command?: string[];
  image: string;
}

// What differs between execing into a pod and a node shell, which starts
// kubectl's node debug pod and attaches to it.
interface ShellKind {
  start: (ref: ShellTargetRef, options: ShellStartOptions) => Promise<types.ShellSession | null>;
  startAction: string;
  listsContainers: boolean;
  announceStart: (ref: ShellTargetRef, writeLine: (text: string) => void) => void;
  announceOpen: (writeLine: (text: string) => void) => void;
}

const POD_SHELL: ShellKind = {
  start: (ref, { container, command }) => StartShellSession({ target: ref, container, command }),
  startAction: 'startShellSession',
  listsContainers: true,
  announceStart: () => undefined,
  announceOpen: () => undefined,
};

const NODE_SHELL: ShellKind = {
  start: (ref, { image, command }) => StartNodeShellSession({ target: ref, image, command }),
  startAction: 'startNodeShellSession',
  // The debug pod has a single container.
  listsContainers: false,
  announceStart: (ref, writeLine) =>
    writeLine(`\x1b[90mStarting a debug pod on node ${ref.name}...\x1b[0m`),
  // Attaching joins a shell that already printed its prompt, as with kubectl.
  announceOpen: (writeLine) => writeLine("If you don't see a command prompt, try pressing enter."),
};

// The tab's target. Async work compares the stored object by identity to tell
// whether the tab moved to another target meanwhile.
interface ShellTarget {
  key: string;
  ref: ShellTargetRef;
  kind: ShellKind;
}

// Canonical key of a complete shell target, or null while its identity is
// incomplete (a Pod also needs its namespace).
const completeShellTargetKey = (target: ShellTargetRef): string | null => {
  const namespaceMissing = !isNodeShellTarget(target) && !target.namespace?.trim();
  if (!target.clusterId?.trim() || !target.name?.trim() || namespaceMissing) {
    return null;
  }
  return buildCanonicalObjectRowKey(target);
};

type ShellStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

type ShellOutputEvent = DesktopEventPayload<'object-shell:output'>;
type ShellStatusEvent = DesktopEventPayload<'object-shell:status'>;

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
  start: () => Promise<types.ShellSession | null>,
  isCancelled: () => boolean
): Promise<types.ShellSession | null> {
  const session = await start();
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
    buildObjectActionTarget(target.ref, 'create debug container for'),
    options
  );
  const debugContainer = response.debugContainer as types.DebugContainerResponse | undefined;
  if (!debugContainer) {
    throw new Error('Backend did not return debug container details');
  }
  return debugContainer;
}

type TrackedShellSession = Awaited<ReturnType<typeof readShellSessions>>[number];

// A node shell whose stream ended but whose debug pod could not be deleted.
interface CleanupFailure {
  sessionId: string;
  reason: string;
}

const isKeptForCleanup = (session: TrackedShellSession): boolean =>
  session.status === types.ShellSessionStatus.ShellSessionStatusCleanupFailed;

// The newest open session for the target, and any session kept only because
// its debug pod still needs deleting; a kept session has no stream to attach.
function findTrackedSessions(sessions: TrackedShellSession[], targetKey: string) {
  const matching = sessions.filter(
    (tracked) => buildCanonicalObjectRowKey(tracked.target) === targetKey
  );
  const open = matching.filter((tracked) => !isKeptForCleanup(tracked));
  return { latestOpen: open[open.length - 1], kept: matching.find(isKeptForCleanup) };
}

const isSessionEnd = (status: types.ShellSessionStatus): boolean =>
  status === types.ShellSessionStatus.ShellSessionStatusEnded ||
  status === types.ShellSessionStatus.ShellSessionStatusClosed;

function attachedShellSession(session: TrackedShellSession): types.ShellSession {
  return {
    sessionId: session.sessionId,
    target: session.target,
    debugPod: session.debugPod,
    container: session.container,
    command: session.command ?? [],
    containers: [],
  } as types.ShellSession;
}

// Names the debug pod a node shell could not delete; retrying happens from the
// Sessions list, which keeps the session until the pod is gone.
function ShellCleanupNotice({ failure }: Readonly<{ failure: CleanupFailure | null }>) {
  if (!failure) {
    return null;
  }
  return (
    <output className="shell-tab__notice shell-tab__cleanup-failure">
      Cleanup failed: <span>{failure.reason}</span>. End the session in the Sessions list to retry.
    </output>
  );
}

const resolveCustomOption = (selected: string, custom: string): string =>
  selected === CUSTOM_OPTION_VALUE ? custom.trim() : selected;

// A close while connecting or right after opening usually means the shell never started.
const isPrematureClose = (status: ShellStatus, openedAt: number | null): boolean =>
  status === 'connecting' ||
  (status === 'open' && openedAt !== null && Date.now() - openedAt < 1500);

function handleShellClipboardKey(
  event: KeyboardEvent,
  terminal: Xterm.Terminal,
  copySelection: () => boolean,
  pasteClipboard: () => Promise<boolean>
): boolean {
  if (event.type !== 'keydown' || !(event.ctrlKey || event.metaKey)) {
    return true;
  }
  const key = event.key.toLowerCase();
  if (key === 'c' && terminal.hasSelection() && copySelection()) {
    event.preventDefault();
    event.stopPropagation();
    return false;
  }
  if (key === 'v') {
    event.preventDefault();
    event.stopPropagation();
    void pasteClipboard();
    return false;
  }
  return true;
}

const ShellTab: React.FC<ShellTabProps> = ({
  target: targetRef,
  isActive,
  disabledReason,
  debugDisabledReason,
  availableContainers,
}) => {
  const [session, setSession] = useState<types.ShellSession | null>(null);
  const [startDebugContainer, setStartDebugContainer] = useState(false);
  const [status, setStatus] = useState<ShellStatus>('idle');
  const [containerOverride, setContainerOverride] = useState<string | null>(null);
  const [commandOverride, setCommandOverride] = useState<string>('/bin/sh');
  const [customShell, setCustomShell] = useState('');
  const resolvedShell = resolveCustomOption(commandOverride, customShell);
  const [debugImage, setDebugImage] = useState('busybox:latest');
  const [customImage, setCustomImage] = useState('');
  const resolvedDebugImage = resolveCustomOption(debugImage, customImage);
  const [debugTarget, setDebugTarget] = useState<string | null>(null);
  const [debugCreating, setDebugCreating] = useState(false);
  const [discoveredContainers, setDiscoveredContainers] = useState<string[]>([]);
  const [reconnectToken, setReconnectToken] = useState(0);
  const [statusReason, setStatusReason] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ShellContextMenuState | null>(null);
  const [endingSession, setEndingSession] = useState(false);
  const [cleanupFailure, setCleanupFailure] = useState<CleanupFailure | null>(null);
  // Shows the kept-debug-pod notice for this tab's session, and clears it when
  // a retry from any window deletes the pod and ends that session.
  const trackCleanupFailure = useCallback((evt: ShellStatusEvent | undefined) => {
    if (!evt) {
      return;
    }
    if (
      evt.status === types.ShellSessionStatus.ShellSessionStatusCleanupFailed &&
      evt.sessionId === sessionIdRef.current
    ) {
      setCleanupFailure({ sessionId: evt.sessionId, reason: evt.reason ?? '' });
    } else if (isSessionEnd(evt.status)) {
      setCleanupFailure((current) => (current?.sessionId === evt.sessionId ? null : current));
    }
  }, []);
  const showKeptSession = useCallback((kept: TrackedShellSession | undefined) => {
    setCleanupFailure(kept ? { sessionId: kept.sessionId, reason: kept.statusReason ?? '' } : null);
  }, []);
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
  const targetKey = completeShellTargetKey(targetRef);
  const isNodeShell = isNodeShellTarget(targetRef);
  const resolvedClusterId = targetRef.clusterId.trim();
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
    try {
      const text = await readClipboardText();
      pasteTextToTerminal(text ?? '');
      return true;
    } catch {
      return false;
    }
  }, [pasteTextToTerminal]);

  const copyTerminalSelection = useCallback(() => {
    const terminal = terminalRef.current;
    if (!terminal?.hasSelection()) {
      return false;
    }

    const selection = terminal.getSelection();
    if (!selection) {
      return false;
    }

    void writeClipboardText(selection).catch(() => {
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
    if (!terminalReady || !isActive) {
      return;
    }
    terminalRef.current?.focus();
  }, [terminalReady, isActive]);

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
    setCleanupFailure(null);
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
    setCleanupFailure(null);
    disposeTerminal();
  }, [disposeTerminal, setConnectionStatus]);

  // Reads the latest target without re-running the switch on every parent render.
  const adoptTarget = useEffectEvent((key: string) => {
    const kind = isNodeShellTarget(targetRef) ? NODE_SHELL : POD_SHELL;
    lastTargetRef.current = { key, ref: targetRef, kind };
  });

  useEffect(() => {
    if (!targetKey) {
      lastTargetRef.current = null;
      resetTargetSession();
      return;
    }
    const previous = lastTargetRef.current;
    if (previous?.key === targetKey) {
      return;
    }
    if (previous) {
      resetTargetSession();
    }
    adoptTarget(targetKey);
  }, [resetTargetSession, targetKey]);

  useEffect(() => {
    void reconnectToken;
    const shellTarget = lastTargetRef.current;
    if (!isActive || statusRef.current !== 'connecting' || shellTarget?.key !== targetKey) {
      return;
    }

    let cancelled = false;
    const options: ShellStartOptions = {
      container: containerOverride ?? undefined,
      command: resolvedShell ? [resolvedShell] : undefined,
      image: resolvedDebugImage,
    };
    shellTarget.kind.announceStart(shellTarget.ref, writeLine);
    const start = async () => {
      try {
        const shellSession = await startTrackedShellSession(
          () => shellTarget.kind.start(shellTarget.ref, options),
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
        shellTarget.kind.announceOpen(writeLine);
      } catch (error) {
        if (cancelled) {
          return;
        }
        const details = errorHandler.handleInline(error, {
          action: shellTarget.kind.startAction,
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
    resolvedDebugImage,
    containerOverride,
    clearSession,
    setConnectionStatus,
    disposeTerminal,
    isActive,
    targetKey,
    resolvedClusterId,
    reconnectToken,
    writeLine,
  ]);

  const handleSessionClosed = useCallback(
    (reason?: string, endedByUser = false) => {
      pendingReplayRef.current = null;
      const closedTooSoon =
        !endedByUser && isPrematureClose(statusRef.current, sessionOpenedAtRef.current);
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
      trackCleanupFailure(evt);
      if (!evt || !sessionIdRef.current || evt.sessionId !== sessionIdRef.current) {
        return;
      }
      switch (evt.status) {
        case types.ShellSessionStatus.ShellSessionStatusError: {
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
        case types.ShellSessionStatus.ShellSessionStatusEnded:
        case types.ShellSessionStatus.ShellSessionStatusCleanupFailed:
          // A user ended it, from this tab or any other window, or the shell ended and
          // only its debug pod's delete failed; never a failed connection.
          handleSessionClosed(evt.reason, true);
          return;
        case types.ShellSessionStatus.ShellSessionStatusClosed:
        case types.ShellSessionStatus.ShellSessionStatusTimeout:
          handleSessionClosed(evt.reason);
          return;
        case types.ShellSessionStatus.ShellSessionStatusOpen:
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
    trackCleanupFailure,
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

  const handleStartNodeShell = useCallback(() => {
    if (!resolvedDebugImage || disabledReason) {
      return;
    }
    initiateConnection();
  }, [disabledReason, initiateConnection, resolvedDebugImage]);

  // The backend publishes the ended status; a failed request leaves the session attached.
  const handleEndSession = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) {
      return;
    }
    setEndingSession(true);
    try {
      await CloseShellSession(sessionId);
    } catch (error) {
      errorHandler.handle(error, { action: 'closeShellSession', sessionId, source: 'ShellTab' });
    } finally {
      setEndingSession(false);
    }
  }, []);

  const refreshContainers = useCallback(async () => {
    const shellTarget = lastTargetRef.current;
    if (shellTarget?.key !== targetKey || !shellTarget.kind.listsContainers) {
      setDiscoveredContainers([]);
      return;
    }
    try {
      const result = await requestData({
        resource: 'pod-containers',
        reason: 'user',
        read: () => readPodContainers(shellTarget.ref),
      });
      if (lastTargetRef.current !== shellTarget) {
        return;
      }
      const containers = result.status === 'executed' ? (result.data ?? []) : [];
      // Init containers are not valid exec targets.
      const execTargets = containers
        .filter((podContainer) => !podContainer.isInit)
        .map((podContainer) => podContainer.name);
      setDiscoveredContainers(Array.from(new Set(execTargets)));
    } catch {
      // Keep existing fallback list from details/session if fetch fails.
    }
  }, [targetKey]);

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
    if (target?.key !== targetKey || sessionIdRef.current || attachInFlightRef.current === target) {
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
      const { latestOpen, kept } = findTrackedSessions(sessions, target.key);
      if (!latestOpen) {
        showKeptSession(kept);
        return;
      }
      installTrackedSession(latestOpen);
      await replaySessionOutput(latestOpen.sessionId);
    } catch {
      // Ignore attach failures; user can still start a new session.
    } finally {
      if (attachInFlightRef.current === target) {
        attachInFlightRef.current = null;
      }
    }
  }, [installTrackedSession, replaySessionOutput, showKeptSession, targetKey]);

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

  const connectionControls = isNodeShell ? (
    <NodeShellControls
      debugImage={debugImage}
      handleDebugImageChange={handleDebugImageChange}
      customImage={customImage}
      setCustomImage={setCustomImage}
      commandOverride={commandOverride}
      handleShellChange={handleShellChange}
      customShell={customShell}
      setCustomShell={setCustomShell}
      onStart={handleStartNodeShell}
      resolvedDebugImage={resolvedDebugImage}
      disabledReason={disabledReason}
    />
  ) : (
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
  );

  return (
    <div className="object-panel-shell-tab">
      {hasActiveSession ? (
        <ShellSessionBar
          session={session}
          container={activeContainer}
          fallbackShell={resolvedShell}
          ending={endingSession}
          onEnd={handleEndSession}
        />
      ) : (
        connectionControls
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
      <ShellCleanupNotice failure={cleanupFailure} />

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
