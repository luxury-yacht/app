/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Shell/ShellTab.tsx
 *
 * UI component for ShellTab.
 * Handles rendering and interactions for the object panel feature.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { ClipboardAddon } from '@xterm/addon-clipboard';
import '@xterm/xterm/css/xterm.css';
import { EventsOn } from '@wailsjs/runtime/runtime';
import {
  CloseShellSession,
  CreateDebugContainer,
  GetPodContainers,
  GetShellSessionBacklog,
  ListShellSessions,
  ResizeShellSession,
  SendShellInput,
  StartShellSession,
} from '@wailsjs/go/backend/App';
import { types } from '@wailsjs/go/models';
import { Dropdown } from '@shared/components/dropdowns/Dropdown';
import type { DropdownOption } from '@shared/components/dropdowns/Dropdown';
import { useDockablePanelState } from '@/components/dockable';
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
  const [debugImage, setDebugImage] = useState('busybox:latest');
  const [customImage, setCustomImage] = useState('');
  const [debugTarget, setDebugTarget] = useState<string | null>(null);
  const [debugCreating, setDebugCreating] = useState(false);
  const [discoveredContainers, setDiscoveredContainers] = useState<string[]>([]);
  const [reconnectToken, setReconnectToken] = useState(0);
  const [statusReason, setStatusReason] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const statusRef = useRef<ShellStatus>('idle');
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const terminalContainerRef = useRef<HTMLDivElement | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const terminalDataDisposableRef = useRef<{ dispose: () => void } | null>(null);
  const pendingReplayRef = useRef<PendingReplayState | null>(null);
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

  const disposeTerminal = useCallback(() => {
    terminalDataDisposableRef.current?.dispose();
    terminalDataDisposableRef.current = null;
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = null;
    terminalRef.current?.dispose();
    terminalRef.current = null;
    fitAddonRef.current = null;
    if (terminalContainerRef.current) {
      terminalContainerRef.current.innerHTML = '';
    }
    renderedSessionIdRef.current = null;
    skipNextResizeRef.current = false;
    setTerminalReady(false);
  }, []);

  const resolveThemeColors = useCallback(() => {
    const container = terminalContainerRef.current;
    if (!container) {
      return {
        background: '#060b18',
        foreground: '#e2e8f0',
        cursor: '#22d3ee',
        selectionBackground: '#1d4ed844',
        scrollbarSlider: '#64748b66',
        scrollbarSliderHover: '#64748b99',
        scrollbarSliderActive: '#64748bcc',
        scrollbarWidth: 6,
        overviewRulerBorder: 'transparent',
      };
    }
    const styles = getComputedStyle(container);
    const rawScrollbarWidth = Number.parseInt(
      styles.getPropertyValue('--scrollbar-width').trim(),
      10
    );
    const scrollbarWidth = Number.isFinite(rawScrollbarWidth) ? rawScrollbarWidth : 6;
    return {
      background: styles.getPropertyValue('--shell-terminal-bg').trim() || '#060b18',
      foreground: styles.getPropertyValue('--shell-terminal-fg').trim() || '#e2e8f0',
      cursor: styles.getPropertyValue('--shell-terminal-cursor').trim() || '#22d3ee',
      selectionBackground:
        styles.getPropertyValue('--shell-terminal-selection').trim() || '#1d4ed844',
      scrollbarSlider: styles.getPropertyValue('--scrollbar-thumb-bg').trim() || '#64748b66',
      scrollbarSliderHover:
        styles.getPropertyValue('--scrollbar-thumb-hover-bg').trim() || '#64748b99',
      scrollbarSliderActive:
        styles.getPropertyValue('--scrollbar-thumb-hover-bg').trim() || '#64748bcc',
      scrollbarWidth,
      overviewRulerBorder: 'transparent',
    };
  }, []);

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
      theme: {
        background: theme.background,
        foreground: theme.foreground,
        cursor: theme.cursor,
        selectionBackground: theme.selectionBackground,
        scrollbarSliderBackground: theme.scrollbarSlider,
        scrollbarSliderHoverBackground: theme.scrollbarSliderHover,
        scrollbarSliderActiveBackground: theme.scrollbarSliderActive,
        overviewRulerBorder: theme.overviewRulerBorder,
      },
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
        const selection = terminal.getSelection();
        if (!selection) {
          return true;
        }
        void clipboard.writeText(selection).catch(() => {
          /* ignore clipboard write failures */
        });
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
        void clipboard
          .readText()
          .then((text) => {
            terminal.paste(text ?? '');
          })
          .catch(() => {
            /* ignore clipboard read failures */
          });
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

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
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
    setTerminalReady(true);
  }, [resolveThemeColors]);

  useEffect(() => {
    return () => {
      disposeTerminal();
    };
  }, [disposeTerminal]);

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
      writeToTerminal(entry.data);
    },
    [writeToTerminal]
  );

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
    setStatusReason(null);
    ensureTerminal();
    terminalRef.current?.reset();
    writeLine('\r\n\x1b[90mConnecting...\x1b[0m');
    setStatus('connecting');
    setReconnectToken((token) => token + 1);
  }, [ensureTerminal, writeLine]);

  const lastTargetRef = useRef<{ namespace: string; resourceName: string } | null>(null);

  useEffect(() => {
    if (!namespace || !resourceName) {
      lastTargetRef.current = null;
      pendingReplayRef.current = null;
      sessionIdRef.current = null;
      setSession(null);
      setStatus('idle');
      setStatusReason(null);
      disposeTerminal();
      return;
    }
    const previous = lastTargetRef.current;
    if (previous && (previous.namespace !== namespace || previous.resourceName !== resourceName)) {
      pendingReplayRef.current = null;
      sessionIdRef.current = null;
      setSession(null);
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
          command: commandOverride ? [commandOverride] : undefined,
        });
        if (cancelled) {
          // If a superseding connect was started before this one returned, clean up this session.
          await CloseShellSession(shellSession.sessionId);
          return;
        }
        sessionIdRef.current = shellSession.sessionId;
        setSession(shellSession);
        setStatus('open');
        setStatusReason(null);
      } catch (error) {
        if (!cancelled) {
          const reason = error instanceof Error ? error.message : String(error);
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
    commandOverride,
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
        setStatus('error');
        setStatusReason(evt.reason || 'Shell session failed.');
        sessionIdRef.current = null;
        setSession(null);
        disposeTerminal();
      } else if (evt.status === 'closed' || evt.status === 'timeout') {
        pendingReplayRef.current = null;
        setStatus('closed');
        setStatusReason(evt.reason || 'Session closed.');
        sessionIdRef.current = null;
        setSession(null);
        disposeTerminal();
      } else if (evt.status === 'open') {
        ensureTerminal();
        writeLine('\x1b[32mConnected\x1b[0m\r\n');
        setStatus('open');
        setStatusReason(null);
      }
    });

    return () => {
      offOutput();
      offStatus();
    };
  }, [appendOutput, disposeTerminal, ensureTerminal, writeLine]);

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
      const containerNames = await GetPodContainers(resolvedClusterId, namespace, resourceName);
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
      const sessions = await ListShellSessions();
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
        backlog = await GetShellSessionBacklog(latest.sessionId);
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
      setStartDebugContainer(false);
      setContainerOverride(response.containerName);
      void refreshContainers();
      setTimeout(() => {
        initiateConnection();
      }, 100);
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
            </label>
            <div className="shell-tab__controls-grid">
              {startDebugContainer ? (
                <>
                  <div className="shell-tab__control-label">Debug Image:</div>
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
                  <div className="shell-tab__control-label">Target Container:</div>
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
                  <div className="shell-tab__control-label">Shell:</div>
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
                  </div>
                </>
              ) : (
                <>
                  <div className="shell-tab__control-label">Container:</div>
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
                  <div className="shell-tab__control-label">Shell:</div>
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

      <div className="shell-tab__terminal-wrapper" onClick={() => terminalRef.current?.focus()}>
        <div
          className={`shell-tab__terminal${terminalReady ? '' : ' shell-tab__terminal--hidden'}`}
          ref={terminalContainerRef}
          aria-label="Shell terminal"
        />
      </div>
    </div>
  );
};

export default ShellTab;
