import { useMemo } from 'react';

import type { GridColumnDefinition } from '@shared/components/tables/GridTable';
import * as cf from '@shared/components/tables/columnFactories';
import { getDisplayKind } from '@/utils/kindAliasMap';

import type { WorkloadData } from '@modules/namespace/components/NsViewWorkloads.helpers';

interface UseWorkloadTableColumnsParams {
  handleWorkloadClick: (workload: WorkloadData) => void;
  showNamespaceColumn: boolean;
  useShortResourceNames: boolean;
  metrics?: {
    stale?: boolean;
    lastError?: string;
    collectedAt?: number;
  } | null;
}

const useWorkloadTableColumns = ({
  handleWorkloadClick,
  showNamespaceColumn,
  useShortResourceNames,
  metrics,
}: UseWorkloadTableColumnsParams): GridColumnDefinition<WorkloadData>[] => {
  return useMemo<GridColumnDefinition<WorkloadData>[]>(() => {
    const getReadyClassName = (workload: WorkloadData) => {
      const ready = workload.ready;
      if (ready && ready.includes('/')) {
        const [readyCount, total] = ready.split('/').map((value) => value.trim());
        if (readyCount && total && readyCount !== total) {
          return 'status-badge warning';
        }
      }
      return undefined;
    };

    const getRestartsClassName = (workload: WorkloadData) =>
      (workload.restarts ?? 0) > 0 ? 'status-badge warning' : undefined;

    const metricsStale = Boolean(metrics?.stale);
    const metricsError = metrics?.lastError ?? undefined;
    const metricsLastUpdated =
      typeof metrics?.collectedAt === 'number' ? new Date(metrics.collectedAt * 1000) : undefined;

    const columns: GridColumnDefinition<WorkloadData>[] = [];

    columns.push(
      cf.createKindColumn<WorkloadData>({
        getKind: (row) => row.kind,
        getDisplayText: (row) => getDisplayKind(row.kind, useShortResourceNames),
        onClick: (row) => handleWorkloadClick(row),
        isInteractive: () => true,
        sortValue: (row) => row.kind.toLowerCase(),
      })
    );

    columns.push(
      cf.createTextColumn<WorkloadData>('name', 'Name', (row) => row.name, {
        onClick: (row) => handleWorkloadClick(row),
        isInteractive: () => true,
      })
    );

    if (showNamespaceColumn) {
      cf.upsertNamespaceColumn(columns, {
        accessor: (row) => row.namespace ?? '',
        onClick: (row) => handleWorkloadClick(row),
      });
    }

    const statusColumn = cf.createTextColumn<WorkloadData>(
      'status',
      'Status',
      (row) => row.status,
      {
        getClassName: (row) => {
          const statusClass = row.statusClass || '';
          return ['status-badge', statusClass].filter(Boolean).join(' ').trim();
        },
      }
    );
    statusColumn.sortValue = (row) => row.status.toLowerCase();
    columns.push(statusColumn);

    const readyColumn = cf.createTextColumn<WorkloadData>(
      'ready',
      'Ready',
      (row) => row.ready ?? '—',
      {
        getClassName: (row) => getReadyClassName(row),
      }
    );
    readyColumn.sortValue = (row) => {
      const value = row.ready;
      if (!value) {
        return -1;
      }
      if (!value.includes('/')) {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : value.toLowerCase();
      }
      const [a, b] = value.split('/').map((part) => Number(part.trim()));
      if (Number.isFinite(a) && Number.isFinite(b) && b !== 0) {
        return a / b;
      }
      return value.toLowerCase();
    };
    columns.push(readyColumn);

    const restartsColumn = cf.createTextColumn<WorkloadData>(
      'restarts',
      'Restarts',
      (row) => String(row.restarts ?? 0),
      {
        getClassName: (row) => getRestartsClassName(row),
      }
    );
    restartsColumn.sortValue = (row) => row.restarts ?? 0;
    columns.push(restartsColumn);

    columns.push(
      cf.createResourceBarColumn<WorkloadData>({
        key: 'cpu',
        header: 'CPU',
        type: 'cpu',
        getUsage: (row) => row.cpuUsage,
        getRequest: (row) => row.cpuRequest,
        getLimit: (row) => row.cpuLimit,
        getVariant: () => 'compact',
        getMetricsStale: () => metricsStale,
        getMetricsError: () => metricsError,
        getMetricsLastUpdated: () => metricsLastUpdated,
        getAnimationKey: (row) => `workload:${row.namespace}/${row.name}:cpu`,
        getShowEmptyState: () => true,
      })
    );

    columns.push(
      cf.createResourceBarColumn<WorkloadData>({
        key: 'memory',
        header: 'Memory',
        type: 'memory',
        getUsage: (row) => row.memUsage,
        getRequest: (row) => row.memRequest,
        getLimit: (row) => row.memLimit,
        getVariant: () => 'compact',
        getMetricsStale: () => metricsStale,
        getMetricsError: () => metricsError,
        getMetricsLastUpdated: () => metricsLastUpdated,
        getAnimationKey: (row) => `workload:${row.namespace}/${row.name}:memory`,
        getShowEmptyState: () => true,
      })
    );

    columns.push(
      cf.createAgeColumn<WorkloadData & { age?: string }>('age', 'Age', (row) => {
        return row.age ?? '—';
      }) as GridColumnDefinition<WorkloadData>
    );

    const sizing: cf.ColumnSizingMap = {
      kind: { autoWidth: true },
      name: { autoWidth: true },
      namespace: { autoWidth: true },
      status: { autoWidth: true },
      ready: { autoWidth: true },
      restarts: { autoWidth: true },
      cpu: { width: 200, minWidth: 200 },
      memory: { width: 200, minWidth: 200 },
      age: { autoWidth: true },
    };
    cf.applyColumnSizing(columns, sizing);

    return columns;
  }, [
    handleWorkloadClick,
    metrics?.collectedAt,
    metrics?.lastError,
    metrics?.stale,
    showNamespaceColumn,
    useShortResourceNames,
  ]);
};

export default useWorkloadTableColumns;
