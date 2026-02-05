/**
 * frontend/src/modules/port-forward/PortForwardsPanel.test.tsx
 *
 * Tests for PortForwardsPanel component.
 * Covers session listing, status updates, stop functionality, and event handling.
 */

import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the Wails backend
const listPortForwardsMock = vi.hoisted(() => vi.fn());
const stopPortForwardMock = vi.hoisted(() => vi.fn());

vi.mock('@wailsjs/go/backend/App', () => ({
  ListPortForwards: (...args: unknown[]) => listPortForwardsMock(...args),
  StopPortForward: (...args: unknown[]) => stopPortForwardMock(...args),
}));

// Mock the Wails runtime events.
// EventsOn must return a cancel function — the component calls it on unmount.
const eventsOnCancels = vi.hoisted(() => new Map<string, ReturnType<typeof vi.fn>>());
const eventsOnMock = vi.hoisted(() =>
  vi.fn((...args: unknown[]) => {
    const name = args[0] as string;
    const cancel = vi.fn();
    eventsOnCancels.set(name, cancel);
    return cancel;
  })
);
const eventsOffMock = vi.hoisted(() => vi.fn());

vi.mock('@wailsjs/runtime/runtime', () => ({
  EventsOn: (...args: unknown[]) => eventsOnMock(...args),
  EventsOff: (...args: unknown[]) => eventsOffMock(...args),
}));

// Mock the error handler
const errorHandlerMock = vi.hoisted(() => ({
  handle: vi.fn(),
}));

vi.mock('@utils/errorHandler', () => ({
  errorHandler: errorHandlerMock,
}));

// Mock the DockablePanel
const panelStateMock = vi.hoisted(() => ({
  isOpen: true,
  setOpen: vi.fn(),
  toggle: vi.fn(),
  position: 'right' as const,
  setPosition: vi.fn(),
  size: { width: 350, height: 400 },
  setSize: vi.fn(),
  floatingPosition: { x: 100, y: 100 },
  setFloatingPosition: vi.fn(),
}));

vi.mock('@/components/dockable', () => ({
  DockablePanel: ({ children, title }: { children: React.ReactNode; title: string }) => (
    <div data-testid="dockable-panel" data-title={title}>
      {children}
    </div>
  ),
  useDockablePanelState: () => panelStateMock,
}));

import PortForwardsPanel from './PortForwardsPanel';

describe('PortForwardsPanel', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  // Sample session data
  const mockSessions = [
    {
      id: 'session-1',
      clusterId: 'cluster-1',
      clusterName: 'production',
      namespace: 'default',
      podName: 'nginx-abc123',
      containerPort: 80,
      localPort: 8080,
      targetKind: 'Deployment',
      targetName: 'nginx',
      status: 'active',
      startedAt: '2024-01-01T00:00:00Z',
    },
    {
      id: 'session-2',
      clusterId: 'cluster-1',
      clusterName: 'production',
      namespace: 'kube-system',
      podName: 'coredns-xyz789',
      containerPort: 53,
      localPort: 8053,
      targetKind: 'Service',
      targetName: 'kube-dns',
      status: 'error',
      statusReason: 'Connection lost',
      startedAt: '2024-01-01T00:00:01Z',
    },
  ];

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);

    vi.clearAllMocks();
    eventsOnCancels.clear();
    listPortForwardsMock.mockResolvedValue([]);
    stopPortForwardMock.mockResolvedValue(undefined);
    panelStateMock.isOpen = true;
    panelStateMock.setOpen.mockClear();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    // Clear body by removing all children instead of using innerHTML
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
  });

  /**
   * Helper to render the panel
   */
  const renderPanel = async () => {
    await act(async () => {
      root.render(<PortForwardsPanel />);
      await Promise.resolve();
    });
  };

  /**
   * Helper to flush promises and timers
   */
  const flushPromises = async () => {
    await act(async () => {
      await Promise.resolve();
    });
  };

  it('renders empty state when no forwards', async () => {
    await renderPanel();
    await flushPromises();

    const emptyState = document.querySelector('.pf-empty');
    expect(emptyState).toBeTruthy();
    expect(emptyState?.textContent).toContain('No active port forwards');
  });

  it('renders dockable panel with correct title', async () => {
    await renderPanel();

    const panel = document.querySelector('[data-testid="dockable-panel"]');
    expect(panel).toBeTruthy();
    expect(panel?.getAttribute('data-title')).toBe('Port Forwards');
  });

  it('loads sessions when panel opens', async () => {
    listPortForwardsMock.mockResolvedValue(mockSessions);

    await renderPanel();
    await flushPromises();

    expect(listPortForwardsMock).toHaveBeenCalled();
  });

  it('renders session cards with correct info', async () => {
    listPortForwardsMock.mockResolvedValue(mockSessions);

    await renderPanel();
    await flushPromises();

    // Check session cards are rendered
    const sessionCards = document.querySelectorAll('.pf-session-card');
    expect(sessionCards.length).toBe(2);

    // Check first session (active)
    const activeCard = document.querySelector('.pf-session-active');
    expect(activeCard).toBeTruthy();
    expect(activeCard?.textContent).toContain('nginx');
    expect(activeCard?.textContent).toContain('80');
    expect(activeCard?.textContent).toContain('localhost:8080');
    expect(activeCard?.textContent).toContain('production');
    expect(activeCard?.textContent).toContain('default');

    // Check error session
    const errorCard = document.querySelector('.pf-session-error');
    expect(errorCard).toBeTruthy();
    expect(errorCard?.textContent).toContain('Connection lost');
  });

  it('sorts sessions by status priority (active first)', async () => {
    // Return sessions in opposite order (error first)
    listPortForwardsMock.mockResolvedValue([mockSessions[1], mockSessions[0]]);

    await renderPanel();
    await flushPromises();

    const sessionCards = document.querySelectorAll('.pf-session-card');
    // Active should be first due to sorting
    expect(sessionCards[0].classList.contains('pf-session-active')).toBe(true);
    expect(sessionCards[1].classList.contains('pf-session-error')).toBe(true);
  });

  it('shows stop button for active sessions', async () => {
    listPortForwardsMock.mockResolvedValue([mockSessions[0]]);

    await renderPanel();
    await flushPromises();

    const stopButton = document.querySelector('.button.warning');
    expect(stopButton).toBeTruthy();
    expect(stopButton?.textContent).toBe('Stop');
  });

  it('shows remove button for error sessions', async () => {
    listPortForwardsMock.mockResolvedValue([mockSessions[1]]);

    await renderPanel();
    await flushPromises();

    const removeButton = document.querySelector('.button.danger');
    expect(removeButton).toBeTruthy();
    expect(removeButton?.textContent).toBe('Remove');
  });

  it('calls stop when stop button clicked', async () => {
    listPortForwardsMock.mockResolvedValue([mockSessions[0]]);

    await renderPanel();
    await flushPromises();

    const stopButton = document.querySelector('.button.warning') as HTMLButtonElement;
    expect(stopButton).toBeTruthy();

    await act(async () => {
      stopButton.click();
      await Promise.resolve();
    });

    expect(stopPortForwardMock).toHaveBeenCalledWith('session-1');
  });

  it('handles stop errors gracefully', async () => {
    listPortForwardsMock.mockResolvedValue([mockSessions[0]]);
    stopPortForwardMock.mockRejectedValue(new Error('Stop failed'));

    await renderPanel();
    await flushPromises();

    const stopButton = document.querySelector('.button.warning') as HTMLButtonElement;

    await act(async () => {
      stopButton.click();
      await Promise.resolve();
    });

    expect(errorHandlerMock.handle).toHaveBeenCalled();
  });

  it('disables stop button while stopping', async () => {
    listPortForwardsMock.mockResolvedValue([mockSessions[0]]);
    // Make stop hang to simulate loading state
    stopPortForwardMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(resolve, 5000);
        })
    );

    vi.useFakeTimers();

    await renderPanel();
    await flushPromises();

    const stopButton = document.querySelector('.button.warning') as HTMLButtonElement;

    await act(async () => {
      stopButton.click();
      await Promise.resolve();
    });

    // Button should show loading state
    expect(stopButton.textContent).toBe('...');
    expect(stopButton.disabled).toBe(true);

    vi.useRealTimers();
  });

  it('registers event listeners on mount', async () => {
    await renderPanel();

    expect(eventsOnMock).toHaveBeenCalledWith('portforward:list', expect.any(Function));
    expect(eventsOnMock).toHaveBeenCalledWith('portforward:status', expect.any(Function));
  });

  it('unregisters event listeners on unmount', async () => {
    await renderPanel();

    const cancelList = eventsOnCancels.get('portforward:list');
    const cancelStatus = eventsOnCancels.get('portforward:status');

    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });

    // Component calls the cancel functions returned by EventsOn, not EventsOff.
    expect(cancelList).toHaveBeenCalled();
    expect(cancelStatus).toHaveBeenCalled();
  });

  it('updates sessions when list event received', async () => {
    await renderPanel();
    await flushPromises();

    // Initially empty
    expect(document.querySelector('.pf-empty')).toBeTruthy();

    // Find the list event handler
    const listHandler = eventsOnMock.mock.calls.find(
      (call) => call[0] === 'portforward:list'
    )?.[1] as ((...args: unknown[]) => void) | undefined;

    expect(listHandler).toBeTruthy();

    // Simulate receiving new sessions
    await act(async () => {
      listHandler!(mockSessions);
      await Promise.resolve();
    });

    // Should now show sessions
    expect(document.querySelector('.pf-empty')).toBeNull();
    expect(document.querySelectorAll('.pf-session-card').length).toBe(2);
  });

  it('updates session status when status event received', async () => {
    listPortForwardsMock.mockResolvedValue([mockSessions[0]]);

    await renderPanel();
    await flushPromises();

    // Initially active
    expect(document.querySelector('.pf-session-active')).toBeTruthy();

    // Find the status event handler
    const statusHandler = eventsOnMock.mock.calls.find(
      (call) => call[0] === 'portforward:status'
    )?.[1] as ((...args: unknown[]) => void) | undefined;

    expect(statusHandler).toBeTruthy();

    // Simulate status change to reconnecting
    await act(async () => {
      statusHandler!({
        sessionId: 'session-1',
        status: 'reconnecting',
        statusReason: 'Pod restarted',
      });
      await Promise.resolve();
    });

    // Should now show reconnecting status
    expect(document.querySelector('.pf-session-reconnecting')).toBeTruthy();
    expect(document.querySelector('.pf-session-active')).toBeNull();
    expect(document.querySelector('.pf-session-reason')?.textContent).toContain('Pod restarted');
  });

  it('does not load sessions when panel is closed', async () => {
    panelStateMock.isOpen = false;

    await renderPanel();
    await flushPromises();

    expect(listPortForwardsMock).not.toHaveBeenCalled();
  });

  it('handles load errors gracefully', async () => {
    listPortForwardsMock.mockRejectedValue(new Error('Load failed'));

    await renderPanel();
    await flushPromises();

    expect(errorHandlerMock.handle).toHaveBeenCalledWith(expect.any(Error), {
      action: 'loadPortForwards',
    });
  });

  it('renders status icons correctly', async () => {
    const sessionsWithVariousStatus = [
      { ...mockSessions[0], status: 'active' },
      { ...mockSessions[0], id: 'session-3', status: 'reconnecting' },
      { ...mockSessions[0], id: 'session-4', status: 'error' },
    ];
    listPortForwardsMock.mockResolvedValue(sessionsWithVariousStatus);

    await renderPanel();
    await flushPromises();

    expect(document.querySelector('.pf-status-active')).toBeTruthy();
    expect(document.querySelector('.pf-status-reconnecting')).toBeTruthy();
    expect(document.querySelector('.pf-status-error')).toBeTruthy();
  });

  it('shows port mapping information correctly', async () => {
    listPortForwardsMock.mockResolvedValue([mockSessions[0]]);

    await renderPanel();
    await flushPromises();

    // Check target port display
    const targetPort = document.querySelector('.pf-target-port');
    expect(targetPort?.textContent).toContain('nginx:80');

    // Check local port display
    const localPort = document.querySelector('.pf-local-port');
    expect(localPort?.textContent).toContain('localhost:8080');
  });

  it('auto-opens panel when first session is added', async () => {
    // Start with panel closed
    panelStateMock.isOpen = false;

    await renderPanel();
    await flushPromises();

    // Find the list event handler
    const listHandler = eventsOnMock.mock.calls.find(
      (call) => call[0] === 'portforward:list'
    )?.[1] as ((...args: unknown[]) => void) | undefined;

    // Simulate receiving first session (0 -> 1)
    await act(async () => {
      listHandler!([mockSessions[0]]);
      await Promise.resolve();
    });

    // Panel should be opened
    expect(panelStateMock.setOpen).toHaveBeenCalledWith(true);
  });
});
