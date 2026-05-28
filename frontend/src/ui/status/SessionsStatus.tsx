/**
 * frontend/src/components/status/SessionsStatus.tsx
 *
 * Unified header status indicator for shell sessions and port forwards.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StopPortForward } from '@wailsjs/go/backend/App';
import { BrowserOpenURL } from '@wailsjs/runtime/runtime';
import { errorHandler } from '@utils/errorHandler';
import StatusIndicator, { type StatusState } from '@shared/components/status/StatusIndicator';
import {
  CloseIcon,
  OpenIcon,
  RestartIcon,
  StatusDotIcon,
  StopSquareIcon,
} from '@shared/components/icons/SharedIcons';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import {
  getRequestedObjectPanelTab,
  requestObjectPanelTab,
} from '@modules/object-panel/objectPanelTabRequests';
import { objectPanelId } from '@modules/object-panel/contexts/ObjectPanelStateContext';
import { buildRequiredObjectReference } from '@shared/utils/objectIdentity';
import { useRuntimeOperationStatus, type ShellSessionInfo } from './runtimeOperationStatus';
import '@modules/port-forward/PortForwardsPanel.css';
import './SessionsStatus.css';

function renderPortForwardStatusIcon(status: string) {
  switch (status) {
    case 'active':
      return (
        <span className="pf-status-icon pf-status-active" aria-hidden="true">
          <StatusDotIcon />
        </span>
      );
    case 'reconnecting':
      return (
        <span className="pf-status-icon pf-status-reconnecting" aria-hidden="true">
          <RestartIcon width={12} height={12} />
        </span>
      );
    case 'error':
      return (
        <span className="pf-status-icon pf-status-error" aria-hidden="true">
          <CloseIcon width={10} height={10} />
        </span>
      );
    default:
      return (
        <span className="pf-status-icon pf-status-unknown" aria-hidden="true">
          <StatusDotIcon outlined />
        </span>
      );
  }
}

const SessionsStatus: React.FC = () => {
  const { openWithObject } = useObjectPanel();
  const { selectedClusterId, selectedKubeconfigs, getClusterMeta, setActiveKubeconfig } =
    useKubeconfig();
  const { shellSessions: filteredShellSessions, portForwardSessions: filteredPortForwards } =
    useRuntimeOperationStatus(selectedClusterId);
  const [stoppingPortForwardIds, setStoppingPortForwardIds] = useState<Set<string>>(new Set());
  const [jumpingShellSessionId, setJumpingShellSessionId] = useState<string | null>(null);
  const [pendingShellJump, setPendingShellJump] = useState<{
    session: ShellSessionInfo;
    targetClusterId: string;
  } | null>(null);
  const [statusPopoverCloseSignal, setStatusPopoverCloseSignal] = useState(0);

  const handleStopPortForward = useCallback(async (sessionId: string) => {
    setStoppingPortForwardIds((prev) => new Set(prev).add(sessionId));
    try {
      await StopPortForward(sessionId);
      // Session list/status updates arrive from backend events.
    } catch (err) {
      errorHandler.handle(err, {
        action: 'stopPortForward',
        sessionId,
        source: 'SessionsStatus',
      });
    } finally {
      setStoppingPortForwardIds((prev) => {
        const next = new Set(prev);
        next.delete(sessionId);
        return next;
      });
    }
  }, []);

  const openShellSessionTab = useCallback(
    (session: ShellSessionInfo): boolean => {
      const targetRef = buildRequiredObjectReference({
        kind: 'Pod',
        name: session.podName,
        namespace: session.namespace,
        clusterId: session.clusterId?.trim() || selectedClusterId?.trim() || undefined,
        clusterName: session.clusterName?.trim() || undefined,
      });
      const panelId = objectPanelId(targetRef);
      openWithObject(targetRef);
      requestObjectPanelTab(panelId, 'shell');
      if (getRequestedObjectPanelTab(panelId) !== 'shell') {
        throw new Error('Shell session tab request was not accepted.');
      }
      return true;
    },
    [openWithObject, selectedClusterId]
  );

  const closeStatusPopover = useCallback(() => {
    setStatusPopoverCloseSignal((signal) => signal + 1);
  }, []);

  const clusterSelectionById = useMemo(() => {
    const map = new Map<string, string>();
    // Build a clusterId -> selection lookup so jumps can switch clusters safely.
    selectedKubeconfigs.forEach((selection) => {
      const id = getClusterMeta(selection).id;
      if (id && !map.has(id)) {
        map.set(id, selection);
      }
    });
    return map;
  }, [getClusterMeta, selectedKubeconfigs]);

  const handleJumpToShellSession = useCallback(
    (session: ShellSessionInfo) => {
      if (jumpingShellSessionId) {
        return;
      }

      const targetClusterId = session.clusterId?.trim() || '';
      setJumpingShellSessionId(session.sessionId);

      if (!targetClusterId || selectedClusterId === targetClusterId) {
        try {
          if (openShellSessionTab(session)) {
            closeStatusPopover();
          }
        } catch (err) {
          errorHandler.handle(err, {
            action: 'jumpToShellSession',
            sessionId: session.sessionId,
            clusterId: targetClusterId,
            source: 'SessionsStatus',
          });
        }
        setJumpingShellSessionId(null);
        return;
      }

      const targetSelection = clusterSelectionById.get(targetClusterId);
      if (!targetSelection) {
        errorHandler.handle(new Error('Session cluster tab is not active.'), {
          action: 'jumpToShellSession',
          sessionId: session.sessionId,
          clusterId: targetClusterId,
          source: 'SessionsStatus',
        });
        setJumpingShellSessionId(null);
        return;
      }

      setPendingShellJump({ session, targetClusterId });
      setActiveKubeconfig(targetSelection);
    },
    [
      closeStatusPopover,
      clusterSelectionById,
      jumpingShellSessionId,
      openShellSessionTab,
      selectedClusterId,
      setActiveKubeconfig,
    ]
  );

  useEffect(() => {
    if (!pendingShellJump) {
      return;
    }
    // Defer the open until the target cluster becomes active to keep panel state scoped correctly.
    if (
      pendingShellJump.targetClusterId &&
      selectedClusterId !== pendingShellJump.targetClusterId
    ) {
      return;
    }
    try {
      if (openShellSessionTab(pendingShellJump.session)) {
        closeStatusPopover();
      }
    } catch (err) {
      errorHandler.handle(err, {
        action: 'jumpToShellSession',
        sessionId: pendingShellJump.session.sessionId,
        clusterId: pendingShellJump.targetClusterId,
        source: 'SessionsStatus',
      });
    }
    setPendingShellJump(null);
    setJumpingShellSessionId(null);
  }, [closeStatusPopover, openShellSessionTab, pendingShellJump, selectedClusterId]);

  useEffect(() => {
    if (!pendingShellJump) {
      return;
    }
    const stillExists = filteredShellSessions.some(
      (session) => session.sessionId === pendingShellJump.session.sessionId
    );
    if (!stillExists) {
      setPendingShellJump(null);
      setJumpingShellSessionId(null);
    }
  }, [filteredShellSessions, pendingShellJump]);

  const shellCount = filteredShellSessions.length;
  const portForwardCount = filteredPortForwards.length;

  const totalCount = shellCount + portForwardCount;
  const totalHealthy =
    shellCount + filteredPortForwards.filter((session) => session.status === 'active').length;
  const totalUnhealthy = Math.max(0, totalCount - totalHealthy);

  const status = useMemo<StatusState>(() => {
    if (totalCount === 0) return 'inactive';
    if (totalUnhealthy === 0) return 'healthy';
    if (totalHealthy === 0) return 'unhealthy';
    return 'degraded';
  }, [totalCount, totalHealthy, totalUnhealthy]);

  const message = useMemo(
    () => (
      <div className="sessions-status-message">
        <div className="sessions-status-tracking as-sections">
          {totalCount === 0 ? (
            <div className="as-empty sessions-status-empty">
              <span className="as-empty-icon">◎</span>
              <span className="as-empty-text">No active shell sessions or port forwards</span>
            </div>
          ) : (
            <>
              <section className="as-section">
                <header className="as-section-header">
                  <h3 className="as-section-title">Shell Sessions</h3>
                  <span className="as-section-count">{shellCount}</span>
                </header>
                <div className="as-section-body">
                  {shellCount === 0 ? (
                    <div className="as-section-empty">No active shell sessions</div>
                  ) : (
                    filteredShellSessions.map((session) => {
                      const status = session.status || 'active';
                      const shellPath = (session.command && session.command[0]) || '/bin/sh';
                      const fields = [
                        {
                          label: 'cluster',
                          value: session.clusterName || session.clusterId || '-',
                        },
                        { label: 'namespace', value: session.namespace || '-' },
                        { label: 'pod', value: session.podName || '-' },
                        { label: 'container', value: session.container || '-' },
                        { label: 'shell', value: shellPath },
                      ];
                      return (
                        <button
                          key={session.sessionId}
                          type="button"
                          className="ss-session-item as-shell-session as-shell-session-jump"
                          onClick={() => handleJumpToShellSession(session)}
                          disabled={Boolean(jumpingShellSessionId)}
                          title="Click to open this shell session"
                          aria-label={`Open shell session tab for ${session.podName || 'pod'}`}
                        >
                          <div className="ss-session-main">
                            <div className="ss-session-fields as-pf-fields">
                              {fields.map((field, index) => (
                                <div key={field.label} className="ss-field-row as-pf-field-row">
                                  <span className="as-pf-status-slot" aria-hidden={index !== 0}>
                                    {index === 0 ? renderPortForwardStatusIcon(status) : null}
                                  </span>
                                  <span className="ss-field-label">{field.label}:</span>
                                  <span className="ss-field-value">{field.value}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                          <span className="as-shell-open-affordance" aria-hidden="true">
                            {jumpingShellSessionId === session.sessionId ? (
                              '…'
                            ) : (
                              <OpenIcon width={14} height={14} />
                            )}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </section>

              <section className="as-section">
                <header className="as-section-header">
                  <h3 className="as-section-title">Port Forwards</h3>
                  <span className="as-section-count">{portForwardCount}</span>
                </header>
                <div className="as-section-body">
                  {portForwardCount === 0 ? (
                    <div className="as-section-empty">No active port forwards</div>
                  ) : (
                    filteredPortForwards.map((session) => {
                      const isStopping = stoppingPortForwardIds.has(session.id);
                      const isError = session.status === 'error';
                      const fields = [
                        {
                          label: 'cluster',
                          value: session.clusterName || session.clusterId || '-',
                        },
                        { label: 'namespace', value: session.namespace || '-' },
                        { label: 'pod', value: session.podName || '-' },
                      ];
                      return (
                        <div
                          key={session.id}
                          className={`ss-session-item as-pf-session pf-session-${session.status}`}
                        >
                          <div className="ss-session-main">
                            <div className="ss-session-fields as-pf-fields">
                              {fields.map((field, index) => (
                                <div key={field.label} className="ss-field-row as-pf-field-row">
                                  <span className="as-pf-status-slot" aria-hidden={index !== 0}>
                                    {index === 0
                                      ? renderPortForwardStatusIcon(session.status)
                                      : null}
                                  </span>
                                  <span className="ss-field-label">{field.label}:</span>
                                  <span className="ss-field-value">{field.value}</span>
                                </div>
                              ))}
                              <div className="ss-field-row as-pf-field-row as-pf-local-row">
                                <span className="as-pf-status-slot" aria-hidden>
                                  {null}
                                </span>
                                <span className="ss-field-label">ports:</span>
                                <span className="ss-field-value">
                                  <span>{session.containerPort}</span>
                                  <span className="pf-port-arrow">→</span>
                                  <button
                                    type="button"
                                    className="pf-local-port pf-local-port-link"
                                    onClick={() =>
                                      BrowserOpenURL(`http://localhost:${session.localPort}`)
                                    }
                                    title="Open in browser"
                                    disabled={session.status !== 'active'}
                                  >
                                    localhost:{session.localPort}
                                  </button>
                                </span>
                              </div>
                            </div>
                            {session.statusReason && (
                              <div className="pf-session-reason as-pf-reason">
                                {session.statusReason}
                              </div>
                            )}
                          </div>
                          <div className="ss-session-actions as-pf-actions">
                            <button
                              type="button"
                              className={`as-compact-icon-action ${isError ? 'as-danger' : 'as-warning'}`}
                              onClick={() => void handleStopPortForward(session.id)}
                              disabled={isStopping}
                              title={isError ? undefined : 'Stop port forward'}
                              aria-label={isError ? 'Remove session' : 'Stop port forward'}
                            >
                              {isStopping ? (
                                '…'
                              ) : isError ? (
                                <CloseIcon width={14} height={14} />
                              ) : (
                                <StopSquareIcon />
                              )}
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    ),
    [
      filteredPortForwards,
      filteredShellSessions,
      handleJumpToShellSession,
      handleStopPortForward,
      jumpingShellSessionId,
      portForwardCount,
      shellCount,
      stoppingPortForwardIds,
      totalCount,
    ]
  );

  const messageAria = useMemo(
    () => `Shell Sessions: ${shellCount}. Port Forwards: ${portForwardCount}.`,
    [portForwardCount, shellCount]
  );

  return (
    <StatusIndicator
      status={status}
      title="Sessions"
      message={message}
      ariaLabel={`Sessions: ${messageAria}`}
      tooltipClassName="sessions-status-popover"
      hideTitle
      closeSignal={statusPopoverCloseSignal}
    />
  );
};

export default React.memo(SessionsStatus);
