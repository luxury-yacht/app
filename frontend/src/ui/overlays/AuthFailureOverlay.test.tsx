/**
 * frontend/src/ui/overlays/AuthFailureOverlay.test.tsx
 *
 * Tests the presentational copy of the auth failure overlay, in particular the
 * kubeconfig-centered exec-credential guidance and the avoidance of raw
 * provider stderr in the default copy.
 */

import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ClusterAuthState } from '@/core/contexts/AuthErrorContext';
import { AuthFailureOverlayContent } from './AuthFailureOverlay';

const baseState: ClusterAuthState = {
  hasError: true,
  reason: 'Authentication failed',
  clusterName: 'prod',
  isRecovering: false,
  secondsUntilRetry: 0,
  errorClass: 'auth',
  execCommand: '',
  diagnosticKind: '',
  diagnosticSummary: '',
};

describe('AuthFailureOverlayContent', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const renderContent = async (authState: ClusterAuthState) => {
    await act(async () => {
      root.render(
        <AuthFailureOverlayContent authState={authState} clusterId="c1" onRetry={() => undefined} />
      );
    });
  };

  it('renders kubeconfig-centered copy naming the exec command', async () => {
    await renderContent({ ...baseState, execCommand: 'gke-gcloud-auth-plugin' });

    expect(container.textContent).toContain('This kubeconfig asks Kubernetes to run');
    const code = container.querySelector('code');
    expect(code?.textContent).toBe('gke-gcloud-auth-plugin');
  });

  it('prefers the sanitized summary and never leaks raw provider stderr', async () => {
    await renderContent({
      ...baseState,
      reason:
        'getting credentials: exec: executable aws failed: SSO token at https://secret.example expired',
      diagnosticSummary: 'The cluster credentials have expired.',
    });

    expect(container.textContent).toContain('The cluster credentials have expired.');
    expect(container.textContent).not.toContain('secret.example');
  });

  it('falls back to generic copy when there is no exec command', async () => {
    await renderContent(baseState);

    expect(container.textContent).not.toContain('This kubeconfig asks Kubernetes to run');
    expect(container.textContent).toContain('Retry Now');
  });
});
