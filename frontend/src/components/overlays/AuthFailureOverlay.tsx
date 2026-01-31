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
  const { isRecovering, currentAttempt, maxAttempts, secondsUntilRetry } = authState;

  // Build the retry status message
  const getRetryStatusMessage = () => {
    if (!isRecovering) {
      return 'Auto-retry attempts failed. Click the Retry button when the problem has been resolved.';
    }

    if (secondsUntilRetry > 0) {
      return `Retrying in ${secondsUntilRetry} second${secondsUntilRetry !== 1 ? 's' : ''}...`;
    }

    return 'Retrying now...';
  };

  // Build the attempt counter text
  const getAttemptText = () => {
    if (!isRecovering || maxAttempts === 0) {
      return null;
    }
    return `Attempt ${currentAttempt} of ${maxAttempts}`;
  };

  const attemptText = getAttemptText();

  return (
    <div className="auth-failure-overlay-content">
      <div className="auth-failure-icon">⚠️</div>
      <h2 className="auth-failure-title">Authentication Failure</h2>
      <p className="auth-failure-cluster">Cluster: {clusterName}</p>

      <p className={`auth-failure-message ${isRecovering ? 'auth-failure-recovering' : ''}`}>
        {getRetryStatusMessage()}
      </p>

      {attemptText && <p className="auth-failure-attempts">{attemptText}</p>}

      {authState.reason && <p className="auth-failure-reason">{authState.reason}</p>}

      <button className="button generic" onClick={onRetry}>
        Retry Now
      </button>
    </div>
  );
};

/**
 * Auth failure overlay component.
 * Only renders when the active cluster has an authentication failure.
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

  // Don't render if no auth error for the active cluster
  if (!authState.hasError) {
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

export default AuthFailureOverlay;
