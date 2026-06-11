/**
 * frontend/src/components/overlays/AuthFailureOverlay.tsx
 *
 * Per-cluster authentication failure overlay.
 * Blocks access to the sidebar and main content when the active cluster
 * has an authentication failure. Shows retry status and a manual retry button.
 */

import React, { useCallback } from 'react';
import {
  useAuthError,
  useActiveClusterAuthState,
  isConfirmedAuthFailure,
  ClusterAuthState,
} from '@/core/contexts/AuthErrorContext';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import './AuthFailureOverlay.css';

interface AuthFailureOverlayContentProps {
  authState: ClusterAuthState;
  clusterId: string;
  onRetry: () => void;
}

/**
 * Content for the auth failure overlay.
 * Shows different messages based on whether recovery is in progress.
 */
const AuthFailureOverlayContent: React.FC<AuthFailureOverlayContentProps> = ({
  authState,
  clusterId,
  onRetry,
}) => {
  const clusterName = authState.clusterName || clusterId;
  const { secondsUntilRetry } = authState;

  // The recovery loop never stops, so the message is the same throughout:
  // the cluster reconnects on its own once the problem is resolved, and the
  // countdown says when the next automatic recheck happens.
  const recheckMessage =
    secondsUntilRetry > 0
      ? `Next retry in ${secondsUntilRetry} second${secondsUntilRetry !== 1 ? 's' : ''}.`
      : 'Rechecking now…';

  return (
    <div className="auth-failure-overlay-content">
      <div className="auth-failure-icon">⚠️</div>
      <h2 className="auth-failure-title">Authentication Failure</h2>
      <p className="auth-failure-cluster">Cluster: {clusterName}</p>
      {authState.reason && <p className="auth-failure-reason">{authState.reason}</p>}
      <p className="auth-failure-message">
        The app will attempt to reconnect automatically, but you may need to refresh your
        credentials.
      </p>
      <p className="auth-failure-message">{recheckMessage}</p>
      <button className="button generic" onClick={onRetry}>
        Retry Now
      </button>
    </div>
  );
};

/**
 * Auth failure overlay component.
 * Only renders when the active cluster has a CONFIRMED authentication failure
 * — a terminal failure or a recovery probe rejected by the cluster. A cluster
 * that is merely unreachable (connectivity verdict, or no verdict yet) is a
 * waiting state surfaced non-blockingly via the connectivity indicator.
 * Blocks access to sidebar and main content until auth is resolved.
 */
export const AuthFailureOverlay: React.FC = () => {
  const { selectedClusterId } = useKubeconfig();
  const { handleRetry } = useAuthError();
  const authState = useActiveClusterAuthState(selectedClusterId);

  const onRetry = useCallback(() => {
    if (selectedClusterId) {
      void handleRetry(selectedClusterId);
    }
  }, [selectedClusterId, handleRetry]);

  // Don't render unless the active cluster's failure is a confirmed auth problem.
  if (!isConfirmedAuthFailure(authState)) {
    return null;
  }

  return (
    <div className="auth-failure-overlay" role="alertdialog" aria-modal="true">
      <AuthFailureOverlayContent
        authState={authState}
        clusterId={selectedClusterId}
        onRetry={onRetry}
      />
    </div>
  );
};
