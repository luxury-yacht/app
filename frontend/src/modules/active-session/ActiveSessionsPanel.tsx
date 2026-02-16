/**
 * frontend/src/modules/active-session/ActiveSessionsPanel.tsx
 *
 * Dockable panel that combines active shell sessions and port forwards.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CloseShellSession,
  ListPortForwards,
  ListShellSessions,
  StopPortForward,
} from '@wailsjs/go/backend/App';
import { BrowserOpenURL, EventsOn } from '@wailsjs/runtime/runtime';
import { DockablePanel, useDockablePanelContext, useDockablePanelState } from '@/components/dockable';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { requestObjectPanelTab } from '@modules/object-panel/objectPanelTabRequests';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { objectPanelId } from '@/core/contexts/ObjectPanelStateContext';
import type { KubernetesObjectReference } from '@/types/view-state';
import { errorHandler } from '@utils/errorHandler';
import '@modules/shell-session/ShellSessionsPanel.css';
import '@modules/port-forward/PortForwardsPanel.css';
import './ActiveSessionsPanel.css';

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
  targetKind: string;
  targetName: string;
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

export function useActiveSessionsPanel() {
  return useDockablePanelState('active-sessions');
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

function parseTimestamp(value?: string | { time?: string }): number {
  if (!value) {
    return 0;
  }
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

function ActiveSessionsPanel() {
  const panelState = useActiveSessionsPanel();
  const { tabGroups, switchTab } = useDockablePanelContext();
  const { openWithObject } = useObjectPanel();
  const { selectedClusterId, selectedKubeconfigs, getClusterMeta, setActiveKubeconfig } =
    useKubeconfig();
  const [shellSessions, setShellSessions] = useState<ShellSessionInfo[]>([]);
  const [portForwards, setPortForwards] = useState<PortForwardSession[]>([]);
  const [stoppingShellIds, setStoppingShellIds] = useState<Set<string>>(new Set());
  const [stoppingPortForwardIds, setStoppingPortForwardIds] = useState<Set<string>>(new Set());
  const [attachingId, setAttachingId] = useState<string | null>(null);
  const [pendingAttach, setPendingAttach] = useState<{
    session: ShellSessionInfo;
    targetClusterId: string;
  } | null>(null);
  const previousTotalCountRef = useRef(0);
  const restoreActiveTabRef = useRef<{ groupKey: 'right' | 'bottom'; panelId: string } | null>(null);

  const loadSessions = useCallback(async () => {
    try {
      const shellList = await ListShellSessions();
      setShellSessions(shellList || []);
    } catch (err) {
      errorHandler.handle(err, { action: 'loadShellSessions' });
    }

    try {
      const portForwardList = await ListPortForwards();
      setPortForwards(portForwardList || []);
    } catch (err) {
      errorHandler.handle(err, { action: 'loadPortForwards' });
    }
  }, []);

  const handleStopShell = useCallback(async (sessionId: string) => {
    setStoppingShellIds((prev) => new Set(prev).add(sessionId));
    try {
      await CloseShellSession(sessionId);
    } catch (err) {
      errorHandler.handle(err, { action: 'stopShellSession', sessionId });
    } finally {
      setStoppingShellIds((prev) => {
        const next = new Set(prev);
        next.delete(sessionId);
        return next;
      });
    }
  }, []);

  const handleStopPortForward = useCallback(async (sessionId: string) => {
    setStoppingPortForwardIds((prev) => new Set(prev).add(sessionId));
    try {
      await StopPortForward(sessionId);
    } catch (err) {
      errorHandler.handle(err, { action: 'stopPortForward', sessionId });
    } finally {
      setStoppingPortForwardIds((prev) => {
        const next = new Set(prev);
        next.delete(sessionId);
        return next;
      });
    }
  }, []);

  const openSessionPanel = useCallback(
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
    // Build a clusterId -> selection lookup so attach can switch tabs safely.
    selectedKubeconfigs.forEach((selection) => {
      const id = getClusterMeta(selection).id;
      if (id && !map.has(id)) {
        map.set(id, selection);
      }
    });
    return map;
  }, [getClusterMeta, selectedKubeconfigs]);

  const handleAttach = useCallback(
    (session: ShellSessionInfo) => {
      const targetClusterId = session.clusterId?.trim() || '';
      setAttachingId(session.sessionId);

      if (!targetClusterId || selectedClusterId === targetClusterId) {
        openSessionPanel(session);
        setAttachingId(null);
        return;
      }

      const targetSelection = clusterSelectionById.get(targetClusterId);
      if (!targetSelection) {
        errorHandler.handle(new Error('Session cluster tab is not active.'), {
          action: 'attachShellSession',
          sessionId: session.sessionId,
          clusterId: targetClusterId,
        });
        setAttachingId(null);
        return;
      }

      setPendingAttach({ session, targetClusterId });
      setActiveKubeconfig(targetSelection);
    },
    [clusterSelectionById, openSessionPanel, selectedClusterId, setActiveKubeconfig]
  );

  useEffect(() => {
    if (!panelState.isOpen) {
      return;
    }
    void loadSessions();
  }, [loadSessions, panelState.isOpen]);

  useEffect(() => {
    const cancelShellList = EventsOn('object-shell:list', (list: ShellSessionInfo[]) => {
      setShellSessions(list || []);
    });

    const cancelPortForwardList = EventsOn('portforward:list', (list: PortForwardSession[]) => {
      setPortForwards(list || []);
    });

    const cancelPortForwardStatus = EventsOn('portforward:status', (event: PortForwardStatusEvent) => {
      setPortForwards((prev) =>
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
    });

    return () => {
      cancelShellList();
      cancelPortForwardList();
      cancelPortForwardStatus();
    };
  }, []);

  const totalSessionCount = shellSessions.length + portForwards.length;

  useEffect(() => {
    const previousCount = previousTotalCountRef.current;
    if (previousCount === 0 && totalSessionCount > 0 && !panelState.isOpen) {
      const targetGroupKey = panelState.position === 'bottom' ? 'bottom' : 'right';
      const previousActiveTab =
        targetGroupKey === 'bottom' ? tabGroups.bottom.activeTab : tabGroups.right.activeTab;
      if (previousActiveTab && previousActiveTab !== 'active-sessions') {
        restoreActiveTabRef.current = {
          groupKey: targetGroupKey,
          panelId: previousActiveTab,
        };
      }
      panelState.setOpen(true);
    }
    previousTotalCountRef.current = totalSessionCount;
  }, [panelState, tabGroups.bottom.activeTab, tabGroups.right.activeTab, totalSessionCount]);

  useEffect(() => {
    const restoreTarget = restoreActiveTabRef.current;
    if (!restoreTarget || !panelState.isOpen) {
      return;
    }
    const targetTabs =
      restoreTarget.groupKey === 'bottom' ? tabGroups.bottom.tabs : tabGroups.right.tabs;
    const currentActiveTab =
      restoreTarget.groupKey === 'bottom' ? tabGroups.bottom.activeTab : tabGroups.right.activeTab;
    // Wait until active-sessions has actually joined the tab group before restoring.
    if (!targetTabs.includes('active-sessions')) {
      return;
    }
    if (!targetTabs.includes(restoreTarget.panelId)) {
      restoreActiveTabRef.current = null;
      return;
    }
    if (currentActiveTab === restoreTarget.panelId) {
      restoreActiveTabRef.current = null;
      return;
    }
    switchTab(restoreTarget.groupKey, restoreTarget.panelId);
  }, [
    panelState.isOpen,
    switchTab,
    tabGroups.bottom.activeTab,
    tabGroups.bottom.tabs,
    tabGroups.right.activeTab,
    tabGroups.right.tabs,
  ]);

  useEffect(() => {
    if (!pendingAttach) {
      return;
    }
    // Defer opening until the target cluster tab is active so panel state
    // is written under the correct cluster scope.
    if (pendingAttach.targetClusterId && selectedClusterId !== pendingAttach.targetClusterId) {
      return;
    }
    openSessionPanel(pendingAttach.session);
    setPendingAttach(null);
    setAttachingId(null);
  }, [openSessionPanel, pendingAttach, selectedClusterId]);

  useEffect(() => {
    if (!pendingAttach) {
      return;
    }
    const stillExists = shellSessions.some(
      (session) => session.sessionId === pendingAttach.session.sessionId
    );
    if (!stillExists) {
      setPendingAttach(null);
      setAttachingId(null);
    }
  }, [pendingAttach, shellSessions]);

  const sortedShellSessions = useMemo(() => {
    return [...shellSessions].sort((a, b) => parseTimestamp(b.startedAt) - parseTimestamp(a.startedAt));
  }, [shellSessions]);

  const sortedPortForwards = useMemo(() => {
    return [...portForwards].sort((a, b) => {
      const priorityA = getPortForwardStatusPriority(a.status);
      const priorityB = getPortForwardStatusPriority(b.status);
      if (priorityA !== priorityB) {
        return priorityA - priorityB;
      }
      return parseTimestamp(b.startedAt) - parseTimestamp(a.startedAt);
    });
  }, [portForwards]);

  const renderPortForwardStatusIcon = (status: string) => {
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

  return (
    <DockablePanel
      panelId="active-sessions"
      title="Active Sessions"
      isOpen={panelState.isOpen}
      defaultPosition="right"
      defaultSize={{ width: 380, height: 460 }}
      onClose={() => panelState.setOpen(false)}
      contentClassName="as-panel-content"
    >
      <div className="as-sections">
        {totalSessionCount === 0 ? (
          <div className="as-empty">
            <span className="as-empty-icon">◎</span>
            <span className="as-empty-text">No active sessions</span>
          </div>
        ) : (
          <>
            <section className="as-section">
              <header className="as-section-header">
                <h3 className="as-section-title">Shell Sessions</h3>
                <span className="as-section-count">{sortedShellSessions.length}</span>
              </header>
              <div className="as-section-body">
                {sortedShellSessions.length === 0 ? (
                  <div className="as-section-empty">No active shell sessions</div>
                ) : (
                  sortedShellSessions.map((session) => {
                    const isStopping = stoppingShellIds.has(session.sessionId);
                    const isAttaching = attachingId === session.sessionId;
                    const status = session.status || 'active';
                    const shellPath = (session.command && session.command[0]) || '/bin/sh';
                    const fields = [
                      { label: 'cluster', value: session.clusterName || session.clusterId || '-' },
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
                        <div className="ss-session-actions as-shell-actions">
                          <button
                            className="button generic ss-attach-button"
                            onClick={() => handleAttach(session)}
                            disabled={isStopping || isAttaching}
                            title="Open the pod panel and attach to this session"
                            aria-label="Attach to shell session"
                          >
                            {isAttaching ? '...' : 'Attach'}
                          </button>
                          <button
                            className="button warning ss-stop-button"
                            onClick={() => handleStopShell(session.sessionId)}
                            disabled={isStopping}
                            title="Stop shell session"
                            aria-label="Stop shell session"
                          >
                            {isStopping ? '...' : 'Stop'}
                          </button>
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
                <span className="as-section-count">{sortedPortForwards.length}</span>
              </header>
              <div className="as-section-body">
                {sortedPortForwards.length === 0 ? (
                  <div className="as-section-empty">No active port forwards</div>
                ) : (
                  sortedPortForwards.map((session) => {
                    const isStopping = stoppingPortForwardIds.has(session.id);
                    const fields = [
                      { label: 'cluster', value: session.clusterName || session.clusterId || '-' },
                      { label: 'namespace', value: session.namespace || '-' },
                      { label: 'pod', value: session.podName || '-' },
                      { label: 'ports', value: `${session.containerPort}:${session.localPort}` },
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
                                  {index === 0 ? renderPortForwardStatusIcon(session.status) : null}
                                </span>
                                <span className="ss-field-label">{field.label}:</span>
                                <span className="ss-field-value" title={field.value}>
                                  {field.value}
                                </span>
                              </div>
                            ))}
                          </div>
                          {session.statusReason && (
                            <div className="pf-session-reason as-pf-reason" title={session.statusReason}>
                              {session.statusReason}
                            </div>
                          )}
                        </div>
                        <div className="ss-session-actions as-pf-actions">
                          <button
                            className="button generic as-pf-connect-button"
                            onClick={() => BrowserOpenURL(`http://localhost:${session.localPort}`)}
                            disabled={session.status !== 'active' || isStopping}
                            title="Connect to forwarded port"
                            aria-label="Connect to forwarded port"
                          >
                            Connect
                          </button>
                          <button
                            className="button warning ss-stop-button"
                            onClick={() => handleStopPortForward(session.id)}
                            disabled={isStopping}
                            title="Stop port forward"
                            aria-label="Stop port forward"
                          >
                            {isStopping ? '...' : 'Stop'}
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
    </DockablePanel>
  );
}

export default ActiveSessionsPanel;
