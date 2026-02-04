/**
 * frontend/src/modules/port-forward/PortForwardsPanel.tsx
 *
 * Dockable panel component for managing active port forward sessions.
 * Displays all active, reconnecting, and errored port forwards with controls
 * to stop/remove them.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ListPortForwards, StopPortForward } from '@wailsjs/go/backend/App';
import { EventsOn, EventsOff, BrowserOpenURL } from '@wailsjs/runtime/runtime';
import { DockablePanel, useDockablePanelState } from '@/components/dockable';
import { errorHandler } from '@utils/errorHandler';
import './PortForwardsPanel.css';

/**
 * Represents a port forward session.
 * Mirrors the backend PortForwardSession struct.
 */
interface PortForwardSession {
  id: string;
  clusterId: string;
  clusterName: string;
  namespace: string;
  podName: string;
  containerPort: number;
  localPort: number;
  targetKind: string;
  targetName: string;
  status: string;
  statusReason?: string;
  startedAt: string;
}

/**
 * Status update event payload from the backend.
 */
interface PortForwardStatusEvent {
  sessionId: string;
  status: string;
  statusReason?: string;
  localPort?: number;
  podName?: string;
}

/**
 * Hook to access the port forwards panel state.
 * Use this from other components to open/close the panel.
 */
export function usePortForwardsPanel() {
  return useDockablePanelState('port-forwards');
}

/**
 * Status priority for sorting sessions (lower = higher priority = displayed first)
 */
function getStatusPriority(status: string): number {
  switch (status) {
    case 'active':
      return 0;
    case 'reconnecting':
      return 1;
    case 'error':
      return 2;
    case 'stopped':
      return 3;
    default:
      return 4;
  }
}

/**
 * Panel component for managing port forward sessions.
 * Displays sessions grouped by status with controls to stop/remove them.
 */
function PortForwardsPanel() {
  const panelState = usePortForwardsPanel();
  // All port forward sessions
  const [sessions, setSessions] = useState<PortForwardSession[]>([]);
  // Set of session IDs currently being stopped (for button loading state)
  const [stoppingIds, setStoppingIds] = useState<Set<string>>(new Set());
  // Track previous session count for auto-open logic
  const prevSessionCountRef = useRef(0);

  /**
   * Load the initial list of port forward sessions from the backend.
   */
  const loadSessions = useCallback(async () => {
    try {
      const sessionList = await ListPortForwards();
      setSessions(sessionList || []);
    } catch (err) {
      errorHandler.handle(err, { action: 'loadPortForwards' });
    }
  }, []);

  /**
   * Stop a port forward session.
   */
  const handleStop = useCallback(async (sessionId: string) => {
    setStoppingIds((prev) => new Set(prev).add(sessionId));
    try {
      await StopPortForward(sessionId);
      // The session will be removed from the list via the portforward:list event
    } catch (err) {
      errorHandler.handle(err, {
        action: 'stopPortForward',
        sessionId,
      });
    } finally {
      setStoppingIds((prev) => {
        const next = new Set(prev);
        next.delete(sessionId);
        return next;
      });
    }
  }, []);

  // Load sessions when panel opens
  useEffect(() => {
    if (!panelState.isOpen) {
      return;
    }

    loadSessions();
  }, [panelState.isOpen, loadSessions]);

  // Subscribe to backend events for session updates
  useEffect(() => {
    /**
     * Handler for full session list updates.
     * Called when sessions are added or removed.
     */
    const handleListUpdate = (sessionList: PortForwardSession[]) => {
      setSessions(sessionList || []);
    };

    /**
     * Handler for individual session status updates.
     * Updates the status of a single session in place.
     */
    const handleStatusUpdate = (event: PortForwardStatusEvent) => {
      setSessions((prev) =>
        prev.map((session) =>
          session.id === event.sessionId
            ? {
                ...session,
                status: event.status,
                statusReason: event.statusReason,
                // Update localPort and podName if provided (e.g., after reconnect)
                ...(event.localPort !== undefined && { localPort: event.localPort }),
                ...(event.podName !== undefined && { podName: event.podName }),
              }
            : session
        )
      );
    };

    // Register event listeners
    EventsOn('portforward:list', handleListUpdate);
    EventsOn('portforward:status', handleStatusUpdate);

    return () => {
      EventsOff('portforward:list');
      EventsOff('portforward:status');
    };
  }, []);

  // Auto-open panel when first forward starts
  useEffect(() => {
    const currentCount = sessions.length;
    const prevCount = prevSessionCountRef.current;

    // Open panel when transitioning from 0 to 1+ sessions
    if (prevCount === 0 && currentCount > 0 && !panelState.isOpen) {
      panelState.setOpen(true);
    }

    prevSessionCountRef.current = currentCount;
  }, [sessions.length, panelState]);

  /**
   * Sort sessions by status priority (active first, then reconnecting, then errors).
   */
  const sortedSessions = useMemo(() => {
    return [...sessions].sort((a, b) => {
      const priorityA = getStatusPriority(a.status);
      const priorityB = getStatusPriority(b.status);
      return priorityA - priorityB;
    });
  }, [sessions]);

  /**
   * Render the status icon for a session.
   */
  const renderStatusIcon = (status: string) => {
    switch (status) {
      case 'active':
        return <span className="pf-status-icon pf-status-active">●</span>;
      case 'reconnecting':
        return <span className="pf-status-icon pf-status-reconnecting">↻</span>;
      case 'error':
        return <span className="pf-status-icon pf-status-error">✕</span>;
      default:
        return <span className="pf-status-icon pf-status-unknown">○</span>;
    }
  };

  /**
   * Render the action button for a session based on its status.
   */
  const renderActionButton = (session: PortForwardSession) => {
    const isStopping = stoppingIds.has(session.id);
    const isError = session.status === 'error';

    return (
      <button
        className={`button ${isError ? 'danger' : 'warning'} pf-action-button`}
        onClick={() => handleStop(session.id)}
        disabled={isStopping}
        title={isError ? 'Remove session' : 'Stop port forward'}
        aria-label={isError ? 'Remove session' : 'Stop port forward'}
      >
        {isStopping ? '...' : isError ? 'Remove' : 'Stop'}
      </button>
    );
  };

  return (
    <DockablePanel
      panelId="port-forwards"
      title="Port Forwards"
      isOpen={panelState.isOpen}
      defaultPosition="right"
      defaultSize={{ width: 350, height: 400 }}
      minWidth={300}
      minHeight={200}
      onClose={() => panelState.setOpen(false)}
      contentClassName="pf-panel-content"
    >
      <div className="pf-sessions-container">
        {sortedSessions.length === 0 ? (
          <div className="pf-empty">
            <span className="pf-empty-icon">⟷</span>
            <span className="pf-empty-text">No active port forwards</span>
          </div>
        ) : (
          sortedSessions.map((session) => (
            <div
              key={session.id}
              className={`pf-session-card pf-session-${session.status}`}
            >
              <div className="pf-session-header">
                {renderStatusIcon(session.status)}
                <div className="pf-session-ports">
                  <span className="pf-target-port">
                    {session.targetName}:{session.containerPort}
                  </span>
                  <span className="pf-port-arrow">→</span>
                  <button
                    className="pf-local-port pf-local-port-link"
                    onClick={() => BrowserOpenURL(`http://localhost:${session.localPort}`)}
                    title="Open in browser"
                    disabled={session.status !== 'active'}
                  >
                    localhost:{session.localPort}
                  </button>
                </div>
                {renderActionButton(session)}
              </div>

              <div className="pf-session-details">
                <span className="pf-detail-cluster" title={session.clusterName}>
                  {session.clusterName}
                </span>
                <span className="pf-detail-separator">/</span>
                <span className="pf-detail-namespace" title={session.namespace}>
                  {session.namespace}
                </span>
              </div>

              {/* Show status reason for errors and reconnecting states */}
              {session.statusReason && (
                <div className="pf-session-reason" title={session.statusReason}>
                  {session.statusReason}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </DockablePanel>
  );
}

export default PortForwardsPanel;
