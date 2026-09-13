/**
 * frontend/src/ui/overlays/AuthFailureOverlay.test.tsx
 *
 * Tests credential recovery decisions and redaction in the auth failure overlay.
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

  it('identifies the missing credential helper', async () => {
    await renderContent({
      ...baseState,
      execCommand: 'gke-gcloud-auth-plugin',
      diagnosticKind: 'missing-helper',
    });

    const code = container.querySelector('code');
    expect(code?.textContent).toBe('gke-gcloud-auth-plugin');
  });

  it('prefers the sanitized summary and never leaks raw provider stderr', async () => {
    await renderContent({
      ...baseState,
      reason:
        'getting credentials: exec: executable aws failed: SSO token at https://secret.example expired',
      diagnosticSummary: 'The cluster credentials have expired.',
      diagnosticKind: 'expired-credentials',
      execCommand: 'aws',
    });

    expect(container.textContent).toContain('The cluster credentials have expired.');
    expect(container.textContent).not.toContain('secret.example');
    expect(container.textContent).toMatch(/refresh.*credentials/i);
    expect(container.textContent).not.toContain('Install that command');
  });

  it('does not diagnose a missing command when the helper ran and failed', async () => {
    await renderContent({
      ...baseState,
      execCommand: 'aws',
      diagnosticKind: 'helper-failed',
      diagnosticSummary: "The kubeconfig's credential helper failed to run.",
    });

    expect(container.textContent).toContain("The kubeconfig's credential helper failed to run.");
    expect(container.textContent).not.toContain('Install that command');
  });

  it('directs credential refresh when the SSO token is missing', async () => {
    await renderContent({
      ...baseState,
      execCommand: 'aws',
      diagnosticKind: 'missing-credentials',
      diagnosticSummary: 'The authentication token or SSO session is missing.',
    });

    expect(container.textContent).toMatch(/SSO session is missing/);
    expect(container.textContent).toMatch(/refresh your credentials/i);
    expect(container.textContent).not.toContain('Install that command');
  });
});
