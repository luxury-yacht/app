import type { StatusIndicatorAction } from '@shared/components/status/StatusIndicator';
import type { ReactNode } from 'react';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClusterAuthState } from '@/core/contexts/AuthErrorContext';
import { requireValue } from '@/test-utils/requireValue';

let mockLifecycleState = 'ready';
let mockNamespaceReady = true;
let mockHealth: 'healthy' | 'degraded' | 'unknown' = 'healthy';
let mockSelectedClusterId = 'cluster-a';
let mockSelectedClusterName = 'alpha';
let mockAutoRefreshEnabled = true;
const { setAutoRefreshEnabledMock, retryAuthMock, requestRefreshMock } = vi.hoisted(() => ({
  setAutoRefreshEnabledMock: vi.fn(),
  retryAuthMock: vi.fn(),
  requestRefreshMock: vi.fn(),
}));
let mockAuthState: ClusterAuthState = {
  hasError: false,
  isRecovering: false,
  reason: '',
  clusterName: '',
  secondsUntilRetry: 0,
  errorClass: '',
  execCommand: '',
  diagnosticKind: '',
  diagnosticSummary: '',
};

vi.mock('@shared/components/status/StatusIndicator', () => ({
  __esModule: true,
  default: ({
    status,
    message,
    actionLabel,
    actions,
    ariaLabel,
  }: {
    status: string;
    message: ReactNode;
    actionLabel?: string;
    actions?: StatusIndicatorAction[];
    ariaLabel: string;
  }) => (
    <div
      data-testid="indicator"
      role="status"
      data-status={status}
      data-action-label={actionLabel ?? ''}
      data-actions={(actions ?? []).map((action) => action.label).join('|')}
      aria-label={ariaLabel}
    >
      {message}
      {(actions ?? []).map((action) => (
        <button type="button" key={action.label} onClick={action.onClick}>
          {action.label}
        </button>
      ))}
    </div>
  ),
}));

vi.mock('@/core/data-access', () => ({
  requestContextRefresh: requestRefreshMock,
}));

vi.mock('@/hooks/useWailsRuntimeEvents', () => ({
  useClusterHealthListener: () => ({
    getActiveClusterHealth: () => mockHealth,
  }),
}));

vi.mock('@/core/contexts/AuthErrorContext', () => ({
  useAuthError: () => ({
    handleRetry: retryAuthMock,
  }),
  useActiveClusterAuthState: () => mockAuthState,
}));

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({
    selectedClusterId: mockSelectedClusterId,
    selectedClusterName: mockSelectedClusterName,
  }),
}));

vi.mock('@core/contexts/ClusterLifecycleContext', () => ({
  useClusterLifecycle: () => ({
    getClusterState: () => mockLifecycleState,
  }),
}));

vi.mock('@/core/events', () => ({
  eventBus: {
    on: vi.fn(() => () => undefined),
  },
}));

vi.mock('@/core/settings/appPreferences', () => ({
  getAutoRefreshEnabled: () => mockAutoRefreshEnabled,
  setAutoRefreshEnabled: setAutoRefreshEnabledMock,
}));

vi.mock('@modules/namespace/contexts/NamespaceContext', () => ({
  useNamespace: () => ({
    namespaceReady: mockNamespaceReady,
  }),
}));

import ConnectivityStatus from './ConnectivityStatus';

describe('ConnectivityStatus', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  it.each([true, false])(
    'offers no data-refresh action for a disconnected cluster when auto-refresh is %s',
    async (enabled) => {
      mockLifecycleState = 'disconnected';
      mockAutoRefreshEnabled = enabled;
      await act(async () => {
        root.render(<ConnectivityStatus />);
      });
      const indicator = container.querySelector('[data-testid="indicator"]');
      expect(indicator?.getAttribute('data-status')).toBe('unhealthy');
      expect(indicator?.getAttribute('data-actions')).not.toContain('Refresh Now');
      expect(indicator?.getAttribute('data-actions')).toContain(
        enabled ? 'Disable Auto-Refresh' : 'Enable Auto-Refresh'
      );
      act(() => requireValue(container.querySelector('button'), 'Auto-refresh toggle').click());
      expect(setAutoRefreshEnabledMock).toHaveBeenCalledWith(!enabled);
      expect(requestRefreshMock).not.toHaveBeenCalled();
      expect(retryAuthMock).not.toHaveBeenCalled();
    }
  );

  beforeEach(() => {
    setAutoRefreshEnabledMock.mockClear();
    retryAuthMock.mockClear();
    requestRefreshMock.mockClear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    mockLifecycleState = 'ready';
    mockNamespaceReady = true;
    mockHealth = 'healthy';
    mockSelectedClusterId = 'cluster-a';
    mockSelectedClusterName = 'alpha';
    mockAutoRefreshEnabled = true;
    mockAuthState = {
      hasError: false,
      isRecovering: false,
      reason: '',
      clusterName: '',
      secondsUntilRetry: 0,
      errorClass: '',
      execCommand: '',
      diagnosticKind: '',
      diagnosticSummary: '',
    };
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const renderStatus = () => {
    act(() => {
      root.render(<ConnectivityStatus />);
    });
    return container.querySelector('[data-testid="indicator"]') as HTMLDivElement | null;
  };

  it('keeps the status in loading until namespaces are ready to render', () => {
    mockNamespaceReady = false;

    const indicator = renderStatus();

    expect(indicator?.getAttribute('data-status')).toBe('refreshing');
    expect(indicator?.textContent).toContain('Loading namespaces');
    expect(indicator?.textContent).toContain('alpha is connected');
    expect(indicator?.getAttribute('data-actions')).toBe('Disable Auto-Refresh');
    expect(indicator?.getAttribute('aria-label')).toContain('Connectivity: Loading namespaces.');
  });

  it('shows ready once namespaces are available', () => {
    const indicator = renderStatus();

    expect(indicator?.getAttribute('data-status')).toBe('healthy');
    expect(indicator?.textContent).toContain('Ready');
    expect(indicator?.textContent).toContain('alpha is connected is ready to use.');
    expect(indicator?.getAttribute('data-actions')).toBe('Refresh Now|Disable Auto-Refresh');
    expect(indicator?.getAttribute('aria-label')).toContain('Connectivity: Ready.');
    act(() => requireValue(container.querySelector('button'), 'Refresh action').click());
    expect(requestRefreshMock).toHaveBeenCalledWith({ reason: 'user' });
    expect(retryAuthMock).not.toHaveBeenCalled();
  });

  it('shows auth failure details and retry action', () => {
    mockLifecycleState = 'auth_failed';
    mockAuthState = {
      hasError: true,
      isRecovering: false,
      reason: 'token expired',
      clusterName: 'alpha',
      secondsUntilRetry: 0,
      errorClass: 'auth',
      execCommand: '',
      diagnosticKind: '',
      diagnosticSummary: '',
    };

    const indicator = renderStatus();

    expect(indicator?.getAttribute('data-status')).toBe('unhealthy');
    expect(indicator?.getAttribute('data-actions')).toBe('Retry Auth|Disable Auto-Refresh');
    expect(indicator?.textContent).toContain('Authentication failed');
    expect(indicator?.textContent).toContain('token expired');
    act(() =>
      requireValue(container.querySelector('button'), 'Authentication retry action').click()
    );
    expect(retryAuthMock).toHaveBeenCalledWith('cluster-a');
    expect(requestRefreshMock).not.toHaveBeenCalled();
  });

  it('shows enable auto-refresh when auto-refresh is paused', () => {
    mockAutoRefreshEnabled = false;

    const indicator = renderStatus();

    expect(indicator?.getAttribute('data-actions')).toBe('Refresh Now|Enable Auto-Refresh');
  });
});
