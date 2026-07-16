/**
 * frontend/src/modules/namespace/components/useWorkloadTableColumns.tsx
 *
 * Hook for useWorkloadTableColumns.
 * Provides column definitions for the Workloads GridTable.
 */

import type { WorkloadData } from '@modules/namespace/components/NsViewWorkloads.helpers';
import { useNamespaceColumnLink } from '@modules/namespace/components/useNamespaceColumnLink';
import * as cf from '@shared/components/tables/columnFactories';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable';
import { formatRestartCount } from '@shared/components/tables/restartCount';
import { backendStatusTextClass } from '@shared/utils/backendStatusPresentation';
import { useMemo } from 'react';
import { workloadRowCpuValue, workloadRowMemoryValue } from '@/core/resource-metrics';
import { getDisplayKind } from '@/utils/kindAliasMap';
import { parseCpuToMillicores, parseMemToMB } from '@/utils/resourceCalculations';

interface UseWorkloadTableColumnsParams {
  handleWorkloadClick: (workload: WorkloadData) => void;
  onAltClick?: (row: WorkloadData) => void;
  showNamespaceColumn: boolean;
  useShortResourceNames: boolean;
  metrics?: {
    stale?: boolean;
    lastError?: string;
    collectedAt?: number;
  } | null;
}

const parseReadyCounts = (value?: string | null): { ready: number; total: number } | null => {
  if (!value) {
    return null;
  }
  const match = value.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!match) {
    return null;
  }
  return {
    ready: Number(match[1]),
    total: Number(match[2]),
  };
};

const getReadySortValue = (value?: string | null): number | string => {
  const counts = parseReadyCounts(value);
  if (counts) {
    return counts.ready * 1000000 + counts.total;
  }
  if (!value) {
    return -1;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : value.toLowerCase();
};

const useWorkloadTableColumns = ({
  handleWorkloadClick,
  onAltClick,
  showNamespaceColumn,
  useShortResourceNames,
  metrics,
}: UseWorkloadTableColumnsParams): GridColumnDefinition<WorkloadData>[] => {
  const namespaceColumnLink = useNamespaceColumnLink<WorkloadData>('workloads');

  return useMemo<GridColumnDefinition<WorkloadData>[]>(() => {
    const getReadyClassName = (workload: WorkloadData) => {
      const counts = parseReadyCounts(workload.ready);
      if (counts && counts.ready !== counts.total) {
        return 'status-text warning';
      }
      return undefined;
    };

    const getRestartsClassName = (workload: WorkloadData) =>
      (workload.restarts ?? 0) > 0 ? 'status-text warning' : undefined;

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
        onAltClick,
        isInteractive: () => true,
        sortValue: (row) => row.kind.toLowerCase(),
      })
    );

    columns.push(
      cf.createTextColumn<WorkloadData>('name', 'Name', (row) => row.name, {
        onClick: (row) => handleWorkloadClick(row),
        onAltClick,
        // Match object panel link styling for clickable names.
        getClassName: () => 'object-panel-link',
        isInteractive: () => true,
      })
    );

    if (showNamespaceColumn) {
      cf.upsertNamespaceColumn(columns, {
        accessor: (row) => row.namespace ?? '',
        ...namespaceColumnLink,
      });
    }

    const statusColumn = cf.createTextColumn<WorkloadData>(
      'status',
      'Status',
      (row) => row.status,
      {
        getClassName: (row) => backendStatusTextClass(row.statusPresentation),
      }
    );
    statusColumn.sortValue = (row) => row.status.toLowerCase();
    columns.push(statusColumn);

    const readyColumn = cf.createTextColumn<WorkloadData>(
      'ready',
      'Ready',
      (row) => row.ready ?? '—',
      {
        alignHeader: 'center',
        alignData: 'center',
        getClassName: (row) => getReadyClassName(row),
      }
    );
    readyColumn.sortValue = (row) => getReadySortValue(row.ready);
    columns.push(readyColumn);

    const restartsColumn = cf.createTextColumn<WorkloadData>(
      'restarts',
      'Restarts',
      (row) => formatRestartCount(row.restarts),
      {
        alignHeader: 'center',
        alignData: 'center',
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
        getUsage: (row) => workloadRowCpuValue(row, 'usage'),
        getRequest: (row) => workloadRowCpuValue(row, 'request'),
        getLimit: (row) => workloadRowCpuValue(row, 'limit'),
        getVariant: () => 'compact',
        getMetricsStale: () => metricsStale,
        getMetricsError: () => metricsError,
        getMetricsLastUpdated: () => metricsLastUpdated,
        getAnimationKey: (row) => `workload:${row.namespace}/${row.name}:cpu`,
        getShowEmptyState: () => true,
        sortable: true,
        sortValue: (row) =>
          parseCpuToMillicores(
            row.cpuUsage !== null && row.cpuUsage !== undefined ? String(row.cpuUsage) : undefined
          ),
      })
    );

    columns.push(
      cf.createResourceBarColumn<WorkloadData>({
        key: 'memory',
        header: 'Memory',
        type: 'memory',
        getUsage: (row) => workloadRowMemoryValue(row, 'usage'),
        getRequest: (row) => workloadRowMemoryValue(row, 'request'),
        getLimit: (row) => workloadRowMemoryValue(row, 'limit'),
        getVariant: () => 'compact',
        getMetricsStale: () => metricsStale,
        getMetricsError: () => metricsError,
        getMetricsLastUpdated: () => metricsLastUpdated,
        getAnimationKey: (row) => `workload:${row.namespace}/${row.name}:memory`,
        getShowEmptyState: () => true,
        sortable: true,
        sortValue: (row) =>
          parseMemToMB(
            row.memUsage !== null && row.memUsage !== undefined ? String(row.memUsage) : undefined
          ),
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
    namespaceColumnLink,
    onAltClick,
    showNamespaceColumn,
    useShortResourceNames,
  ]);
};

export default useWorkloadTableColumns;
