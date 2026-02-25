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
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import '@modules/shell-session/ShellSessionsPanel.css';
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
      return <span className="pf-status-icon pf-status-active">●</span>;
    case 'reconnecting':
      return <span className="pf-status-icon pf-status-reconnecting">↻</span>;
    case 'error':
      return <span className="pf-status-icon pf-status-error">✕</span>;
    default:
      return <span className="pf-status-icon pf-status-unknown">○</span>;
  }
}

const SessionsStatus: React.FC = () => {
  const { selectedClusterId } = useKubeconfig();
  const [shellSessions, setShellSessions] = useState<ShellSessionInfo[]>([]);
  const [portForwardSessions, setPortForwardSessions] = useState<PortForwardSession[]>([]);
  const [stoppingPortForwardIds, setStoppingPortForwardIds] = useState<Set<string>>(new Set());

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
                        <div key={session.sessionId} className="ss-session-item as-shell-session">
                          <div className="ss-session-main">
                            <div className="ss-session-fields as-pf-fields">
                              {fields.map((field, index) => (
                                <div key={field.label} className="ss-field-row as-pf-field-row">
                                  <span className="as-pf-status-slot" aria-hidden={index !== 0}>
                                    {index === 0 ? renderPortForwardStatusIcon(status) : null}
                                  </span>
                                  <span className="ss-field-label">{field.label}:</span>
                                  <span className="ss-field-value" title={field.value}>
                                    {field.value}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
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
                                  <span className="ss-field-value" title={field.value}>
                                    {field.value}
                                  </span>
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
                              <div
                                className="pf-session-reason as-pf-reason"
                                title={session.statusReason}
                              >
                                {session.statusReason}
                              </div>
                            )}
                          </div>
                          <div className="ss-session-actions as-pf-actions">
                            <button
                              type="button"
                              className={`button ${isError ? 'danger' : 'warning'} pf-action-button`}
                              onClick={() => void handleStopPortForward(session.id)}
                              disabled={isStopping}
                              title={isError ? 'Remove session' : 'Stop port forward'}
                              aria-label={isError ? 'Remove session' : 'Stop port forward'}
                            >
                              {isStopping ? '...' : isError ? 'Remove' : 'Stop'}
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
      handleStopPortForward,
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
