import { act, type ComponentProps } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NodeMaintenanceDrainJob } from '@/core/refresh/types';
import DrainNodeModal from './DrainNodeModal';

const mocks = vi.hoisted(() => ({
  buildObjectActionTarget: vi.fn(),
  cancelDrain: vi.fn(),
  handleError: vi.fn(),
  requestRefresh: vi.fn(),
  runStartDrain: vi.fn(),
  setRefreshEnabled: vi.fn(),
  snapshot: {
    status: 'ready',
    data: { drains: [] as NodeMaintenanceDrainJob[] },
  },
}));

vi.mock('@shared/actions/objectActionClient', () => ({
  buildObjectActionTarget: (...args: unknown[]) => mocks.buildObjectActionTarget(...args),
  runStartDrain: (...args: unknown[]) => mocks.runStartDrain(...args),
}));

vi.mock('@shared/components/Tooltip', () => ({ default: () => null }));

vi.mock('@/core/backend-api', () => ({
  CancelDrainNodeJob: (...args: unknown[]) => mocks.cancelDrain(...args),
}));

vi.mock('@/core/data-access', () => ({
  requestRefreshDomain: (...args: unknown[]) => mocks.requestRefresh(...args),
  setRefreshDomainEnabled: (...args: unknown[]) => mocks.setRefreshEnabled(...args),
}));

vi.mock('@/core/refresh', () => ({
  useRefreshScopedDomain: () => mocks.snapshot,
}));

vi.mock('@/core/refresh/hooks/useAutoRefreshLoadingState', () => ({
  useAutoRefreshLoadingState: () => ({ isPaused: false, isManualRefreshActive: false }),
}));

vi.mock('@/utils/errorHandler', () => ({
  errorHandler: {
    handle: (...args: unknown[]) => mocks.handleError(...args),
  },
}));

vi.mock('./useModalFocusTrap', () => ({ useModalFocusTrap: vi.fn() }));

const buildDrainJob = (status: NodeMaintenanceDrainJob['status']): NodeMaintenanceDrainJob => ({
  clusterId: 'cluster-1',
  id: 'drain-1',
  nodeName: 'node-a',
  status,
  startedAt: 1_700_000_000_000,
  options: {
    ignoreDaemonSets: true,
    deleteEmptyDirData: true,
    force: false,
    disableEviction: false,
    skipWaitForPodsToTerminate: false,
  },
  events: [],
});

describe('DrainNodeModal', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  const defaultProps = {
    isOpen: true,
    clusterId: 'cluster-1',
    clusterName: 'Development',
    nodeName: 'node-a',
    onClose: vi.fn(),
  };

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    mocks.snapshot.status = 'ready';
    mocks.snapshot.data = { drains: [] };
    mocks.buildObjectActionTarget.mockReset();
    mocks.buildObjectActionTarget.mockReturnValue({ target: 'node-a' });
    mocks.cancelDrain.mockReset();
    mocks.cancelDrain.mockResolvedValue(undefined);
    mocks.handleError.mockReset();
    mocks.handleError.mockImplementation((error: unknown) => ({ message: String(error) }));
    mocks.requestRefresh.mockReset();
    mocks.requestRefresh.mockResolvedValue(undefined);
    mocks.runStartDrain.mockReset();
    mocks.runStartDrain.mockResolvedValue(undefined);
    mocks.setRefreshEnabled.mockReset();
    defaultProps.onClose.mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.innerHTML = '';
  });

  const renderModal = async (props: Partial<ComponentProps<typeof DrainNodeModal>> = {}) => {
    await act(async () => {
      root.render(<DrainNodeModal {...defaultProps} {...props} />);
      await Promise.resolve();
    });
  };

  it('does not acquire maintenance scope or render while closed', async () => {
    await renderModal({ isOpen: false });

    expect(document.querySelector('.drain-node-modal')).toBeNull();
    expect(mocks.setRefreshEnabled).not.toHaveBeenCalled();
    expect(mocks.requestRefresh).not.toHaveBeenCalled();
  });

  it('acquires the cluster-scoped node maintenance domain and renders initial options', async () => {
    await renderModal();

    expect(mocks.setRefreshEnabled).toHaveBeenCalledWith({
      domain: 'object-maintenance',
      scope: 'cluster-1|node:node-a',
      enabled: true,
    });
    expect(mocks.requestRefresh).toHaveBeenCalledWith({
      domain: 'object-maintenance',
      scope: 'cluster-1|node:node-a',
      reason: 'startup',
    });
    expect(document.querySelector('[data-test="drain-modal-start"]')).not.toBeNull();
    expect(document.querySelector('.drain-node-modal-advanced')).not.toBeNull();
  });

  it('explains the selected eviction denial and prevents the drain', async () => {
    await renderModal({
      permissions: {
        nodeMutation: { allowed: true, pending: false },
        podEvictionCreate: { allowed: false, pending: false },
        podDelete: { allowed: true, pending: false },
      },
    });

    const start = document.querySelector<HTMLButtonElement>('[data-test="drain-modal-start"]');
    expect(start?.disabled).toBe(true);
    expect(document.querySelector('[data-test="drain-modal-permission-reason"]')?.textContent).toBe(
      'You need permission to create Pod evictions before starting a drain.'
    );
  });

  it('starts a drain through the complete target builder and refreshes maintenance state', async () => {
    await renderModal();
    const start = document.querySelector<HTMLButtonElement>('[data-test="drain-modal-start"]');

    await act(async () => {
      start?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.buildObjectActionTarget).toHaveBeenCalledWith(
      { clusterId: 'cluster-1', kind: 'Node', name: 'node-a' },
      'drain'
    );
    expect(mocks.runStartDrain).toHaveBeenCalledWith(
      { target: 'node-a' },
      expect.objectContaining({
        ignoreDaemonSets: true,
        deleteEmptyDirData: true,
        force: false,
        disableEviction: false,
        skipWaitForPodsToTerminate: false,
      })
    );
    expect(mocks.requestRefresh).toHaveBeenLastCalledWith({
      domain: 'object-maintenance',
      scope: 'cluster-1|node:node-a',
      reason: 'user',
    });
  });

  it('projects advanced option changes into the normalized drain payload', async () => {
    await renderModal();
    const click = (selector: string) => {
      const input = document.querySelector<HTMLInputElement>(selector);
      if (!input) {
        throw new Error(`Missing input ${selector}`);
      }
      act(() => input.click());
    };
    const changeNumber = (input: HTMLInputElement, value: string) => {
      act(() => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter?.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    };

    click('[data-test="drain-modal-ignore-daemonsets"]');
    click('[data-test="drain-modal-delete-emptydir"]');
    click('[data-test="drain-modal-disable-eviction"]');
    click('[data-test="drain-modal-skip-wait"]');
    click('[data-test="drain-modal-force"]');
    click('[data-test="drain-modal-grace-toggle"]');
    click('[data-test="drain-modal-timeout-toggle"]');
    const numericInputs = document.querySelectorAll<HTMLInputElement>(
      '.drain-node-modal-grace input[type="number"]'
    );
    changeNumber(numericInputs[0] as HTMLInputElement, '1200');
    changeNumber(numericInputs[1] as HTMLInputElement, '9.8');

    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-test="drain-modal-start"]')?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.runStartDrain).toHaveBeenCalledWith(
      { target: 'node-a' },
      expect.objectContaining({
        ignoreDaemonSets: false,
        deleteEmptyDirData: false,
        disableEviction: true,
        skipWaitForPodsToTerminate: true,
        force: true,
        gracePeriodSeconds: 900,
        timeoutSeconds: 9,
      })
    );
  });

  it('shows retry history after failure and reports a subsequent start error', async () => {
    mocks.snapshot.data = {
      drains: [buildDrainJob('failed'), { ...buildDrainJob('succeeded'), id: 'drain-older' }],
    };
    mocks.runStartDrain.mockRejectedValue(new Error('drain rejected'));
    mocks.handleError.mockReturnValue({ message: 'drain rejected' });

    await renderModal();
    expect(document.querySelector('[data-test="drain-modal-retry"]')).not.toBeNull();
    expect(document.querySelectorAll('.drain-node-modal-history-entry')).toHaveLength(1);

    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-test="drain-modal-retry"]')?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.querySelector('.drain-node-modal-error')?.textContent).toContain(
      'drain rejected'
    );
  });

  it('keeps an active drain visible and hides controls for starting another', async () => {
    mocks.snapshot.data = { drains: [buildDrainJob('running')] };

    await renderModal();

    expect(document.querySelector('[data-test="drain-job-status"]')?.textContent).toBe('Running');
    expect(document.querySelector('[data-test="drain-modal-start"]')).toBeNull();
    expect(document.querySelector('.drain-node-modal-advanced')).toBeNull();
    expect(document.querySelector('.drain-node-modal-footer')?.textContent).toContain('Close');
  });

  it('cancels the active cluster-scoped drain and refreshes its maintenance scope', async () => {
    mocks.snapshot.data = { drains: [buildDrainJob('running')] };
    await renderModal();

    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[data-maintenance-action="cancel-drain"]')
        ?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.cancelDrain).toHaveBeenCalledWith('cluster-1', 'drain-1');
    expect(mocks.requestRefresh).toHaveBeenLastCalledWith({
      domain: 'object-maintenance',
      scope: 'cluster-1|node:node-a',
      reason: 'user',
    });
  });
});
