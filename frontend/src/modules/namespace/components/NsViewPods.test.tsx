/**
 * frontend/src/modules/namespace/components/NsViewPods.test.tsx
 *
 * Test suite for NsViewPods.
 * Covers key behaviors and edge cases for NsViewPods.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PodSnapshotEntry, PodMetricsInfo } from '@/core/refresh/types';
import { PODS_UNHEALTHY_STORAGE_KEY } from '@modules/namespace/components/podsFilterSignals';
import { eventBus } from '@/core/events';

const {
  gridTablePropsRef,
  confirmationPropsRef,
  openWithObjectMock,
  useTableSortMock,
  useUserPermissionsMock,
  deletePodMock,
  errorHandlerMock,
} = vi.hoisted(() => ({
  gridTablePropsRef: { current: null as any },
  confirmationPropsRef: { current: null as any },
  openWithObjectMock: vi.fn(),
  useTableSortMock: vi.fn(),
  useUserPermissionsMock: vi.fn(),
  deletePodMock: vi.fn().mockResolvedValue(undefined),
  errorHandlerMock: { handle: vi.fn() },
}));

const clusterMetricsMock = vi.hoisted(() => ({ current: null as any }));

vi.mock('@shared/components/tables/GridTable', () => ({
  default: (props: any) => {
    gridTablePropsRef.current = props;
    return (
      <div>
        <div data-testid="mock-gridtable-filters">
          {props.filters?.options?.customActions ?? null}
        </div>
        <table data-testid="grid-table">
          <tbody>
            {props.data.map((row: any) => (
              <tr key={row.name}>
                <td>{row.name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  },
  GRIDTABLE_VIRTUALIZATION_DEFAULT: 'virtualization-default',
}));

vi.mock('@shared/components/ResourceLoadingBoundary', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@modules/namespace/hooks/useNamespaceGridTablePersistence', () => {
  const state = { columnWidths: {} as Record<string, any> };
  return {
    useNamespaceGridTablePersistence: () => ({
      sortConfig: { key: 'name', direction: 'asc' },
      onSortChange: vi.fn(),
      columnWidths: state.columnWidths,
      setColumnWidths: (next: any) => {
        state.columnWidths = next;
        if (gridTablePropsRef.current) {
          gridTablePropsRef.current = { ...gridTablePropsRef.current, columnWidths: next };
        }
      },
      columnVisibility: null,
      setColumnVisibility: vi.fn(),
      filters: { search: '', kinds: [], namespaces: [] },
      setFilters: vi.fn(),
      isNamespaceScoped: true,
      resetState: vi.fn(),
    }),
  };
});

vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => ({ openWithObject: openWithObjectMock }),
}));

vi.mock('@/hooks/useTableSort', () => ({
  useTableSort: (...args: unknown[]) => useTableSortMock(...(args as [])),
}));

vi.mock('@components/modals/ConfirmationModal', () => ({
  default: (props: any) => {
    confirmationPropsRef.current = props;
    return null;
  },
}));

vi.mock('@wailsjs/go/backend/App', () => ({
  DeletePod: (...args: unknown[]) => deletePodMock(...(args as [])),
}));

vi.mock('@/core/capabilities', () => ({
  getPermissionKey: (kind: string, action: string, ns?: string) => `${kind}:${action}:${ns ?? ''}`,
  useUserPermissions: () => useUserPermissionsMock(),
}));

vi.mock('@/utils/podStatusSeverity', () => ({
  getPodStatusSeverity: () => 'warning',
}));

vi.mock('@/core/refresh/hooks/useMetricsAvailability', () => ({
  useClusterMetricsAvailability: () => clusterMetricsMock.current,
}));

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({ selectedKubeconfig: 'mock-path:mock-context' }),
}));

vi.mock('@utils/errorHandler', () => ({
  errorHandler: errorHandlerMock,
}));

import NsViewPods from '@modules/namespace/components/NsViewPods';

const createPod = (override: Partial<PodSnapshotEntry> = {}): PodSnapshotEntry => ({
  name: 'pod-default',
  namespace: 'team-a',
  clusterId: 'alpha:ctx',
  clusterName: 'alpha',
  node: 'node-a',
  status: 'Running',
  ready: '1/1',
  restarts: 0,
  age: '1h',
  ownerKind: 'Deployment',
  ownerName: 'owner',
  cpuUsage: '0m',
  cpuRequest: '0m',
  cpuLimit: '0m',
  memUsage: '0Mi',
  memRequest: '0Mi',
  memLimit: '0Mi',
  ...override,
});

describe('NsViewPods', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    gridTablePropsRef.current = null;
    confirmationPropsRef.current = null;
    openWithObjectMock.mockReset();
    deletePodMock.mockClear();
    useTableSortMock.mockReset();
    useUserPermissionsMock.mockReset();
    errorHandlerMock.handle.mockClear();

    useTableSortMock.mockImplementation((data) => ({
      sortedData: data,
      sortConfig: { key: 'name', direction: 'asc' },
      handleSort: vi.fn(),
    }));
    useUserPermissionsMock.mockReturnValue(
      new Map([
        ['Pod:delete:team-a', { allowed: true, pending: false }],
        ['Pod:delete:', { allowed: true, pending: false }],
      ])
    );
    clusterMetricsMock.current = null;
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    window.sessionStorage.clear();
  });

  const renderPods = async (props: Partial<React.ComponentProps<typeof NsViewPods>> = {}) => {
    // Include cluster metadata so GridTable key extraction stays cluster-scoped.
    const defaultPods: PodSnapshotEntry[] = [
      createPod({
        name: 'api',
        namespace: 'team-a',
        node: 'node-a',
        status: 'Running',
        ready: '2/2',
        restarts: 0,
        age: '1h',
        ownerKind: 'Deployment',
        ownerName: 'api',
        cpuUsage: '500m',
        cpuRequest: '1000m',
        cpuLimit: '1500m',
        memUsage: '200Mi',
        memRequest: '512Mi',
        memLimit: '1Gi',
      }),
    ];

    const metrics: PodMetricsInfo = {
      stale: false,
      lastError: '',
      collectedAt: Math.floor(Date.now() / 1000),
      successCount: 1,
      failureCount: 0,
    };

    await act(async () => {
      root.render(
        <NsViewPods namespace="team-a" data={defaultPods} metrics={metrics} {...props} />
      );
      await Promise.resolve();
    });
    return defaultPods;
  };

  const openDeleteConfirmation = () => {
    const deleteItem = gridTablePropsRef.current
      .getCustomContextMenuItems(gridTablePropsRef.current.data[0])
      .find((item: any) => item.label === 'Delete');
    expect(deleteItem).toBeTruthy();
    act(() => {
      deleteItem?.onClick?.();
    });
    expect(confirmationPropsRef.current?.isOpen).toBe(true);
  };

  it('passes pod data to GridTable and exposes key columns', async () => {
    const pods = await renderPods();

    const gridProps = gridTablePropsRef.current;
    expect(gridProps.data).toEqual(pods);
    expect(gridProps.enableContextMenu).toBe(true);
    expect(gridProps.columns.map((col: any) => col.key)).toEqual(
      expect.arrayContaining(['name', 'status', 'cpu', 'memory'])
    );
  });

  it('opens the object panel when a row name is clicked', async () => {
    await renderPods();
    const gridProps = gridTablePropsRef.current;

    const nameColumn = gridProps.columns.find((col: any) => col.key === 'name');
    const cell = nameColumn.render(gridProps.data[0]);
    expect(React.isValidElement(cell)).toBe(true);

    act(() => {
      cell.props.onClick?.({ stopPropagation: () => {} });
    });

    expect(openWithObjectMock).toHaveBeenCalledWith({
      kind: 'Pod',
      name: 'api',
      namespace: 'team-a',
    });
  });

  it('renders namespace error and metrics banners when provided', async () => {
    await renderPods({
      error: 'pods unavailable',
      metrics: {
        stale: true,
        lastError: '',
        collectedAt: 1700000000,
        successCount: 0,
        failureCount: 1,
      },
    });

    expect(container.querySelector('.namespace-error-message')?.textContent).toContain(
      'pods unavailable'
    );
    expect(container.querySelector('.metrics-warning-banner')?.textContent).toContain(
      'Awaiting metrics data...'
    );
  });

  it('prefers trimmed metrics error messages over stale warnings', async () => {
    await renderPods({
      metrics: {
        stale: false,
        lastError: '  metrics api unavailable  ',
        collectedAt: 1700000001,
        successCount: 0,
        failureCount: 1,
      },
    });

    expect(container.querySelector('.metrics-warning-banner')?.textContent).toContain(
      'Metrics API not found'
    );
  });

  it('falls back to cluster metrics when pod metrics are unavailable', async () => {
    clusterMetricsMock.current = {
      stale: false,
      lastError: 'metrics api unavailable',
      collectedAt: 1700000002,
      successCount: 0,
      failureCount: 1,
    };

    await renderPods({ metrics: null });

    expect(container.querySelector('.metrics-warning-banner')?.textContent).toContain(
      'Metrics API not found'
    );
  });

  it('toggles namespace styling when the column is shown', async () => {
    await renderPods();
    expect(gridTablePropsRef.current.tableClassName).toBe('gridtable-pods');

    await renderPods({ showNamespaceColumn: true });
    expect(gridTablePropsRef.current.tableClassName).toBe(
      'gridtable-pods gridtable-pods--namespaced'
    );
  });

  it('updates column widths when resized', async () => {
    await renderPods();
    const nextWidths = { name: { width: 280 } };

    await act(async () => {
      gridTablePropsRef.current.onColumnWidthsChange(nextWidths);
      await Promise.resolve();
    });

    expect(gridTablePropsRef.current.columnWidths).toEqual(nextWidths);
  });

  it('shows loading overlay when updating existing rows', async () => {
    await renderPods({ loading: true });
    expect(gridTablePropsRef.current.loadingOverlay).toMatchObject({
      show: true,
      message: 'Updating pods…',
    });
  });

  it('omits delete context action when permission data is unavailable', async () => {
    useUserPermissionsMock.mockReturnValue(new Map());
    await renderPods();

    const items = gridTablePropsRef.current.getCustomContextMenuItems(
      gridTablePropsRef.current.data[0]
    );
    expect(items.find((item: any) => item.label === 'Delete')).toBeUndefined();
  });

  it('suppresses delete action when permission is pending or denied', async () => {
    useUserPermissionsMock.mockReturnValue(
      new Map([['Pod:delete:team-a', { allowed: true, pending: true }]])
    );
    await renderPods();
    const pendingItems = gridTablePropsRef.current.getCustomContextMenuItems(
      gridTablePropsRef.current.data[0]
    );
    expect(pendingItems.find((item: any) => item.label === 'Delete')).toBeUndefined();

    useUserPermissionsMock.mockReturnValue(
      new Map([['Pod:delete:team-a', { allowed: false, pending: false }]])
    );
    await renderPods();
    const deniedItems = gridTablePropsRef.current.getCustomContextMenuItems(
      gridTablePropsRef.current.data[0]
    );
    expect(deniedItems.find((item: any) => item.label === 'Delete')).toBeUndefined();
  });

  it('exposes namespace column and prefixed keys when namespace visibility is enabled', async () => {
    const pods = await renderPods({ showNamespaceColumn: true });
    const columns = gridTablePropsRef.current.columns;
    expect(columns.find((col: any) => col.key === 'namespace')).toBeTruthy();
    const key = gridTablePropsRef.current.keyExtractor(pods[0]);
    expect(key).toBe('alpha:ctx|pod:team-a/api');
  });

  it('derives metrics helper values for resource columns', async () => {
    await renderPods({
      metrics: {
        stale: true,
        lastError: 'cpu metrics unavailable',
        collectedAt: 1700001000,
        successCount: 1,
        failureCount: 0,
      },
    });

    const cpuColumn = gridTablePropsRef.current.columns.find((col: any) => col.key === 'cpu');
    expect(cpuColumn).toBeTruthy();
    const cpuElement = cpuColumn.render(gridTablePropsRef.current.data[0]);
    expect(React.isValidElement(cpuElement)).toBe(true);
    expect(cpuElement.props.metricsStale).toBe(true);
    expect(cpuElement.props.metricsError).toBe('cpu metrics unavailable');
    expect(cpuElement.props.metricsLastUpdated).toEqual(new Date(1700001000 * 1000));

    await renderPods({ metrics: null });
    const memoryColumn = gridTablePropsRef.current.columns.find((col: any) => col.key === 'memory');
    const memoryRender = memoryColumn.render(gridTablePropsRef.current.data[0]);
    expect(React.isValidElement(memoryRender)).toBe(true);
    expect(memoryRender.props.metricsError).toBeUndefined();
    expect(memoryRender.props.metricsStale).toBe(false);
  });

  it('filters pods when the unhealthy toggle is enabled', async () => {
    const pods = [
      createPod({ name: 'healthy', status: 'Running', ready: '1/1', restarts: 0 }),
      createPod({ name: 'pending', status: 'Pending', ready: '0/1', restarts: 0 }),
      createPod({ name: 'restarting', status: 'Running', ready: '1/1', restarts: 2 }),
    ];

    await renderPods({ data: pods });

    const toggle = container.querySelector<HTMLButtonElement>(
      '[data-testid="pods-unhealthy-toggle"]'
    );
    expect(toggle).not.toBeNull();
    expect(toggle?.textContent).toContain('Show Unhealthy (2/3)');
    expect(gridTablePropsRef.current.data).toEqual(pods);

    await act(async () => {
      toggle?.click();
      await Promise.resolve();
    });
    expect(gridTablePropsRef.current.data).toEqual([pods[1], pods[2]]);
    expect(toggle?.textContent).toContain('Show All');

    await act(async () => {
      toggle?.click();
      await Promise.resolve();
    });
    expect(gridTablePropsRef.current.data).toEqual(pods);
  });

  it('enables the unhealthy filter when an event targets the namespace', async () => {
    const pods = [
      createPod({ name: 'healthy', status: 'Running', ready: '1/1', restarts: 0 }),
      createPod({ name: 'pending', status: 'Pending', ready: '0/1', restarts: 0 }),
    ];

    await renderPods({ data: pods });

    act(() => {
      eventBus.emit('pods:show-unhealthy', { scope: 'team-a' });
    });

    expect(gridTablePropsRef.current.data).toEqual([pods[1]]);
  });

  it('applies pending unhealthy filter requests from session storage', async () => {
    window.sessionStorage.setItem(PODS_UNHEALTHY_STORAGE_KEY, 'team-a');
    const pods = [
      createPod({ name: 'healthy', status: 'Running', ready: '1/1', restarts: 0 }),
      createPod({ name: 'failing', status: 'CrashLoopBackOff', ready: '0/1', restarts: 5 }),
    ];

    await renderPods({ data: pods });

    expect(gridTablePropsRef.current.data).toEqual([pods[1]]);
    expect(window.sessionStorage.getItem(PODS_UNHEALTHY_STORAGE_KEY)).toBeNull();
  });

  it('deletes a pod when confirmation succeeds', async () => {
    await renderPods();
    openDeleteConfirmation();

    await act(async () => {
      await confirmationPropsRef.current?.onConfirm?.();
    });

    expect(deletePodMock).toHaveBeenCalledWith('team-a', 'api');
  });

  it('handles delete failure with errorHandler and resets confirmation state', async () => {
    deletePodMock.mockRejectedValueOnce(new Error('boom'));

    await renderPods();
    openDeleteConfirmation();

    await act(async () => {
      await confirmationPropsRef.current?.onConfirm?.();
    });

    expect(errorHandlerMock.handle).toHaveBeenCalledWith(expect.any(Error), {
      action: 'delete',
      kind: 'Pod',
      name: 'api',
    });
    expect(confirmationPropsRef.current?.isOpen).toBe(false);
  });
});
