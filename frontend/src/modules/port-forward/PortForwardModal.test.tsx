/**
 * frontend/src/modules/port-forward/PortForwardModal.test.tsx
 *
 * Tests for PortForwardModal component.
 * Covers modal rendering, port selection, form validation, and submission.
 */

import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import PortForwardModal from './PortForwardModal';
import type { PortForwardTarget } from './PortForwardModal';

// Mock the Wails backend
const startPortForwardMock = vi.hoisted(() => vi.fn());
const getTargetPortsMock = vi.hoisted(() => vi.fn());

vi.mock('@wailsjs/go/backend/App', () => ({
  StartPortForward: (...args: unknown[]) => startPortForwardMock(...args),
  GetTargetPorts: (...args: unknown[]) => getTargetPortsMock(...args),
}));

describe('PortForwardModal', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  const mockTarget: PortForwardTarget = {
    kind: 'Deployment',
    name: 'nginx',
    namespace: 'default',
    clusterId: 'cluster-1',
    clusterName: 'production',
    ports: [
      { port: 80, name: 'http' },
      { port: 443, name: 'https' },
    ],
  };

  const mockOnClose = vi.fn();
  const mockOnStarted = vi.fn();

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    vi.clearAllMocks();
    startPortForwardMock.mockResolvedValue('session-123');
    getTargetPortsMock.mockResolvedValue([]);
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
   * Helper to render the modal with provided props
   */
  const renderModal = async (
    props: Partial<React.ComponentProps<typeof PortForwardModal>> = {}
  ) => {
    const finalProps: React.ComponentProps<typeof PortForwardModal> = {
      target: mockTarget,
      onClose: mockOnClose,
      onStarted: mockOnStarted,
      ...props,
    };

    await act(async () => {
      root.render(<PortForwardModal {...finalProps} />);
      await Promise.resolve();
    });
  };

  it('renders nothing when target is null', async () => {
    await renderModal({ target: null });
    expect(document.querySelector('.port-forward-modal')).toBeNull();
  });

  it('renders modal with target info', async () => {
    await renderModal();

    expect(document.querySelector('.modal-header h2')?.textContent).toContain('Port Forward');

    // Check resource info
    const resourceInfoRows = document.querySelectorAll('.port-forward-resource-info-row');
    expect(resourceInfoRows.length).toBe(3);

    // Cluster row
    expect(resourceInfoRows[0].textContent).toContain('production');
    // Namespace row
    expect(resourceInfoRows[1].textContent).toContain('default');
    // Resource row
    expect(resourceInfoRows[2].textContent).toContain('Deployment/nginx');
  });

  it('renders port options when ports are provided', async () => {
    await renderModal();

    // Check port radio options
    const portOptions = document.querySelectorAll('.port-forward-port-option');
    expect(portOptions.length).toBe(2);

    // Check port numbers and names
    expect(portOptions[0].textContent).toContain('80');
    expect(portOptions[0].textContent).toContain('(http)');
    expect(portOptions[1].textContent).toContain('443');
    expect(portOptions[1].textContent).toContain('(https)');
  });

  it('selects first port by default', async () => {
    await renderModal();

    const radios = document.querySelectorAll<HTMLInputElement>(
      '.port-forward-port-option input[type="radio"]'
    );
    expect(radios.length).toBe(2);
    expect(radios[0].checked).toBe(true);
    expect(radios[1].checked).toBe(false);
  });

  it('sets default local port based on container port (privileged port gets +8000)', async () => {
    await renderModal();

    // Port 80 is < 1024, so default local port should be 80 + 8000 = 8080
    const localPortInput = document.querySelector<HTMLInputElement>('#port-forward-local-port');
    expect(localPortInput).toBeTruthy();
    expect(localPortInput?.value).toBe('8080');
  });

  it('updates local port when selecting different container port', async () => {
    await renderModal();

    // Initially port 80 is selected, local port should be 8080
    let localPortInput = document.querySelector<HTMLInputElement>('#port-forward-local-port');
    expect(localPortInput?.value).toBe('8080');

    // Select port 443
    const radios = document.querySelectorAll<HTMLInputElement>(
      '.port-forward-port-option input[type="radio"]'
    );
    await act(async () => {
      radios[1].click();
      await Promise.resolve();
    });

    // Port 443 is < 1024, so local port should be 443 + 8000 = 8443
    localPortInput = document.querySelector<HTMLInputElement>('#port-forward-local-port');
    expect(localPortInput?.value).toBe('8443');
  });

  it('calls onClose when cancel clicked', async () => {
    await renderModal();

    const cancelButton = document.querySelector('.button.cancel') as HTMLButtonElement;
    expect(cancelButton).toBeTruthy();

    await act(async () => {
      cancelButton.click();
      await Promise.resolve();
    });

    expect(mockOnClose).toHaveBeenCalled();
  });

  it('calls onClose when overlay clicked', async () => {
    await renderModal();

    const overlay = document.querySelector('.modal-overlay') as HTMLDivElement;
    expect(overlay).toBeTruthy();

    await act(async () => {
      overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(mockOnClose).toHaveBeenCalled();
  });

  it('does not close when modal content is clicked', async () => {
    await renderModal();

    const modalContent = document.querySelector('.port-forward-modal') as HTMLDivElement;
    expect(modalContent).toBeTruthy();

    await act(async () => {
      modalContent.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(mockOnClose).not.toHaveBeenCalled();
  });

  it('shows manual input when no ports provided', async () => {
    vi.useFakeTimers();

    const targetWithoutPorts: PortForwardTarget = {
      ...mockTarget,
      ports: [],
    };

    await renderModal({ target: targetWithoutPorts });

    // Wait for async port fetch to complete
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    // Should show manual input field since no ports and mock returns empty
    const containerPortInput = document.querySelector(
      '.port-forward-input[placeholder*="Enter port"]'
    );
    expect(containerPortInput).toBeTruthy();

    // No radio buttons should be present
    const radios = document.querySelectorAll('.port-forward-port-option');
    expect(radios.length).toBe(0);

    vi.useRealTimers();
  });

  it('disables start button when port is invalid', async () => {
    vi.useFakeTimers();

    const targetWithoutPorts: PortForwardTarget = {
      ...mockTarget,
      ports: [],
    };

    await renderModal({ target: targetWithoutPorts });

    // Wait for async port fetch to complete
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    // Start button should be disabled when ports are 0
    const startButton = document.querySelector('.button.save') as HTMLButtonElement;
    expect(startButton).toBeTruthy();
    expect(startButton.disabled).toBe(true);

    vi.useRealTimers();
  });

  it('starts port forward successfully and calls callbacks', async () => {
    await renderModal();

    const startButton = document.querySelector('.button.save') as HTMLButtonElement;
    expect(startButton).toBeTruthy();
    expect(startButton.disabled).toBe(false);

    await act(async () => {
      startButton.click();
      await Promise.resolve();
    });

    expect(startPortForwardMock).toHaveBeenCalledWith('cluster-1', {
      namespace: 'default',
      targetKind: 'Deployment',
      targetName: 'nginx',
      containerPort: 80,
      localPort: 8080,
    });
    expect(mockOnStarted).toHaveBeenCalledWith('session-123');
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('shows error message when port forward fails', async () => {
    startPortForwardMock.mockRejectedValue(new Error('Port already in use'));

    await renderModal();

    const startButton = document.querySelector('.button.save') as HTMLButtonElement;

    await act(async () => {
      startButton.click();
      await Promise.resolve();
    });

    const errorMessage = document.querySelector('.port-forward-error');
    expect(errorMessage).toBeTruthy();
    expect(errorMessage?.textContent).toBe('Port already in use');
  });

  it('shows loading state while starting', async () => {
    // Make the start call hang
    startPortForwardMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve('session-123'), 5000);
        })
    );

    vi.useFakeTimers();

    await renderModal();

    const startButton = document.querySelector('.button.save') as HTMLButtonElement;

    await act(async () => {
      startButton.click();
      await Promise.resolve();
    });

    // Button should show loading text
    expect(startButton.textContent).toBe('Starting...');
    expect(startButton.disabled).toBe(true);

    // Cancel button should be disabled during loading
    const cancelButton = document.querySelector('.button.cancel') as HTMLButtonElement;
    expect(cancelButton.disabled).toBe(true);

    vi.useRealTimers();
  });

  it('uses non-privileged port directly for local port', async () => {
    const targetWithHighPort: PortForwardTarget = {
      ...mockTarget,
      ports: [{ port: 8080, name: 'http' }],
    };

    await renderModal({ target: targetWithHighPort });

    // Port 8080 is >= 1024, so local port should be the same: 8080
    const localPortInput = document.querySelector<HTMLInputElement>('#port-forward-local-port');
    expect(localPortInput?.value).toBe('8080');
  });

  it('allows manual local port input', async () => {
    await renderModal();

    const localPortInput = document.querySelector<HTMLInputElement>('#port-forward-local-port');
    expect(localPortInput).toBeTruthy();

    // Change local port to custom value
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(localPortInput, '9999');
      localPortInput?.dispatchEvent(new Event('input', { bubbles: true }));
      localPortInput?.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });

    expect(localPortInput?.value).toBe('9999');
  });

  it('fetches ports from backend when not provided', async () => {
    vi.useFakeTimers();

    getTargetPortsMock.mockResolvedValue([{ port: 3000, name: 'api', protocol: 'TCP' }]);

    const targetWithoutPorts: PortForwardTarget = {
      ...mockTarget,
      ports: [],
    };

    await renderModal({ target: targetWithoutPorts });

    // Wait for async port fetch
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(getTargetPortsMock).toHaveBeenCalledWith('cluster-1', 'default', 'Deployment', 'nginx');

    vi.useRealTimers();
  });

  it('does not re-fetch or reset when re-rendered with a new target object for the same resource', async () => {
    vi.useFakeTimers();

    getTargetPortsMock.mockResolvedValue([{ port: 3000, name: 'api', protocol: 'TCP' }]);

    const targetWithoutPorts: PortForwardTarget = {
      ...mockTarget,
      ports: [],
    };

    await renderModal({ target: targetWithoutPorts });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(getTargetPortsMock).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain('3000');
    expect(document.body.textContent).toContain('(api)');

    await act(async () => {
      root.render(
        <PortForwardModal
          target={{ ...targetWithoutPorts }}
          onClose={mockOnClose}
          onStarted={mockOnStarted}
        />
      );
      await Promise.resolve();
    });

    expect(getTargetPortsMock).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain('3000');
    expect(document.body.textContent).toContain('(api)');

    vi.useRealTimers();
  });
});
