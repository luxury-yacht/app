/**
 * frontend/src/components/overlays/AuthFailureOverlay.tsx
 *
 * Per-cluster authentication failure overlay.
 * Blocks access to the sidebar and main content when the active cluster
 * has an authentication failure. Shows retry status and a manual retry button.
 */

import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import type React from 'react';
import { useCallback } from 'react';
import {
  type ClusterAuthState,
  isConfirmedAuthFailure,
  useActiveClusterAuthState,
  useAuthError,
} from '@/core/contexts/AuthErrorContext';
import './AuthFailureOverlay.css';

interface AuthFailureOverlayContentProps {
  authState: ClusterAuthState;
  clusterId: string;
  onRetry: () => void;
}

/**
 * Content for the auth failure overlay.
 * Shows different messages based on whether recovery is in progress.
 * Exported for unit testing of the presentational copy.
 */
export const AuthFailureOverlayContent: React.FC<AuthFailureOverlayContentProps> = ({
  authState,
  clusterId,
  onRetry,
}) => {
  const clusterName = authState.clusterName || clusterId;
  const { secondsUntilRetry, execCommand, diagnosticSummary, reason } = authState;

  // The recovery loop never stops, so the message is the same throughout:
  // the cluster reconnects on its own once the problem is resolved, and the
  // countdown says when the next automatic recheck happens.
  const recheckMessage =
    secondsUntilRetry > 0
      ? `Next retry in ${secondsUntilRetry} second${secondsUntilRetry !== 1 ? 's' : ''}.`
      : 'Rechecking now…';

  // Prefer the sanitized, provider-neutral summary over the raw reason, which
  // may contain provider stderr. Fall back to the raw reason only when no
  // summary is available.
  const detail = diagnosticSummary || reason;

  return (
    <div className="auth-failure-overlay-content">
      <div className="auth-failure-icon">⚠️</div>
      <h2 className="auth-failure-title">Authentication Failure</h2>
      <p className="auth-failure-cluster">Cluster: {clusterName}</p>
      {execCommand ? (
        // The kubeconfig declares an exec credential plugin the app could not
        // run. Point at the kubeconfig contract, not at any specific provider.
        <p className="auth-failure-message">
          This kubeconfig asks Kubernetes to run{' '}
          <code className="auth-failure-command">{execCommand}</code> for credentials. Install that
          command, add it to your PATH, or update the kubeconfig, then retry.
        </p>
      ) : (
        <>
          {detail && <p className="auth-failure-reason">{detail}</p>}
          <p className="auth-failure-message">
            The app will attempt to reconnect automatically, but you may need to refresh your
            credentials.
          </p>
        </>
      )}
      <p className="auth-failure-message">{recheckMessage}</p>
      <button type="button" className="button generic" onClick={onRetry}>
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
