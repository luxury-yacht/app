/**
 * frontend/src/modules/port-forward/PortForwardsPanel.tsx
 *
 * Dockable panel component for managing active port forward sessions.
 * Displays all active, reconnecting, and errored port forwards with controls
 * to stop/remove them.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { StopPortForward } from '@wailsjs/go/backend/App';
import { BrowserOpenURL } from '@wailsjs/runtime/runtime';
import { DockablePanel, useDockablePanelState } from '@ui/dockable';
import { useKeyboardSurface } from '@ui/shortcuts/surfaces';
import { errorHandler } from '@utils/errorHandler';
import {
  useRuntimeOperationStatus,
  type PortForwardSession,
} from '@/ui/status/runtimeOperationStatus';
import './PortForwardsPanel.css';

/**
 * Hook to access the port forwards panel state.
 * Use this from other components to open/close the panel.
 */
function usePortForwardsPanel() {
  return useDockablePanelState('port-forwards');
}

/**
 * Panel component for managing port forward sessions.
 * Displays sessions grouped by status with controls to stop/remove them.
 */
function PortForwardsPanel() {
  const panelState = usePortForwardsPanel();
  const panelRef = useRef<HTMLDivElement>(null);
  const handleRuntimeStatusReadError = useCallback((err: unknown, resource: string) => {
    if (resource !== 'port-forward-sessions') {
      return;
    }
    errorHandler.handle(err, { action: 'loadPortForwards' });
  }, []);
  const { portForwardSessions: sessions } = useRuntimeOperationStatus(null, {
    readInitialState: panelState.isOpen,
    onInitialReadError: handleRuntimeStatusReadError,
  });
  // Set of session IDs currently being stopped (for button loading state)
  const [stoppingIds, setStoppingIds] = useState<Set<string>>(new Set());
  // Track previous session count for auto-open logic
  const prevSessionCountRef = useRef(0);

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

  useKeyboardSurface({
    kind: 'panel',
    rootRef: panelRef,
    active: panelState.isOpen,
    captureWhenActive: true,
    onEscape: () => {
      panelState.setOpen(false);
      return true;
    },
  });

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
      onClose={() => panelState.setOpen(false)}
      contentClassName="pf-panel-content"
      panelRef={panelRef}
    >
      <div className="pf-sessions-container">
        {sessions.length === 0 ? (
          <div className="pf-empty">
            <span className="pf-empty-icon">⟷</span>
            <span className="pf-empty-text">No active port forwards</span>
          </div>
        ) : (
          sessions.map((session) => (
            <div key={session.id} className={`pf-session-card pf-session-${session.status}`}>
              <div className="pf-session-header">
                {renderStatusIcon(session.status)}
                <span className="pf-target-port">
                  {session.targetName || session.podName}:{session.containerPort}
                </span>
                {renderActionButton(session)}
              </div>

              <div className="pf-session-local">
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
