/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Maintenance/NodeMaintenanceTab.test.tsx
 */

import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { NodeMaintenanceTab } from './NodeMaintenanceTab';
import type { NodeMaintenanceSnapshotPayload } from '@/core/refresh/types';
import { KeyboardProvider } from '@ui/shortcuts';

const mockUseCapabilities = vi.hoisted(() => vi.fn());
const mockUseRefreshScopedDomain = vi.hoisted(() => vi.fn());
const mockCordonNode = vi.hoisted(() => vi.fn());
const mockUncordonNode = vi.hoisted(() => vi.fn());
const mockStartDrainNode = vi.hoisted(() => vi.fn());
const mockCancelDrainNodeJob = vi.hoisted(() => vi.fn());
const mockDeleteNode = vi.hoisted(() => vi.fn());
const mockRefreshOrchestrator = vi.hoisted(() => ({
  setScopedDomainEnabled: vi.fn(),
  resetScopedDomain: vi.fn(),
  fetchScopedDomain: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/core/capabilities', () => ({
  useCapabilities: (...args: unknown[]) => mockUseCapabilities(...args),
}));

vi.mock('@wailsjs/go/backend/App', () => ({
  CancelDrainNodeJob: (...args: unknown[]) => mockCancelDrainNodeJob(...args),
  CordonNode: (...args: unknown[]) => mockCordonNode(...args),
  UncordonNode: (...args: unknown[]) => mockUncordonNode(...args),
  StartDrainNode: (...args: unknown[]) => mockStartDrainNode(...args),
  DeleteNode: (...args: unknown[]) => mockDeleteNode(...args),
}));

vi.mock('@/core/refresh', () => ({
  useRefreshScopedDomain: (...args: unknown[]) => mockUseRefreshScopedDomain(...args),
  refreshOrchestrator: mockRefreshOrchestrator,
}));

vi.mock('@/core/settings/appPreferences', () => ({
  getAutoRefreshEnabled: () => true,
}));

const createDomainState = (payload?: NodeMaintenanceSnapshotPayload) => ({
  status: 'idle' as const,
  data: payload ?? { drains: [] },
  stats: null,
  error: null,
  droppedAutoRefreshes: 0,
  scope: '',
});

describe('NodeMaintenanceTab', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    mockUseCapabilities.mockReturnValue({
      getState: () => ({ allowed: true, pending: false }),
    });
    mockUseRefreshScopedDomain.mockReturnValue(createDomainState());
    mockCordonNode.mockResolvedValue(undefined);
    mockUncordonNode.mockResolvedValue(undefined);
    mockStartDrainNode.mockResolvedValue('job-started');
    mockCancelDrainNodeJob.mockResolvedValue(undefined);
    mockDeleteNode.mockResolvedValue(undefined);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    mockUseCapabilities.mockReset();
    mockUseRefreshScopedDomain.mockReset();
    mockCordonNode.mockReset();
    mockUncordonNode.mockReset();
    mockStartDrainNode.mockReset();
    mockCancelDrainNodeJob.mockReset();
    mockDeleteNode.mockReset();
    mockRefreshOrchestrator.setScopedDomainEnabled.mockReset();
    mockRefreshOrchestrator.resetScopedDomain.mockReset();
    mockRefreshOrchestrator.fetchScopedDomain.mockReset();
  });

  const render = (props?: Partial<React.ComponentProps<typeof NodeMaintenanceTab>>) => {
    act(() => {
      root.render(
        <KeyboardProvider>
          <NodeMaintenanceTab
            nodeDetails={
              {
                name: 'node-1',
                unschedulable: false,
              } as any
            }
            isActive
            clusterId="alpha:ctx"
            {...props}
          />
        </KeyboardProvider>
      );
    });
  };

  const queryActionButton = (action: 'cordon' | 'drain' | 'cancel-drain' | 'delete') =>
    container.querySelector<HTMLButtonElement>(`[data-maintenance-action="${action}"]`);

  const confirmModal = async () => {
    const confirmButton = document.querySelector(
      '.confirmation-modal .button:not(.cancel)'
    ) as HTMLButtonElement | null;
    if (confirmButton) {
      await act(async () => {
        confirmButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
    }
  };

  const setInputValue = async (input: HTMLInputElement, value: string) => {
    const valueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    )?.set;
    await act(async () => {
      valueSetter?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };

  it('cordons a schedulable node when the button is clicked', async () => {
    render();
    const button = queryActionButton('cordon');
    expect(button?.textContent).toContain('Cordon');

    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await confirmModal();

    expect(mockCordonNode).toHaveBeenCalledWith('alpha:ctx', 'node-1');
  });

  it('uncordons a cordoned node when the button is clicked', async () => {
    render({
      nodeDetails: {
        name: 'node-2',
        unschedulable: true,
      } as any,
    });

    const button = queryActionButton('cordon');
    expect(button?.textContent).toContain('Uncordon');

    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await confirmModal();

    expect(mockUncordonNode).toHaveBeenCalledWith('alpha:ctx', 'node-2');
  });

  it('drains a node with the configured options', async () => {
    render();

    const forceCheckbox = container.querySelector<HTMLInputElement>(
      '[data-test="node-maintenance-force"]'
    );
    expect(forceCheckbox).toBeTruthy();

    await act(async () => {
      forceCheckbox?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const button = queryActionButton('drain');
    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await confirmModal();

    expect(mockStartDrainNode).toHaveBeenCalledWith(
      'alpha:ctx',
      'node-1',
      expect.not.objectContaining({
        gracePeriodSeconds: expect.anything(),
        timeoutSeconds: expect.anything(),
      })
    );
    expect(mockStartDrainNode).toHaveBeenCalledWith(
      'alpha:ctx',
      'node-1',
      expect.objectContaining({ force: true })
    );
    expect(mockRefreshOrchestrator.fetchScopedDomain).toHaveBeenCalled();
  });

  it('sends an explicit grace period only when the override is enabled', async () => {
    render();

    const graceToggle = container.querySelector<HTMLInputElement>(
      '[data-test="node-maintenance-grace-toggle"]'
    );
    expect(graceToggle).toBeTruthy();

    await act(async () => {
      graceToggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const button = queryActionButton('drain');
    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await confirmModal();

    expect(mockStartDrainNode).toHaveBeenCalledWith(
      'alpha:ctx',
      'node-1',
      expect.objectContaining({ gracePeriodSeconds: 30 })
    );
  });

  it('sends an explicit drain timeout only when the timeout override is enabled', async () => {
    render();

    const timeoutToggle = container.querySelector<HTMLInputElement>(
      '[data-test="node-maintenance-timeout-toggle"]'
    );
    expect(timeoutToggle).toBeTruthy();

    await act(async () => {
      timeoutToggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const timeoutInput = container.querySelector<HTMLInputElement>(
      '[data-test="node-maintenance-timeout-input"]'
    );
    expect(timeoutInput).toBeTruthy();
    if (!timeoutInput) {
      throw new Error('expected timeout input to render');
    }
    await setInputValue(timeoutInput, '600');

    const button = queryActionButton('drain');
    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await confirmModal();

    expect(mockStartDrainNode).toHaveBeenCalledWith(
      'alpha:ctx',
      'node-1',
      expect.objectContaining({ timeoutSeconds: 600 })
    );
  });

  it('clamps custom grace period to the backend maximum', async () => {
    render();

    const graceToggle = container.querySelector<HTMLInputElement>(
      '[data-test="node-maintenance-grace-toggle"]'
    );
    expect(graceToggle).toBeTruthy();

    await act(async () => {
      graceToggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const graceInput = container.querySelector<HTMLInputElement>(
      '.node-maintenance-grace-inline input[type="number"]'
    );
    expect(graceInput).toBeTruthy();
    if (!graceInput) {
      throw new Error('expected grace period input to render');
    }
    await setInputValue(graceInput, '1200');

    const button = queryActionButton('drain');
    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await confirmModal();

    expect(mockStartDrainNode).toHaveBeenCalledWith(
      'alpha:ctx',
      'node-1',
      expect.objectContaining({ gracePeriodSeconds: 900 })
    );
  });

  it('disables the cordon action when capability is denied', () => {
    mockUseCapabilities.mockReturnValue({
      getState: () => ({ allowed: false, pending: false, reason: 'No RBAC' }),
    });

    render();
    const button = queryActionButton('cordon');
    expect(button?.disabled).toBe(true);
    expect(container.textContent).toContain('No RBAC');
  });

  it('disables the drain action when capability is denied', () => {
    mockUseCapabilities.mockImplementation(() => ({
      getState: (id: string) =>
        id.includes(':drain:')
          ? { allowed: false, pending: false, reason: 'Drain forbidden' }
          : { allowed: true, pending: false },
    }));

    render();
    const button = queryActionButton('drain');
    expect(button?.disabled).toBe(true);
    expect(container.textContent).toContain('Drain forbidden');
  });

  it('disables the drain action when pod eviction capability is denied', () => {
    mockUseCapabilities.mockImplementation(() => ({
      getState: (id: string) =>
        id.includes(':drain-pods:eviction:')
          ? { allowed: false, pending: false, reason: 'Evict forbidden' }
          : { allowed: true, pending: false },
    }));

    render();
    const button = queryActionButton('drain');
    expect(button?.disabled).toBe(true);
    expect(container.textContent).toContain('Evict forbidden');
  });

  it('deletes a node when confirmed', async () => {
    render();

    const button = queryActionButton('delete');
    expect(button).toBeTruthy();

    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await confirmModal();
    expect(mockStartDrainNode).not.toHaveBeenCalled();
    expect(mockCordonNode).toHaveBeenCalledTimes(0);
    expect(mockUncordonNode).toHaveBeenCalledTimes(0);
    expect(mockDeleteNode).toHaveBeenCalledWith('alpha:ctx', 'node-1');
  });

  it('disables delete when capability is denied', () => {
    mockUseCapabilities.mockImplementation(() => ({
      getState: (id: string) =>
        id.includes(':delete:')
          ? { allowed: false, pending: false, reason: 'Delete forbidden' }
          : { allowed: true, pending: false },
    }));

    render();
    const button = queryActionButton('delete');
    expect(button?.disabled).toBe(true);
    expect(container.textContent).toContain('Delete forbidden');
  });

  it('passes group/version on every Node capability descriptor', () => {
    // Regression: PR #139 made the backend reject permission queries that
    // omit apiVersion. Node descriptors must thread group:'' / version:'v1'
    // (core/v1) or cordon/drain/delete all return errors and the buttons
    // are stuck disabled.
    render();
    const calls = mockUseCapabilities.mock.calls;
    const callArgs = calls[calls.length - 1];
    expect(callArgs).toBeTruthy();
    const descriptors = (callArgs?.[0] ?? []) as Array<{
      id: string;
      group?: string;
      version?: string;
      resourceKind: string;
      verb: string;
      subresource?: string;
    }>;
    expect(descriptors.length).toBe(5);
    for (const d of descriptors) {
      expect(d.group).toBe('');
      expect(d.version).toBe('v1');
    }
    expect(descriptors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ resourceKind: 'Node', verb: 'patch' }),
        expect.objectContaining({ resourceKind: 'Node', verb: 'get' }),
        expect.objectContaining({ resourceKind: 'Node', verb: 'delete' }),
        expect.objectContaining({
          resourceKind: 'Pod',
          verb: 'create',
          subresource: 'eviction',
        }),
      ])
    );
    const ids = descriptors.map((d) => d.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        expect.stringContaining(':cordon:'),
        expect.stringContaining(':drain:'),
        expect.stringContaining(':node-get:'),
        expect.stringContaining(':delete:'),
      ])
    );
  });

  it('checks pod delete permission when drain disables eviction', async () => {
    render();

    const disableEviction = container.querySelector<HTMLInputElement>(
      '[data-test="node-maintenance-disable-eviction"]'
    );
    expect(disableEviction).toBeTruthy();

    await act(async () => {
      disableEviction?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const calls = mockUseCapabilities.mock.calls;
    const callArgs = calls[calls.length - 1];
    const descriptors = (callArgs?.[0] ?? []) as Array<{
      resourceKind: string;
      verb: string;
      subresource?: string;
    }>;
    expect(descriptors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resourceKind: 'Pod',
          verb: 'delete',
          subresource: undefined,
        }),
      ])
    );
  });

  it('includes direct pod delete mode in the drain confirmation', async () => {
    render();

    const disableEviction = container.querySelector<HTMLInputElement>(
      '[data-test="node-maintenance-disable-eviction"]'
    );
    expect(disableEviction).toBeTruthy();

    await act(async () => {
      disableEviction?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const button = queryActionButton('drain');
    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const modalBody = document.querySelector('.confirmation-modal-body');
    expect(modalBody?.textContent).toContain('Delete pods directly');
    expect(modalBody?.textContent).toContain('Drain timeout: No timeout');
  });

  it('does not enable node maintenance without a cluster identity', () => {
    render({ clusterId: null });

    expect(container.textContent).toContain('Unable to determine cluster identity');
    expect(queryActionButton('drain')).toBeNull();
    expect(mockUseCapabilities).toHaveBeenLastCalledWith(
      [],
      expect.objectContaining({ enabled: false })
    );
    expect(mockRefreshOrchestrator.setScopedDomainEnabled).not.toHaveBeenCalled();
  });

  it('disables new drain starts and exposes cancellation while a drain job is active', async () => {
    mockUseRefreshScopedDomain.mockReturnValue(
      createDomainState({
        clusterId: 'test-cluster',
        drains: [
          {
            clusterId: 'test-cluster',
            id: 'job-active',
            nodeName: 'node-1',
            status: 'running',
            startedAt: Date.now() - 1_000,
            message: 'Drain running',
            options: {
              ignoreDaemonSets: true,
              deleteEmptyDirData: true,
              force: false,
              disableEviction: false,
              skipWaitForPodsToTerminate: false,
            },
            events: [],
          },
        ],
      })
    );

    render();

    expect(queryActionButton('drain')?.disabled).toBe(true);
    expect(queryActionButton('cancel-drain')).toBeTruthy();

    await act(async () => {
      queryActionButton('cancel-drain')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(mockCancelDrainNodeJob).toHaveBeenCalledWith('alpha:ctx', 'job-active');
    expect(mockRefreshOrchestrator.fetchScopedDomain).toHaveBeenCalled();
  });

  it('renders drain history entries from the refresh domain', () => {
    mockUseRefreshScopedDomain.mockReturnValue(
      createDomainState({
        clusterId: 'test-cluster',
        drains: [
          {
            clusterId: 'test-cluster',
            id: 'job-1',
            nodeName: 'node-1',
            status: 'succeeded',
            startedAt: Date.now() - 5_000,
            completedAt: Date.now(),
            message: 'Drain complete',
            options: {
              gracePeriodSeconds: 30,
              ignoreDaemonSets: true,
              deleteEmptyDirData: true,
              force: false,
              disableEviction: false,
              skipWaitForPodsToTerminate: false,
            },
            events: [
              {
                id: 'evt',
                timestamp: Date.now() - 4_000,
                kind: 'info',
                phase: 'evicting',
                message: 'Evicting pod',
              },
            ],
          },
        ],
      })
    );

    render();
    expect(container.textContent).toContain('Drain complete');
    expect(container.textContent).toContain('Evicting pod');
  });

  it('renders summary, progress bar, and per-pod rows for an active drain', () => {
    const startedAt = Date.now() - 10_000;
    mockUseRefreshScopedDomain.mockReturnValue(
      createDomainState({
        clusterId: 'test-cluster',
        drains: [
          {
            clusterId: 'test-cluster',
            id: 'job-active',
            nodeName: 'node-1',
            status: 'running',
            startedAt,
            options: {
              ignoreDaemonSets: true,
              deleteEmptyDirData: true,
              force: false,
              disableEviction: false,
              skipWaitForPodsToTerminate: false,
              timeoutSeconds: 120,
            },
            events: [
              {
                id: 'plan',
                timestamp: startedAt + 100,
                kind: 'info',
                phase: 'plan',
                message: 'Evicting 3 pods',
              },
              {
                id: 'a-start',
                timestamp: startedAt + 200,
                kind: 'pod',
                phase: 'evicting',
                podNamespace: 'ns',
                podName: 'a',
                message: 'Evicting pod',
              },
              {
                id: 'a-done',
                timestamp: startedAt + 300,
                kind: 'pod',
                phase: 'evicted',
                podNamespace: 'ns',
                podName: 'a',
                message: 'Pod evicted',
              },
              {
                id: 'b-start',
                timestamp: startedAt + 400,
                kind: 'pod',
                phase: 'evicting',
                podNamespace: 'ns',
                podName: 'b',
                message: 'Evicting pod',
              },
            ],
          },
        ],
      })
    );

    render();
    const summary = container.querySelector('[data-test="drain-progress-summary"]');
    expect(summary?.textContent).toContain('1 of 3 pods evicted');
    expect(summary?.textContent).toContain('1 in progress');

    const bar = container.querySelector('.node-maintenance-progress-bar');
    expect(bar).toBeTruthy();
    expect(bar?.querySelectorAll('.segment').length).toBe(3);

    const rows = container.querySelectorAll('[data-test="drain-pod-table"] tbody tr');
    expect(rows.length).toBe(2);
    // In-progress row sorts first.
    expect(rows[0].textContent).toContain('b');
    expect(rows[1].textContent).toContain('a');

    const badge = container.querySelector('[data-test="drain-job-status"]');
    expect(badge?.className).toContain('pulse');
  });
});
