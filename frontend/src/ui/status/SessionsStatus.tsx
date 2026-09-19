/**
 * frontend/src/components/status/SessionsStatus.tsx
 *
 * Unified header status indicator for shell sessions and port forwards.
 */

import { openURL } from '@core/desktop-runtime';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { objectPanelId } from '@modules/object-panel/contexts/ObjectPanelStateContext';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import {
  getRequestedObjectPanelTab,
  requestObjectPanelTab,
} from '@modules/object-panel/objectPanelTabRequests';
import {
  CloseIcon,
  OpenIcon,
  RestartIcon,
  StatusDotIcon,
  StopSquareIcon,
} from '@shared/components/icons/SharedIcons';
import StatusIndicator, { type StatusState } from '@shared/components/status/StatusIndicator';
import { buildRequiredObjectReference } from '@shared/utils/objectIdentity';
import { errorHandler } from '@utils/errorHandler';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StopPortForward } from '@/core/backend-api';
import { type ShellSessionInfo, useRuntimeOperationStatus } from './runtimeOperationStatus';
import type { PortForwardSession } from './runtimeOperationStatusAdapter';
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

interface SessionField {
  label: string;
  value: string;
}

const sessionIdentityFields = (
  session: Pick<ShellSessionInfo, 'clusterName' | 'clusterId' | 'namespace' | 'podName'>
): SessionField[] => [
  { label: 'cluster', value: session.clusterName || session.clusterId || '-' },
  { label: 'namespace', value: session.namespace || '-' },
  { label: 'pod', value: session.podName || '-' },
];

const SessionFields = ({ fields, status }: { fields: SessionField[]; status: string }) => (
  <>
    {fields.map((field, index) => (
      <div key={field.label} className="ss-field-row as-pf-field-row">
        <span className="as-pf-status-slot" aria-hidden={index !== 0}>
          {index === 0 ? renderPortForwardStatusIcon(status) : null}
        </span>
        <span className="ss-field-label">{field.label}:</span>
        <span className="ss-field-value">{field.value}</span>
      </div>
    ))}
  </>
);

const ShellSessionItem = ({
  session,
  jumpingShellSessionId,
  onOpen,
}: {
  session: ShellSessionInfo;
  jumpingShellSessionId: string | null;
  onOpen: (session: ShellSessionInfo) => void;
}) => {
  const sessionStatus = session.status || 'active';
  const fields = [
    ...sessionIdentityFields(session),
    { label: 'container', value: session.container || '-' },
    { label: 'shell', value: session.command?.[0] || '/bin/sh' },
  ];
  return (
    <button
      type="button"
      className="ss-session-item as-shell-session as-shell-session-jump"
      onClick={() => onOpen(session)}
      disabled={Boolean(jumpingShellSessionId)}
      title="Click to open this shell session"
      aria-label={`Open shell session tab for ${session.podName || 'pod'}`}
    >
      <div className="ss-session-main">
        <div className="ss-session-fields as-pf-fields">
          <SessionFields fields={fields} status={sessionStatus} />
        </div>
      </div>
      <span className="as-shell-open-affordance" aria-hidden="true">
        {jumpingShellSessionId === session.sessionId ? '…' : <OpenIcon width={14} height={14} />}
      </span>
    </button>
  );
};

const PortForwardSessionItem = ({
  session,
  isStopping,
  onStop,
}: {
  session: PortForwardSession;
  isStopping: boolean;
  onStop: (id: string) => Promise<void>;
}) => {
  const isError = session.status === 'error';
  const fields = sessionIdentityFields(session);
  let actionIcon: React.ReactNode = <StopSquareIcon />;
  if (isStopping) {
    actionIcon = '…';
  } else if (isError) {
    actionIcon = <CloseIcon width={14} height={14} />;
  }
  return (
    <div className={`ss-session-item as-pf-session pf-session-${session.status}`}>
      <div className="ss-session-main">
        <div className="ss-session-fields as-pf-fields">
          <SessionFields fields={fields} status={session.status} />
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
                onClick={() => openURL(`http://localhost:${session.localPort}`)}
                title="Open in browser"
                disabled={session.status !== 'active'}
              >
                localhost:{session.localPort}
              </button>
            </span>
          </div>
        </div>
        {!!session.statusReason && (
          <div className="pf-session-reason as-pf-reason">{session.statusReason}</div>
        )}
      </div>
      <div className="ss-session-actions as-pf-actions">
        <button
          type="button"
          className={`as-compact-icon-action ${isError ? 'as-danger' : 'as-warning'}`}
          onClick={() => void onStop(session.id)}
          disabled={isStopping}
          title={isError ? undefined : 'Stop port forward'}
          aria-label={isError ? 'Remove session' : 'Stop port forward'}
        >
          {actionIcon}
        </button>
      </div>
    </div>
  );
};

const SessionsStatus: React.FC = () => {
  const { openWithObject } = useObjectPanel();
  const { selectedClusterId, selectedKubeconfigs, getClusterMeta, setActiveKubeconfig } =
    useKubeconfig();
  const { shellSessions: filteredShellSessions, portForwardSessions: filteredPortForwards } =
    useRuntimeOperationStatus(selectedClusterId);
  const [stoppingPortForwardIds, setStoppingPortForwardIds] = useState<Set<string>>(new Set());
  const [pendingShellJump, setPendingShellJump] = useState<{
    session: ShellSessionInfo;
    targetClusterId: string;
  } | null>(null);
  const jumpingShellSessionId = pendingShellJump?.session.sessionId ?? null;
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
    (session: ShellSessionInfo) => {
      try {
        const targetRef = buildRequiredObjectReference({
          group: '',
          version: 'v1',
          kind: 'Pod',
          name: session.podName,
          namespace: session.namespace,
          clusterId: session.clusterId,
          clusterName: session.clusterName?.trim() || undefined,
        });
        const panelId = objectPanelId(targetRef);
        openWithObject(targetRef);
        requestObjectPanelTab(panelId, 'shell');
        if (getRequestedObjectPanelTab(panelId) !== 'shell') {
          throw new Error('Shell session tab request was not accepted.');
        }
        setStatusPopoverCloseSignal((signal) => signal + 1);
      } catch (error) {
        errorHandler.handle(error, {
          action: 'jumpToShellSession',
          sessionId: session.sessionId,
          clusterId: session.clusterId?.trim() || '',
          source: 'SessionsStatus',
        });
      }
    },
    [openWithObject]
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

      if (!targetClusterId || selectedClusterId === targetClusterId) {
        openShellSessionTab(session);
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
  }, [openShellSessionTab, pendingShellJump, selectedClusterId]);

  useEffect(() => {
    if (!pendingShellJump) {
      return;
    }
    const stillExists = filteredShellSessions.some(
      (session) =>
        session.sessionId === pendingShellJump.session.sessionId &&
        session.clusterId === pendingShellJump.targetClusterId
    );
    if (!stillExists) {
      setPendingShellJump(null);
    }
  }, [filteredShellSessions, pendingShellJump]);

  const shellCount = filteredShellSessions.length;
  const portForwardCount = filteredPortForwards.length;

  const totalCount = shellCount + portForwardCount;
  const totalHealthy =
    shellCount + filteredPortForwards.filter((session) => session.status === 'active').length;
  const totalUnhealthy = Math.max(0, totalCount - totalHealthy);

  const status = useMemo<StatusState>(() => {
    if (totalCount === 0) {
      return 'inactive';
    }
    if (totalUnhealthy === 0) {
      return 'healthy';
    }
    if (totalHealthy === 0) {
      return 'unhealthy';
    }
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
                    filteredShellSessions.map((session) => (
                      <ShellSessionItem
                        key={JSON.stringify([session.clusterId, session.sessionId])}
                        session={session}
                        jumpingShellSessionId={jumpingShellSessionId}
                        onOpen={handleJumpToShellSession}
                      />
                    ))
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
                    filteredPortForwards.map((session) => (
                      <PortForwardSessionItem
                        key={JSON.stringify([session.clusterId, session.id])}
                        session={session}
                        isStopping={stoppingPortForwardIds.has(session.id)}
                        onStop={handleStopPortForward}
                      />
                    ))
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
