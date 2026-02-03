/**
 * frontend/src/modules/namespace/components/NsViewWorkloads.test.tsx
 *
 * Test suite for NsViewWorkloads.
 * Covers key behaviors and edge cases for NsViewWorkloads.
 */

import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import NsViewWorkloads from '@modules/namespace/components/NsViewWorkloads';

const gridTablePropsRef: { current: any } = { current: null };
const openWithObjectMock = vi.fn();

vi.mock('@shared/components/tables/GridTable', async () => {
  const actual = await vi.importActual<typeof import('@shared/components/tables/GridTable')>(
    '@shared/components/tables/GridTable'
  );
  return {
    ...actual,
    default: (props: any) => {
      gridTablePropsRef.current = props;
      return <div data-testid="grid-table" />;
    },
  };
});

vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => ({ openWithObject: openWithObjectMock }),
}));

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({ selectedKubeconfig: 'path:context' }),
}));

vi.mock('@shared/components/ResourceLoadingBoundary', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/hooks/useTableSort', () => ({
  useTableSort: (data: unknown[], _defaultKey?: string, _defaultDir?: any, opts?: any) => ({
    sortedData: data,
    sortConfig: opts?.controlledSort ?? { key: '', direction: null },
    handleSort: vi.fn(),
  }),
}));

vi.mock('@shared/components/tables/persistence/useGridTablePersistence', () => ({
  useGridTablePersistence: () => ({
    sortConfig: { key: 'name', direction: 'asc' },
    setSortConfig: vi.fn(),
    columnWidths: null,
    setColumnWidths: vi.fn(),
    columnVisibility: null,
    setColumnVisibility: vi.fn(),
    filters: { search: '', kinds: [], namespaces: [] },
    setFilters: vi.fn(),
    resetState: vi.fn(),
  }),
}));

vi.mock('@modules/namespace/hooks/useNamespaceGridTablePersistence', () => ({
  useNamespaceGridTablePersistence: vi.fn(() => ({
    sortConfig: { key: 'name', direction: 'asc' },
    onSortChange: vi.fn(),
    columnWidths: null,
    setColumnWidths: vi.fn(),
    columnVisibility: null,
    setColumnVisibility: vi.fn(),
    filters: { search: '', kinds: [], namespaces: [] },
    setFilters: vi.fn(),
    resetState: vi.fn(),
    isNamespaceScoped: true,
  })),
}));

vi.mock('@/core/refresh', () => ({
  useRefreshDomain: () => ({
    data: { metrics: null, nodes: [] },
    status: 'idle',
    isManual: false,
  }),
  refreshManager: { triggerManualRefresh: vi.fn() },
}));

vi.mock('@/hooks/useShortNames', () => ({
  useShortNames: () => false,
}));

const mockTriggerCronJob = vi.fn().mockResolvedValue('job-123');
const mockSuspendCronJob = vi.fn().mockResolvedValue(undefined);

vi.mock('@wailsjs/go/backend/App', () => ({
  RestartWorkload: vi.fn(),
  DeleteResource: vi.fn(),
  ScaleWorkload: vi.fn(),
  TriggerCronJob: (...args: any[]) => mockTriggerCronJob(...args),
  SuspendCronJob: (...args: any[]) => mockSuspendCronJob(...args),
}));

vi.mock('@/core/capabilities', () => ({
  getPermissionKey: (kind: string, verb: string, ns?: string) => `${kind}:${verb}:${ns || ''}`,
  useUserPermissions: () => {
    // Return permissions allowing all actions for testing
    const map = new Map();
    map.set('Job:create:default', { allowed: true, pending: false });
    map.set('CronJob:patch:default', { allowed: true, pending: false });
    map.set('Deployment:patch:default', { allowed: true, pending: false });
    map.set('Deployment:delete:default', { allowed: true, pending: false });
    return map;
  },
}));

describe('NsViewWorkloads', () => {
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
    openWithObjectMock.mockReset();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('passes persisted state to GridTable', async () => {
    await act(async () => {
      root.render(
        <NsViewWorkloads
          namespace="team-a"
          data={[]}
          loading={false}
          loaded={true}
          metrics={null}
        />
      );
      await Promise.resolve();
    });

    const props = gridTablePropsRef.current;
    expect(props).toBeTruthy();
    expect(props.sortConfig).toEqual({ key: 'name', direction: 'asc' });
    expect(props.filters?.value).toEqual({ search: '', kinds: [], namespaces: [] });
    expect(props.columnVisibility).toBe(null);
    expect(props.columnWidths).toBe(null);
  });

  it('routes workload clicks through the object panel with cluster metadata', async () => {
    const workload = {
      kind: 'Deployment',
      name: 'api',
      namespace: 'team-a',
      status: 'Running',
      ready: '1/1',
      restarts: 0,
      cpuUsage: '10m',
      memUsage: '20Mi',
      age: '5m',
      clusterId: 'alpha:ctx',
      clusterName: 'alpha',
    };

    await act(async () => {
      root.render(
        <NsViewWorkloads
          namespace="team-a"
          data={[workload as any]}
          loading={false}
          loaded={true}
          metrics={null}
        />
      );
      await Promise.resolve();
    });

    const props = gridTablePropsRef.current;
    const nameColumn = props.columns.find((column: any) => column.key === 'name');
    const cell = nameColumn.render(props.data[0]);

    // Use the name column click handler to verify object panel routing.
    act(() => {
      cell.props.onClick?.({ stopPropagation: () => {} });
    });

    expect(openWithObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'Deployment',
        name: 'api',
        namespace: 'team-a',
        clusterId: 'alpha:ctx',
        clusterName: 'alpha',
      })
    );
  });

  describe('CronJob context menu', () => {
    const cronjob = {
      kind: 'CronJob',
      name: 'backup',
      namespace: 'default',
      status: 'Idle',
      ready: '0',
      restarts: 0,
      age: '5m',
      clusterId: 'test:ctx',
      clusterName: 'test',
    };

    it('includes Trigger Now and Suspend items for CronJob', async () => {
      await act(async () => {
        root.render(
          <NsViewWorkloads
            namespace="default"
            data={[cronjob as any]}
            loading={false}
            loaded={true}
            metrics={null}
          />
        );
        await Promise.resolve();
      });

      const props = gridTablePropsRef.current;
      const menuItems = props.getCustomContextMenuItems(cronjob);

      const triggerItem = menuItems.find((item: any) => item.label === 'Trigger Now');
      const suspendItem = menuItems.find((item: any) => item.label === 'Suspend');

      expect(triggerItem).toBeDefined();
      expect(suspendItem).toBeDefined();
    });

    it('shows Resume instead of Suspend when CronJob is suspended', async () => {
      const suspendedCronjob = { ...cronjob, status: 'Suspended' };

      await act(async () => {
        root.render(
          <NsViewWorkloads
            namespace="default"
            data={[suspendedCronjob as any]}
            loading={false}
            loaded={true}
            metrics={null}
          />
        );
        await Promise.resolve();
      });

      const props = gridTablePropsRef.current;
      const menuItems = props.getCustomContextMenuItems(suspendedCronjob);

      const resumeItem = menuItems.find((item: any) => item.label === 'Resume');
      const suspendItem = menuItems.find((item: any) => item.label === 'Suspend');

      expect(resumeItem).toBeDefined();
      expect(suspendItem).toBeUndefined();
    });

    it('disables Trigger Now when CronJob is suspended', async () => {
      const suspendedCronjob = { ...cronjob, status: 'Suspended' };

      await act(async () => {
        root.render(
          <NsViewWorkloads
            namespace="default"
            data={[suspendedCronjob as any]}
            loading={false}
            loaded={true}
            metrics={null}
          />
        );
        await Promise.resolve();
      });

      const props = gridTablePropsRef.current;
      const menuItems = props.getCustomContextMenuItems(suspendedCronjob);

      const triggerItem = menuItems.find((item: any) => item.label === 'Trigger Now');
      expect(triggerItem?.disabled).toBe(true);
    });

    it('does not include CronJob actions for Deployments', async () => {
      const deployment = {
        kind: 'Deployment',
        name: 'api',
        namespace: 'default',
        status: 'Running',
        ready: '1/1',
        restarts: 0,
        age: '5m',
        clusterId: 'test:ctx',
        clusterName: 'test',
      };

      await act(async () => {
        root.render(
          <NsViewWorkloads
            namespace="default"
            data={[deployment as any]}
            loading={false}
            loaded={true}
            metrics={null}
          />
        );
        await Promise.resolve();
      });

      const props = gridTablePropsRef.current;
      const menuItems = props.getCustomContextMenuItems(deployment);

      const triggerItem = menuItems.find((item: any) => item.label === 'Trigger Now');
      const suspendItem = menuItems.find((item: any) => item.label === 'Suspend');

      expect(triggerItem).toBeUndefined();
      expect(suspendItem).toBeUndefined();
    });

    it('does not include Scale for CronJobs, Jobs, or DaemonSets', async () => {
      const workloads = [
        { kind: 'CronJob', name: 'backup', namespace: 'default', status: 'Idle' },
        { kind: 'Job', name: 'migrate', namespace: 'default', status: 'Running' },
        { kind: 'DaemonSet', name: 'agent', namespace: 'default', status: 'Running' },
      ];

      await act(async () => {
        root.render(
          <NsViewWorkloads
            namespace="default"
            data={workloads as any}
            loading={false}
            loaded={true}
            metrics={null}
          />
        );
        await Promise.resolve();
      });

      const props = gridTablePropsRef.current;

      for (const workload of workloads) {
        const menuItems = props.getCustomContextMenuItems(workload);
        const scaleItem = menuItems.find((item: any) => item.label === 'Scale');
        expect(scaleItem).toBeUndefined();
      }
    });

    it('includes Scale for Deployments and StatefulSets', async () => {
      const workloads = [
        { kind: 'Deployment', name: 'api', namespace: 'default', status: 'Running' },
        { kind: 'StatefulSet', name: 'db', namespace: 'default', status: 'Running' },
      ];

      await act(async () => {
        root.render(
          <NsViewWorkloads
            namespace="default"
            data={workloads as any}
            loading={false}
            loaded={true}
            metrics={null}
          />
        );
        await Promise.resolve();
      });

      const props = gridTablePropsRef.current;

      for (const workload of workloads) {
        const menuItems = props.getCustomContextMenuItems(workload);
        const scaleItem = menuItems.find((item: any) => item.label === 'Scale');
        expect(scaleItem).toBeDefined();
      }
    });
  });
});
