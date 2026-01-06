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

const ShellTab: React.FC<ShellTabProps> = ({
  namespace,
  resourceName,
  isActive,
  disabledReason,
  availableContainers,
  clusterId,
}) => {
  const panelState = useDockablePanelState('object-panel');
  const [session, setSession] = useState<types.ShellSession | null>(null);
  const [status, setStatus] = useState<ShellStatus>('idle');
  const [containerOverride, setContainerOverride] = useState<string | null>(null);
  const [commandOverride, setCommandOverride] = useState<string>('/bin/sh');
  const [reconnectToken, setReconnectToken] = useState(0);
  const [statusReason, setStatusReason] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const statusRef = useRef<ShellStatus>('idle');
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const terminalContainerRef = useRef<HTMLDivElement | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const terminalDataDisposableRef = useRef<{ dispose: () => void } | null>(null);
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
      };
    }
    const styles = getComputedStyle(container);
    return {
      background: styles.getPropertyValue('--shell-terminal-bg').trim() || '#060b18',
      foreground: styles.getPropertyValue('--shell-terminal-fg').trim() || '#e2e8f0',
      cursor: styles.getPropertyValue('--shell-terminal-cursor').trim() || '#22d3ee',
      selectionBackground:
        styles.getPropertyValue('--shell-terminal-selection').trim() || '#1d4ed844',
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
      theme: {
        background: theme.background,
        foreground: theme.foreground,
        cursor: theme.cursor,
        selectionBackground: theme.selectionBackground,
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

  const cleanupSession = useCallback((sessionId: string | null) => {
    if (!sessionId) {
      return;
    }
    void CloseShellSession(sessionId).catch(() => {
      /* ignore */
    });
  }, []);

  const initiateConnection = useCallback(() => {
    setStatusReason(null);
    ensureTerminal();
    terminalRef.current?.reset();
    writeLine('\r\n\x1b[90mConnecting...\x1b[0m');
    setStatus('connecting');
    setReconnectToken((token) => token + 1);
  }, [ensureTerminal, writeLine]);

  useEffect(() => {
    return () => {
      const current = sessionIdRef.current;
      sessionIdRef.current = null;
      if (current) {
        cleanupSession(current);
      }
    };
  }, [cleanupSession]);

  const lastTargetRef = useRef<{ namespace: string; resourceName: string } | null>(null);

  useEffect(() => {
    if (!namespace || !resourceName) {
      lastTargetRef.current = null;
      const current = sessionIdRef.current;
      sessionIdRef.current = null;
      if (current) {
        cleanupSession(current);
      }
      setSession(null);
      setStatus('idle');
      setStatusReason(null);
      disposeTerminal();
      return;
    }
    const previous = lastTargetRef.current;
    if (previous && (previous.namespace !== namespace || previous.resourceName !== resourceName)) {
      const current = sessionIdRef.current;
      sessionIdRef.current = null;
      if (current) {
        cleanupSession(current);
      }
      setSession(null);
      setStatus('idle');
      setStatusReason(null);
      disposeTerminal();
    }
    lastTargetRef.current = { namespace, resourceName };
  }, [cleanupSession, disposeTerminal, namespace, resourceName]);

  useEffect(() => {
    if (!isActive || statusRef.current !== 'connecting' || !namespace || !resourceName) {
      return;
    }

    let cancelled = false;
    let activeSessionId: string | null = null;
    const bindSessionId = (incomingId?: string | null): boolean => {
      if (!incomingId) {
        return false;
      }
      if (!sessionIdRef.current && statusRef.current === 'connecting') {
        sessionIdRef.current = incomingId;
      }
      if (!activeSessionId && sessionIdRef.current === incomingId) {
        activeSessionId = incomingId;
      }
      return sessionIdRef.current === incomingId;
    };

    const start = async () => {
      try {
        const shellSession = await StartShellSession(resolvedClusterId, {
          namespace,
          podName: resourceName,
          container: containerOverride ?? undefined,
          command: commandOverride ? [commandOverride] : undefined,
        });
        if (cancelled) {
          await CloseShellSession(shellSession.sessionId);
          return;
        }
        activeSessionId = shellSession.sessionId;
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

    start();

    const offOutput = EventsOn('object-shell:output', (evt: ShellOutputEvent) => {
      if (!evt || !bindSessionId(evt.sessionId)) {
        return;
      }
      appendOutput(evt);
    });

    const offStatus = EventsOn('object-shell:status', (evt: ShellStatusEvent) => {
      if (!evt || !bindSessionId(evt.sessionId)) {
        return;
      }
      if (evt.status === 'error') {
        setStatus('error');
        setStatusReason(evt.reason || 'Shell session failed.');
        disposeTerminal();
      } else if (evt.status === 'closed') {
        setStatus('closed');
        setStatusReason(evt.reason || 'Session closed.');
        disposeTerminal();
      } else if (evt.status === 'open') {
        writeLine('\x1b[32mConnected\x1b[0m\r\n');
        setStatus('open');
        setStatusReason(null);
      }
    });

    return () => {
      cancelled = true;
      offOutput();
      offStatus();
      sessionIdRef.current = null;
      cleanupSession(activeSessionId);
    };
  }, [
    appendOutput,
    cleanupSession,
    disposeTerminal,
    commandOverride,
    containerOverride,
    isActive,
    namespace,
    reconnectToken,
    resourceName,
    resolvedClusterId,
    writeLine,
  ]);

  useEffect(() => {
    if (!isActive || !terminalReady) {
      return;
    }
    terminalRef.current?.focus();
  }, [isActive, session, terminalReady]);

  const handleReconnect = useCallback(() => {
    initiateConnection();
  }, [initiateConnection]);

  const handleDisconnect = useCallback(() => {
    if (!sessionIdRef.current) {
      return;
    }
    const currentId = sessionIdRef.current;
    sessionIdRef.current = null;
    cleanupSession(currentId);
    setSession(null);
    setStatus('closed');
    setStatusReason('Disconnected by user.');
    disposeTerminal();
  }, [cleanupSession, disposeTerminal]);

  const containerOptions = useMemo<DropdownOption[]>(() => {
    const merged = new Set<string>();
    availableContainers.forEach((name) => {
      if (name) merged.add(name);
    });
    session?.containers?.forEach((name) => {
      if (name) merged.add(name);
    });
    return Array.from(merged).map((name) => ({ value: name, label: name }));
  }, [availableContainers, session?.containers]);

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

  const placeholderMessage = useMemo(() => {
    if (status === 'error') {
      return (
        statusReason || 'Shell session failed. Adjust the settings and press Connect to retry.'
      );
    }
    if (status === 'closed') {
      return statusReason || 'Shell session closed. Press Connect to start a new session.';
    }
    return 'Select a container and shell, then press Connect to start a session.';
  }, [status, statusReason]);

  const overridesDisabled = status === 'open';

  return (
    <div className="object-panel-shell-tab">
      <div className="shell-tab__toolbar">
        <div className="shell-tab__controls">
          <Dropdown
            options={containerOptions}
            value={activeContainer || containerOptions[0]?.value || ''}
            onChange={handleContainerChange}
            disabled={overridesDisabled}
            size="compact"
            placeholder="Containers unavailable"
            ariaLabel="Shell container selector"
          />
          <Dropdown
            options={shellOptions}
            value={commandOverride}
            onChange={handleShellChange}
            disabled={overridesDisabled}
            size="compact"
            placeholder="Select shell"
            ariaLabel="Shell command selector"
          />
          <button
            type="button"
            className="button generic shell-tab__button"
            onClick={status === 'open' ? handleDisconnect : handleReconnect}
          >
            {status === 'open' ? 'Disconnect' : 'Connect'}
          </button>
        </div>
      </div>

      {disabledReason && (
        <div className="shell-tab__notice">
          Shell access blocked: <span>{disabledReason}</span>
        </div>
      )}

      <div className="shell-tab__terminal-wrapper" onClick={() => terminalRef.current?.focus()}>
        {!terminalReady && (
          <div className="shell-tab__terminal-placeholder" aria-live="polite">
            {placeholderMessage}
          </div>
        )}
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
