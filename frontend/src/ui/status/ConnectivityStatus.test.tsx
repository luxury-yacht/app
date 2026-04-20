import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

let mockLifecycleState = 'ready';
let mockNamespaceReady = true;
let mockHealth: 'healthy' | 'degraded' | 'unknown' = 'healthy';
let mockSelectedClusterId = 'cluster-a';

vi.mock('@shared/components/status/StatusIndicator', () => ({
  __esModule: true,
  default: ({
    status,
    message,
    actionLabel,
    ariaLabel,
  }: {
    status: string;
    message: string;
    actionLabel?: string;
    ariaLabel: string;
  }) => (
    <div
      data-testid="indicator"
      data-status={status}
      data-message={message}
      data-action-label={actionLabel ?? ''}
      aria-label={ariaLabel}
    />
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
  useActiveClusterAuthState: () => ({
    hasError: false,
    isRecovering: false,
    reason: '',
  }),
}));

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({
    selectedClusterId: mockSelectedClusterId,
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
  getAutoRefreshEnabled: () => true,
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
    expect(indicator?.getAttribute('data-message')).toBe('Loading namespaces...');
    expect(indicator?.getAttribute('aria-label')).toBe('Connectivity: Loading namespaces...');
  });

  it('shows ready once namespaces are available', () => {
    const indicator = renderStatus();

    expect(indicator?.getAttribute('data-status')).toBe('healthy');
    expect(indicator?.getAttribute('data-message')).toBe('Ready');
    expect(indicator?.getAttribute('aria-label')).toBe('Connectivity: Ready');
  });
});
