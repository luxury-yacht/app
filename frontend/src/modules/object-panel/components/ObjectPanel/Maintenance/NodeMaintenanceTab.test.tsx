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
const mockDrainNode = vi.hoisted(() => vi.fn());
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
  CordonNode: (...args: unknown[]) => mockCordonNode(...args),
  UncordonNode: (...args: unknown[]) => mockUncordonNode(...args),
  DrainNode: (...args: unknown[]) => mockDrainNode(...args),
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
    mockDrainNode.mockResolvedValue(undefined);
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
    mockDrainNode.mockReset();
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

  const queryActionButton = (action: 'cordon' | 'drain' | 'delete') =>
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

    expect(mockDrainNode).toHaveBeenCalledWith(
      'alpha:ctx',
      'node-1',
      expect.objectContaining({ force: true })
    );
    expect(mockRefreshOrchestrator.fetchScopedDomain).toHaveBeenCalled();
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

  it('deletes a node when confirmed', async () => {
    render();

    const button = queryActionButton('delete');
    expect(button).toBeTruthy();

    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await confirmModal();
    expect(mockDrainNode).not.toHaveBeenCalled();
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
    }>;
    expect(descriptors.length).toBe(3);
    for (const d of descriptors) {
      expect(d.resourceKind).toBe('Node');
      expect(d.group).toBe('');
      expect(d.version).toBe('v1');
    }
    const ids = descriptors.map((d) => d.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        expect.stringContaining(':cordon:'),
        expect.stringContaining(':drain:'),
        expect.stringContaining(':delete:'),
      ])
    );
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
});
