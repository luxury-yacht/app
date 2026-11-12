/**
 * frontend/src/modules/namespace/components/useWorkloadTableColumns.test.tsx
 *
 * The Workloads table's columns: Kind and Name open the workload, Namespace
 * opens that namespace's Workloads view, status comes from the backend's
 * presentation, restarts sort by count, and metric animations stay per
 * object identity. Runs inside the production shell with the real kubeconfig,
 * view-state, sidebar, and namespace owners over a faked backend
 * (test-utils/appState); cells are rendered and clicked as the table would.
 */

import type { WorkloadData } from '@modules/namespace/components/NsViewWorkloads.helpers';
import useWorkloadTableColumns from '@modules/namespace/components/useWorkloadTableColumns';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable';
import { getTextContent } from '@shared/components/tables/GridTable.utils';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { makeResourceRef } from '@/test-utils/makeResourceRef';
import { requireReactElement } from '@/test-utils/requireReactElement';
import { requireValue } from '@/test-utils/requireValue';

const app = installAppStateHarness();

let columns: GridColumnDefinition<WorkloadData>[] = [];

/** Renders the listed cells of one row, as the table renders them. */
function WorkloadCells({
  row,
  keys,
  onWorkloadClick,
}: Readonly<{ row: WorkloadData; keys: string[]; onWorkloadClick: (row: WorkloadData) => void }>) {
  columns = useWorkloadTableColumns({
    handleWorkloadClick: onWorkloadClick,
    showNamespaceColumn: true,
    useShortResourceNames: false,
    metrics: null,
  });
  return (
    <>
      {keys.map((key) => (
        <div key={key} data-column={key}>
          {requireValue(
            columns.find((column) => column.key === key),
            `expected the ${key} column`
          ).render(row)}
        </div>
      ))}
    </>
  );
}

const workloadIn = (cluster: TestCluster, overrides: Partial<WorkloadData> = {}): WorkloadData => ({
  ref: makeResourceRef({
    clusterId: cluster.clusterId,
    group: 'apps',
    kind: 'Deployment',
    resource: 'deployments',
    namespace: 'team-a',
    name: 'api',
  }),
  status: 'Running',
  statusState: '1/1',
  statusPresentation: 'ready',
  ready: '1/1',
  restarts: 0,
  cpuUsageMilli: 10,
  memoryUsageBytes: 20 * 1024 ** 2,
  age: '5m',
  portForwardAvailable: false,
  ...overrides,
});

const start = async () => {
  const dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['team-a']);
  const view = await app.render(null);
  return { dev, view };
};

const show = (view: MountedApp, row: WorkloadData, keys: string[], onWorkloadClick = vi.fn()) =>
  view.show(<WorkloadCells row={row} keys={keys} onWorkloadClick={onWorkloadClick} />);

const cell = (view: MountedApp, key: string) =>
  requireValue(
    view.container.querySelector<HTMLElement>(`[data-column="${key}"]`),
    `expected the ${key} cell`
  );

const clickCell = async (view: MountedApp, key: string) => {
  const button = requireValue(
    cell(view, key).querySelector<HTMLButtonElement>('button'),
    `expected the ${key} cell to be a link`
  );
  await act(async () => button.click());
  await app.settle();
};

const columnOf = (key: string) =>
  requireValue(
    columns.find((column) => column.key === key),
    `expected the ${key} column`
  );

describe('useWorkloadTableColumns', () => {
  it('opens the workload from Kind and Name, and its namespace’s Workloads view from Namespace', async () => {
    const { dev, view } = await start();
    const workload = workloadIn(dev);
    const onWorkloadClick = vi.fn();
    await show(view, workload, ['kind', 'name', 'namespace'], onWorkloadClick);

    await clickCell(view, 'kind');
    await clickCell(view, 'name');
    expect(onWorkloadClick.mock.calls).toEqual([[workload], [workload]]);

    await clickCell(view, 'namespace');
    const { namespace, viewState } = view.owners();
    expect({
      namespace: namespace.selectedNamespace,
      clusterId: namespace.selectedNamespaceClusterId,
      view: viewState?.viewType,
      tab: viewState?.activeNamespaceTab,
    }).toEqual({
      namespace: 'team-a',
      clusterId: dev.clusterId,
      view: 'namespace',
      tab: 'workloads',
    });
  });

  it('keeps metric animation scopes distinct across clusters and workload kinds', async () => {
    const { dev, view } = await start();
    const workload = workloadIn(dev);
    await show(view, workload, []);

    for (const key of ['cpu', 'memory']) {
      const animationKeys = [
        workload.ref,
        { ...workload.ref, clusterId: 'other' },
        { ...workload.ref, kind: 'StatefulSet' },
      ].map(
        (ref) =>
          requireReactElement<{ animationScopeKey: string }>(
            columnOf(key).render({ ...workload, ref }),
            'expected a metric cell'
          ).props.animationScopeKey
      );
      expect(new Set(animationKeys).size).toBe(3);
    }
  });

  it('presents status from the backend’s statusPresentation, never from statusState', async () => {
    const { dev, view } = await start();

    await show(view, workloadIn(dev, { statusPresentation: 'warning' }), ['status']);
    expect(cell(view, 'status').querySelector('.status-chip')?.className).toBe(
      'status-chip status-chip--warning'
    );

    await show(view, workloadIn(dev, { statusState: 'true', statusPresentation: undefined }), [
      'status',
    ]);
    expect(cell(view, 'status').querySelector('.status-chip')?.className).toBe(
      'status-chip status-chip--info'
    );
  });

  // The backend sorts restarts by count; the table shows zero as no value.
  it('shows zero restarts as no value', async () => {
    const { dev, view } = await start();
    const workload = workloadIn(dev);
    await show(view, workload, []);
    const restarts = columnOf('restarts');

    expect(getTextContent(restarts.render(workload))).toBe('-');
    expect(getTextContent(restarts.render({ ...workload, restarts: 3 }))).toBe('3');
  });
});
