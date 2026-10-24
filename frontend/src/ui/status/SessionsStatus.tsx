/**
 * frontend/src/components/status/SessionsStatus.tsx
 *
 * Unified header status indicator for shell sessions and port forwards.
 */

import { types } from '@core/backend-api/models';
import { openURL } from '@core/desktop-runtime';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { objectPanelId } from '@modules/object-panel/contexts/ObjectPanelStateContext';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { requestObjectPanelTab } from '@modules/object-panel/objectPanelTabRequests';
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
import React, { useCallback, useMemo, useState } from 'react';
import { CloseShellSession, StopPortForward } from '@/core/backend-api';
import { type ShellSessionInfo, useRuntimeOperationStatus } from './runtimeOperationStatus';
import type { PortForwardSession } from './runtimeOperationStatusAdapter';
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

interface SessionIdentity {
  clusterName?: string;
  clusterId?: string;
  namespace?: string;
  podName?: string;
}

const sessionIdentityFields = (session: SessionIdentity): SessionField[] => [
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

// A node shell whose stream ended but whose debug pod could not be deleted.
const isKeptForCleanup = (session: ShellSessionInfo): boolean =>
  session.status === types.ShellSessionStatus.ShellSessionStatusCleanupFailed;

const ShellSessionItem = ({
  session,
  isEnding,
  onOpen,
  onEnd,
}: {
  session: ShellSessionInfo;
  isEnding: boolean;
  onOpen: (session: ShellSessionInfo) => void;
  onEnd: (sessionId: string) => Promise<void>;
}) => {
  const sessionStatus = isKeptForCleanup(session) ? 'error' : 'active';
  // A node shell runs in a debug pod the app created on that node.
  const pod = session.debugPod ?? session.target;
  const [clusterField, ...podFields] = sessionIdentityFields({
    clusterName: session.clusterName,
    clusterId: session.clusterId,
    namespace: pod.namespace,
    podName: pod.name,
  });
  const fields = [
    clusterField,
    ...(session.debugPod ? [{ label: 'node', value: session.target.name || '-' }] : []),
    ...podFields,
    { label: 'container', value: session.container || '-' },
    { label: 'shell', value: session.command?.[0] || '/bin/sh' },
  ];
  return (
    <div className="ss-session-item as-shell-session">
      <button
        type="button"
        className="as-shell-session-jump"
        onClick={() => onOpen(session)}
        title="Click to open this shell session"
        aria-label={`Open shell session tab for ${session.target.name || 'pod'}`}
      >
        <div className="ss-session-main">
          <div className="ss-session-fields as-pf-fields">
            <SessionFields fields={fields} status={sessionStatus} />
          </div>
          {!!session.statusReason && (
            <div className="pf-session-reason as-pf-reason">{session.statusReason}</div>
          )}
        </div>
        <span className="as-shell-open-affordance" aria-hidden="true">
          <OpenIcon width={14} height={14} />
        </span>
      </button>
      <div className="ss-session-actions as-pf-actions">
        <button
          type="button"
          className="as-compact-icon-action as-warning"
          onClick={() => void onEnd(session.sessionId)}
          disabled={isEnding}
          title="End shell session"
          aria-label="End shell session"
        >
          {isEnding ? '…' : <StopSquareIcon />}
        </button>
      </div>
    </div>
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
  const fields = sessionIdentityFields({
    clusterName: session.clusterName,
    clusterId: session.clusterId,
    namespace: session.target.namespace,
    podName: session.podName,
  });
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

// Marks a session's action control pending while the backend call runs. Row
// removal arrives through backend list events, not from this call's result.
const runPendingSessionAction = async (
  setPending: React.Dispatch<React.SetStateAction<Set<string>>>,
  sessionId: string,
  action: string,
  run: (sessionId: string) => Promise<void>
) => {
  setPending((prev) => new Set(prev).add(sessionId));
  try {
    await run(sessionId);
  } catch (err) {
    errorHandler.handle(err, { action, sessionId, source: 'SessionsStatus' });
  } finally {
    setPending((prev) => {
      const next = new Set(prev);
      next.delete(sessionId);
      return next;
    });
  }
};

const SessionsStatus: React.FC = () => {
  const { openWithObject } = useObjectPanel();
  const { selectedClusterId } = useKubeconfig();
  const { shellSessions: filteredShellSessions, portForwardSessions: filteredPortForwards } =
    useRuntimeOperationStatus(selectedClusterId);
  const [stoppingPortForwardIds, setStoppingPortForwardIds] = useState<Set<string>>(new Set());
  const [endingShellSessionIds, setEndingShellSessionIds] = useState<Set<string>>(new Set());
  const [statusPopoverCloseSignal, setStatusPopoverCloseSignal] = useState(0);

  const handleStopPortForward = useCallback(
    (sessionId: string) =>
      runPendingSessionAction(
        setStoppingPortForwardIds,
        sessionId,
        'stopPortForward',
        StopPortForward
      ),
    []
  );

  const handleEndShellSession = useCallback(
    (sessionId: string) =>
      runPendingSessionAction(
        setEndingShellSessionIds,
        sessionId,
        'closeShellSession',
        CloseShellSession
      ),
    []
  );

  const openShellSessionTab = useCallback(
    (session: ShellSessionInfo) => {
      try {
        const targetRef = buildRequiredObjectReference({
          ...session.target,
          clusterName: session.clusterName?.trim() || undefined,
        });
        openWithObject(targetRef);
        requestObjectPanelTab(objectPanelId(targetRef), 'shell');
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

  const handleJumpToShellSession = useCallback(
    (session: ShellSessionInfo) => {
      const targetClusterId = session.clusterId?.trim() || '';
      // Rows list the selected cluster's sessions; with no cluster selected,
      // a session's cluster is not open in this window.
      if (targetClusterId && selectedClusterId !== targetClusterId) {
        errorHandler.handle(new Error('Session cluster tab is not active.'), {
          action: 'jumpToShellSession',
          sessionId: session.sessionId,
          clusterId: targetClusterId,
          source: 'SessionsStatus',
        });
        return;
      }
      openShellSessionTab(session);
    },
    [openShellSessionTab, selectedClusterId]
  );

  const shellCount = filteredShellSessions.length;
  const portForwardCount = filteredPortForwards.length;

  const totalCount = shellCount + portForwardCount;
  const totalHealthy =
    filteredShellSessions.filter((session) => !isKeptForCleanup(session)).length +
    filteredPortForwards.filter((session) => session.status === 'active').length;
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
                        isEnding={endingShellSessionIds.has(session.sessionId)}
                        onOpen={handleJumpToShellSession}
                        onEnd={handleEndShellSession}
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
      endingShellSessionIds,
      filteredPortForwards,
      filteredShellSessions,
      handleEndShellSession,
      handleJumpToShellSession,
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
      closeSignal={statusPopoverCloseSignal}
    />
  );
};

export default React.memo(SessionsStatus);
