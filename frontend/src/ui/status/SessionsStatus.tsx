/**
 * frontend/src/components/status/SessionsStatus.tsx
 *
 * Unified header status indicator for shell sessions and port forwards.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ListPortForwards, ListShellSessions, StopPortForward } from '@wailsjs/go/backend/App';
import { BrowserOpenURL } from '@wailsjs/runtime/runtime';
import { errorHandler } from '@utils/errorHandler';
import StatusIndicator, { type StatusState } from '@shared/components/status/StatusIndicator';
import { CloseIcon, OpenIcon, RestartIcon } from '@shared/components/icons/MenuIcons';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { requestObjectPanelTab } from '@modules/object-panel/objectPanelTabRequests';
import { objectPanelId } from '@/core/contexts/ObjectPanelStateContext';
import type { KubernetesObjectReference } from '@/types/view-state';
import '@modules/port-forward/PortForwardsPanel.css';
import './SessionsStatus.css';

interface ShellSessionInfo {
  sessionId: string;
  clusterId: string;
  clusterName: string;
  namespace: string;
  podName: string;
  container: string;
  command?: string[];
  status?: string;
  startedAt?: string | { time?: string };
}

interface PortForwardSession {
  id: string;
  clusterId: string;
  clusterName: string;
  namespace: string;
  podName: string;
  containerPort: number;
  localPort: number;
  status: string;
  statusReason?: string;
  startedAt: string;
}

interface PortForwardStatusEvent {
  sessionId: string;
  status: string;
  statusReason?: string;
  localPort?: number;
  podName?: string;
}

function parseTimestamp(value?: string | { time?: string }): number {
  if (!value) return 0;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (typeof value.time === 'string') {
    const parsed = Date.parse(value.time);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

function getPortForwardStatusPriority(status: string): number {
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

function renderPortForwardStatusIcon(status: string) {
  switch (status) {
    case 'active':
      return (
        <span className="pf-status-icon pf-status-active" aria-hidden="true">
          <svg viewBox="0 0 12 12" fill="currentColor" width="12" height="12">
            <circle cx="6" cy="6" r="4" />
          </svg>
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
          <svg viewBox="0 0 12 12" fill="none" width="12" height="12">
            <circle cx="6" cy="6" r="4" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </span>
      );
  }
}

function StopSquareIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" width="16" height="16" aria-hidden="true">
      <rect x="4" y="4" width="8" height="8" rx="1.2" />
    </svg>
  );
}

const SessionsStatus: React.FC = () => {
  const { openWithObject } = useObjectPanel();
  const { selectedClusterId, selectedKubeconfigs, getClusterMeta, setActiveKubeconfig } =
    useKubeconfig();
  const [shellSessions, setShellSessions] = useState<ShellSessionInfo[]>([]);
  const [portForwardSessions, setPortForwardSessions] = useState<PortForwardSession[]>([]);
  const [stoppingPortForwardIds, setStoppingPortForwardIds] = useState<Set<string>>(new Set());
  const [jumpingShellSessionId, setJumpingShellSessionId] = useState<string | null>(null);
  const [pendingShellJump, setPendingShellJump] = useState<{
    session: ShellSessionInfo;
    targetClusterId: string;
  } | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const shellList = await ListShellSessions();
        setShellSessions(shellList || []);
      } catch {
        // Ignore initial load errors; runtime events will repopulate.
      }
      try {
        const portForwardList = await ListPortForwards();
        setPortForwardSessions(portForwardList || []);
      } catch {
        // Ignore initial load errors; runtime events will repopulate.
      }
    };
    void load();
  }, []);

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
    (session: ShellSessionInfo) => {
      const targetRef: KubernetesObjectReference = {
        kind: 'Pod',
        name: session.podName,
        namespace: session.namespace,
        clusterId: session.clusterId?.trim() || selectedClusterId?.trim() || undefined,
        clusterName: session.clusterName?.trim() || undefined,
      };
      const panelId = objectPanelId(targetRef);
      openWithObject(targetRef);
      requestObjectPanelTab(panelId, 'shell');
    },
    [openWithObject, selectedClusterId]
  );

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
        openShellSessionTab(session);
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
      clusterSelectionById,
      jumpingShellSessionId,
      openShellSessionTab,
      selectedClusterId,
      setActiveKubeconfig,
    ]
  );

  useEffect(() => {
    const runtime = window.runtime;
    if (!runtime?.EventsOn) {
      return;
    }

    const cancelShellList = runtime.EventsOn('object-shell:list', (...args: unknown[]) =>
      setShellSessions((args[0] as ShellSessionInfo[]) || [])
    ) as unknown as (() => void) | undefined;

    const cancelPortForwardList = runtime.EventsOn('portforward:list', (...args: unknown[]) =>
      setPortForwardSessions((args[0] as PortForwardSession[]) || [])
    ) as unknown as (() => void) | undefined;

    const cancelPortForwardStatus = runtime.EventsOn('portforward:status', (...args: unknown[]) => {
      const event = args[0] as PortForwardStatusEvent | undefined;
      if (!event?.sessionId) return;
      setPortForwardSessions((prev) =>
        prev.map((session) =>
          session.id === event.sessionId
            ? {
                ...session,
                status: event.status,
                statusReason: event.statusReason,
                ...(event.localPort !== undefined && { localPort: event.localPort }),
                ...(event.podName !== undefined && { podName: event.podName }),
              }
            : session
        )
      );
    }) as unknown as (() => void) | undefined;

    return () => {
      cancelShellList?.();
      cancelPortForwardList?.();
      cancelPortForwardStatus?.();
    };
  }, []);

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
    openShellSessionTab(pendingShellJump.session);
    setPendingShellJump(null);
    setJumpingShellSessionId(null);
  }, [openShellSessionTab, pendingShellJump, selectedClusterId]);

  useEffect(() => {
    if (!pendingShellJump) {
      return;
    }
    const stillExists = shellSessions.some(
      (session) => session.sessionId === pendingShellJump.session.sessionId
    );
    if (!stillExists) {
      setPendingShellJump(null);
      setJumpingShellSessionId(null);
    }
  }, [pendingShellJump, shellSessions]);

  const filteredShellSessions = useMemo(
    () =>
      (selectedClusterId
        ? shellSessions.filter((session) => session.clusterId === selectedClusterId)
        : shellSessions
      ).sort((a, b) => parseTimestamp(b.startedAt) - parseTimestamp(a.startedAt)),
    [selectedClusterId, shellSessions]
  );

  const filteredPortForwards = useMemo(
    () =>
      (selectedClusterId
        ? portForwardSessions.filter((session) => session.clusterId === selectedClusterId)
        : portForwardSessions
      ).sort((a, b) => {
        const priorityA = getPortForwardStatusPriority(a.status);
        const priorityB = getPortForwardStatusPriority(b.status);
        if (priorityA !== priorityB) {
          return priorityA - priorityB;
        }
        return parseTimestamp(b.startedAt) - parseTimestamp(a.startedAt);
      }),
    [portForwardSessions, selectedClusterId]
  );

  const shellCount = filteredShellSessions.length;
  const portForwardCount = filteredPortForwards.length;

  const totalCount = shellCount + portForwardCount;
  const totalHealthy =
    shellCount + filteredPortForwards.filter((session) => session.status === 'active').length;
  const totalUnhealthy =
    portForwardCount - filteredPortForwards.filter((session) => session.status === 'active').length;

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
    />
  );
};

export default React.memo(SessionsStatus);
