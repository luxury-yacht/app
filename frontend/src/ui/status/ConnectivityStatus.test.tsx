import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClusterAuthState } from '@/core/contexts/AuthErrorContext';
import type { ReactNode } from 'react';
import type { StatusIndicatorAction } from '@shared/components/status/StatusIndicator';

let mockLifecycleState = 'ready';
let mockNamespaceReady = true;
let mockHealth: 'healthy' | 'degraded' | 'unknown' = 'healthy';
let mockSelectedClusterId = 'cluster-a';
let mockSelectedClusterName = 'alpha';
let mockAutoRefreshEnabled = true;
const setAutoRefreshEnabledMock = vi.hoisted(() => vi.fn());
let mockAuthState: ClusterAuthState = {
  hasError: false,
  isRecovering: false,
  reason: '',
  clusterName: '',
  currentAttempt: 0,
  maxAttempts: 0,
  secondsUntilRetry: 0,
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
      data-status={status}
      data-action-label={actionLabel ?? ''}
      data-actions={(actions ?? []).map((action) => action.label).join('|')}
      aria-label={ariaLabel}
    >
      {message}
    </div>
  ),
}));

vi.mock('@/core/refresh', () => ({
  refreshOrchestrator: {
    triggerManualRefreshForContext: vi.fn(),
  },
}));

vi.mock('@/hooks/useWailsRuntimeEvents', () => ({
  useClusterHealthListener: () => ({
    getActiveClusterHealth: () => mockHealth,
  }),
}));

vi.mock('@/core/contexts/AuthErrorContext', () => ({
  useAuthError: () => ({
    handleRetry: vi.fn(),
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
    on: vi.fn(() => () => {}),
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

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
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
      currentAttempt: 0,
      maxAttempts: 0,
      secondsUntilRetry: 0,
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
  });

  it('shows auth failure details and retry action', () => {
    mockLifecycleState = 'auth_failed';
    mockAuthState = {
      hasError: true,
      isRecovering: false,
      reason: 'token expired',
      clusterName: 'alpha',
      currentAttempt: 0,
      maxAttempts: 0,
      secondsUntilRetry: 0,
    };

    const indicator = renderStatus();

    expect(indicator?.getAttribute('data-status')).toBe('unhealthy');
    expect(indicator?.getAttribute('data-actions')).toBe('Retry Auth|Disable Auto-Refresh');
    expect(indicator?.textContent).toContain('Authentication failed');
    expect(indicator?.textContent).toContain('token expired');
  });

  it('shows enable auto-refresh when auto-refresh is paused', () => {
    mockAutoRefreshEnabled = false;

    const indicator = renderStatus();

    expect(indicator?.getAttribute('data-actions')).toBe('Refresh Now|Enable Auto-Refresh');
  });
});
