/**
 * frontend/src/modules/shell-session/ShellSessionsPanel.tsx
 *
 * Dockable panel for active shell exec sessions.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CloseShellSession, ListShellSessions } from '@wailsjs/go/backend/App';
import { EventsOn } from '@wailsjs/runtime/runtime';
import {
  DockablePanel,
  useDockablePanelContext,
  useDockablePanelState,
} from '@/components/dockable';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { requestObjectPanelTab } from '@modules/object-panel/objectPanelTabRequests';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { objectPanelId } from '@/core/contexts/ObjectPanelStateContext';
import type { KubernetesObjectReference } from '@/types/view-state';
import { errorHandler } from '@utils/errorHandler';
import './ShellSessionsPanel.css';

interface ShellSessionInfo {
  sessionId: string;
  clusterId: string;
  clusterName: string;
  namespace: string;
  podName: string;
  container: string;
  command?: string[];
  startedAt?: string | { time?: string };
}

export function useShellSessionsPanel() {
  return useDockablePanelState('shell-sessions');
}

function ShellSessionsPanel() {
  const panelState = useShellSessionsPanel();
  const { tabGroups, switchTab } = useDockablePanelContext();
  const { openWithObject } = useObjectPanel();
  const { selectedClusterId, selectedKubeconfigs, getClusterMeta, setActiveKubeconfig } =
    useKubeconfig();
  const [sessions, setSessions] = useState<ShellSessionInfo[]>([]);
  const [stoppingIds, setStoppingIds] = useState<Set<string>>(new Set());
  const [attachingId, setAttachingId] = useState<string | null>(null);
  const [pendingAttach, setPendingAttach] = useState<{
    session: ShellSessionInfo;
    targetClusterId: string;
  } | null>(null);
  const prevSessionCountRef = useRef(0);
  const restoreActiveTabRef = useRef<{ groupKey: 'right' | 'bottom'; panelId: string } | null>(
    null
  );

  const loadSessions = useCallback(async () => {
    try {
      const list = await ListShellSessions();
      setSessions(list || []);
    } catch (err) {
      errorHandler.handle(err, { action: 'loadShellSessions' });
    }
  }, []);

  const handleStop = useCallback(async (sessionId: string) => {
    setStoppingIds((prev) => new Set(prev).add(sessionId));
    try {
      await CloseShellSession(sessionId);
    } catch (err) {
      errorHandler.handle(err, { action: 'stopShellSession', sessionId });
    } finally {
      setStoppingIds((prev) => {
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
    const cancelList = EventsOn('object-shell:list', (list: ShellSessionInfo[]) => {
      setSessions(list || []);
    });

    return () => {
      cancelList();
    };
  }, []);

  useEffect(() => {
    const currentCount = sessions.length;
    const prevCount = prevSessionCountRef.current;
    if (prevCount === 0 && currentCount > 0 && !panelState.isOpen) {
      const targetGroupKey = panelState.position === 'bottom' ? 'bottom' : 'right';
      const previousActiveTab =
        targetGroupKey === 'bottom' ? tabGroups.bottom.activeTab : tabGroups.right.activeTab;
      if (previousActiveTab && previousActiveTab !== 'shell-sessions') {
        restoreActiveTabRef.current = {
          groupKey: targetGroupKey,
          panelId: previousActiveTab,
        };
      }
      panelState.setOpen(true);
    }
    prevSessionCountRef.current = currentCount;
  }, [panelState, sessions.length, tabGroups.bottom.activeTab, tabGroups.right.activeTab]);

  useEffect(() => {
    const restoreTarget = restoreActiveTabRef.current;
    if (!restoreTarget || !panelState.isOpen) {
      return;
    }
    const targetTabs =
      restoreTarget.groupKey === 'bottom' ? tabGroups.bottom.tabs : tabGroups.right.tabs;
    const currentActiveTab =
      restoreTarget.groupKey === 'bottom' ? tabGroups.bottom.activeTab : tabGroups.right.activeTab;
    // Wait until shell-sessions has actually joined the tab group before restoring.
    if (!targetTabs.includes('shell-sessions')) {
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
    const stillExists = sessions.some(
      (session) => session.sessionId === pendingAttach.session.sessionId
    );
    if (!stillExists) {
      setPendingAttach(null);
      setAttachingId(null);
    }
  }, [pendingAttach, sessions]);

  const sortedSessions = useMemo(() => {
    const parseStartedAt = (value?: string | { time?: string }) => {
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
    };

    return [...sessions].sort((a, b) => {
      const aTime = parseStartedAt(a.startedAt);
      const bTime = parseStartedAt(b.startedAt);
      return bTime - aTime;
    });
  }, [sessions]);

  return (
    <DockablePanel
      panelId="shell-sessions"
      title="Shell Sessions"
      isOpen={panelState.isOpen}
      defaultPosition="right"
      defaultSize={{ width: 360, height: 420 }}
      onClose={() => panelState.setOpen(false)}
      contentClassName="ss-panel-content"
    >
      <div className="ss-sessions-container">
        {sortedSessions.length === 0 ? (
          <div className="ss-empty">
            <span className="ss-empty-icon">⌨</span>
            <span className="ss-empty-text">No active shell sessions</span>
          </div>
        ) : (
          sortedSessions.map((session) => {
            const isStopping = stoppingIds.has(session.sessionId);
            const isAttaching = attachingId === session.sessionId;
            const shellPath = (session.command && session.command[0]) || '/bin/sh';
            const fields = [
              { label: 'cluster', value: session.clusterName || session.clusterId || '-' },
              { label: 'namespace', value: session.namespace || '-' },
              { label: 'pod', value: session.podName || '-' },
              { label: 'container', value: session.container || '-' },
              { label: 'shell', value: shellPath },
            ];
            return (
              <div key={session.sessionId} className="ss-session-item">
                <div className="ss-session-main">
                  <div className="ss-session-fields">
                    {fields.map((field) => (
                      <div key={field.label} className="ss-field-row">
                        <span className="ss-field-label">{field.label}:</span>
                        <span className="ss-field-value" title={field.value}>
                          {field.value}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="ss-session-actions">
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
                    onClick={() => handleStop(session.sessionId)}
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
    </DockablePanel>
  );
}

export default ShellSessionsPanel;
