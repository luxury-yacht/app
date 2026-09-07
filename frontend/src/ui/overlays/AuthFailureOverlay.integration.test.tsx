import {
  ClusterHealthState,
  ClusterLifecycleState,
} from '@bindings/github.com/luxury-yacht/app/backend/models';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { GetClusterWorkspaceStateForWindow, RetryClusterAuth } from '@/core/backend-api';
import { clusterWorkspaceStore } from '@/core/cluster-workspace/clusterWorkspaceStore';
import { AuthErrorProvider } from '@/core/contexts/AuthErrorContext';
import { requireValue } from '@/test-utils/requireValue';
import { AuthFailureOverlay } from './AuthFailureOverlay';

const selection = vi.hoisted(() => ({ clusterId: 'expired' }));
vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({ selectedClusterId: selection.clusterId }),
}));
vi.mock('@/core/desktop-runtime', () => ({ onEvent: () => () => undefined }));
vi.mock('@/core/backend-api', () => ({
  GetClusterWorkspaceStateForWindow: vi.fn(),
  RetryClusterAuth: vi.fn().mockResolvedValue(undefined),
}));

it('hydrates a restored auth failure, retries its cluster, and leaves the healthy sibling accessible', async () => {
  clusterWorkspaceStore.resetForTests();
  vi.mocked(GetClusterWorkspaceStateForWindow).mockResolvedValue({
    selectedKubeconfigs: ['expired', 'healthy'],
    visibleClusterId: 'expired',
    clusters: {
      expired: {
        clusterId: 'expired',
        clusterName: 'SSO cluster',
        lifecycle: ClusterLifecycleState.ClusterStateConnecting,
        health: ClusterHealthState.ClusterHealthUnknown,
        scopeRevision: 0,
        auth: {
          state: 'recovering',
          errorClass: 'auth',
          secondsUntilRetry: 6,
          class: 'auth',
          kind: 'expired-credentials',
          summary: 'The authentication token or SSO session has expired.',
          execCommand: 'aws',
          reason: 'exec plugin failed with exit code 255',
        },
      },
      healthy: {
        clusterId: 'healthy',
        clusterName: 'Healthy cluster',
        lifecycle: ClusterLifecycleState.ClusterStateReady,
        health: ClusterHealthState.ClusterHealthHealthy,
        scopeRevision: 0,
        auth: {
          state: 'valid',
          reason: '',
          errorClass: '',
          secondsUntilRetry: 0,
          class: '',
          kind: '',
          summary: '',
          execCommand: '',
        },
      },
    },
  });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const render = async () => {
    await act(async () => {
      root.render(
        <AuthErrorProvider>
          <AuthFailureOverlay />
        </AuthErrorProvider>
      );
    });
  };
  try {
    await render();
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(container.textContent).toContain('SSO cluster');
    expect(container.textContent).toContain('SSO session has expired');
    expect(container.textContent).not.toContain('Install that command');
    await act(async () => {
      requireValue(container.querySelector('button'), 'auth retry button').click();
    });
    expect(RetryClusterAuth).toHaveBeenCalledExactlyOnceWith('expired');
    selection.clusterId = 'healthy';
    await render();
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
    selection.clusterId = 'expired';
    await render();
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull();
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
