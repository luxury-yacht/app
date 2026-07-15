import { namespaceAggregateUsageDisplay } from '@core/resource-metrics';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { type BoundedRowsMode, boundedRowsSource } from '@modules/resource-grid/boundedRowsSource';
import ResourceInventoryTable from '@modules/resource-grid/ResourceInventoryTable';
import { useClusterResourceGridTable } from '@modules/resource-grid/useResourceGridTable';
import type { DropdownOption } from '@shared/components/dropdowns/Dropdown';
import * as cf from '@shared/components/tables/columnFactories';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable';
import { TABLE_PAGE_SIZE_OPTIONS } from '@shared/components/tables/pageSizeOptions';
import { useGridTablePersistence } from '@shared/components/tables/persistence/useGridTablePersistence';
import { backendStatusTextClass } from '@shared/utils/backendStatusPresentation';
import {
  buildRequiredCanonicalObjectRowKey,
  buildRequiredObjectReference,
} from '@shared/utils/objectIdentity';
import React, { useCallback, useMemo } from 'react';
import type { NamespaceSignalState, NamespaceSummary } from '@/core/refresh/types';
import { useDefaultTablePageSize } from '@/hooks/useDefaultTablePageSize';

export interface NamespaceTableRow extends NamespaceSummary {
  group: string;
  version: string;
  kind: string;
  namespace: string;
  ageTimestamp?: number;
  metricsState: NamespaceSignalState;
}

interface NamespaceSummaryTableProps {
  rows: NamespaceTableRow[];
  navigate: (row: NamespaceTableRow) => void;
  navigateCluster?: (row: NamespaceTableRow) => void;
  enableRowNavigation?: boolean;
  showClusterColumn?: boolean;
  clusterOptions?: DropdownOption[];
  clusterIdentity: string;
  persistenceEnabled: boolean;
  loading: boolean;
  loaded: boolean;
  error?: string | null;
  blocked?: boolean;
  tableMode: BoundedRowsMode;
  partialLabel?: string | null;
  cacheKey: string;
  emptyMessage: string;
}

export const projectNamespaceSummary = (
  namespace: NamespaceSummary,
  metricsState: NamespaceSignalState
): NamespaceTableRow => ({
  ...namespace,
  clusterId: namespace.ref.clusterId,
  group: namespace.ref.group,
  version: namespace.ref.version,
  kind: namespace.ref.kind,
  namespace: namespace.ref.namespace ?? '',
  name: namespace.ref.name ?? namespace.name,
  ageTimestamp: namespace.creationTimestamp > 0 ? namespace.creationTimestamp * 1000 : undefined,
  metricsState,
});

const unavailableSignalText = (state: NamespaceSignalState): string =>
  state === 'loading' ? 'Loading' : 'Unavailable';

const workloadText = (row: NamespaceTableRow): string => {
  if (row.workloadsUnknown) {
    return 'Unknown';
  }
  return row.hasWorkloads ? '✓' : '-';
};

const workloadSearchText = (row: NamespaceTableRow): string => {
  if (row.workloadsUnknown) {
    return 'Unknown';
  }
  return row.hasWorkloads ? 'Present' : 'None';
};

const warningEventText = (row: NamespaceTableRow): string =>
  row.warningEventsState === 'available'
    ? (row.warningEvents ?? 0) > 0
      ? String(row.warningEvents)
      : '-'
    : unavailableSignalText(row.warningEventsState);

const quotaPressureText = (row: NamespaceTableRow): string => {
  if (row.quotaPressureState !== 'available') {
    return unavailableSignalText(row.quotaPressureState);
  }
  if ((row.quotaCount ?? 0) === 0) {
    return 'No quotas';
  }
  return `${row.quotaHighestUsedPercentage ?? 0}%`;
};

const createNamespaceResourceColumn = (
  type: 'cpu' | 'memory'
): GridColumnDefinition<NamespaceTableRow> => {
  const usageNumber = (row: NamespaceTableRow): number =>
    type === 'cpu' ? (row.cpuUsageMilli ?? 0) : (row.memoryUsageBytes ?? 0);
  const requestNumber = (row: NamespaceTableRow): number =>
    type === 'cpu' ? (row.cpuRequestsMilli ?? 0) : (row.memoryRequestsBytes ?? 0);
  const limitNumber = (row: NamespaceTableRow): number =>
    type === 'cpu' ? (row.cpuLimitsMilli ?? 0) : (row.memoryLimitsBytes ?? 0);
  const resourceDisplay = (cpuMilli: number, memoryBytes: number): string => {
    const display = namespaceAggregateUsageDisplay(cpuMilli, memoryBytes);
    return type === 'cpu' ? display.cpu : display.memory;
  };
  const column = cf.createResourceBarColumn<NamespaceTableRow>({
    key: type,
    header: type === 'cpu' ? 'CPU' : 'Memory',
    type,
    getUsage: (row) => resourceDisplay(row.cpuUsageMilli ?? 0, row.memoryUsageBytes ?? 0),
    getRequest: (row) =>
      requestNumber(row) > 0
        ? resourceDisplay(row.cpuRequestsMilli ?? 0, row.memoryRequestsBytes ?? 0)
        : undefined,
    getLimit: (row) =>
      limitNumber(row) > 0
        ? resourceDisplay(row.cpuLimitsMilli ?? 0, row.memoryLimitsBytes ?? 0)
        : undefined,
    getVariant: () => 'compact',
    getAnimationKey: (row) => `${buildRequiredCanonicalObjectRowKey(row)}:${type}`,
    sortable: true,
    sortValue: (row) => (row.metricsState === 'available' ? usageNumber(row) : undefined),
  });

  return {
    ...column,
    render: (row) => {
      if (row.metricsState !== 'available') {
        return unavailableSignalText(row.metricsState);
      }
      return usageNumber(row) > 0 || requestNumber(row) > 0 || limitNumber(row) > 0
        ? column.render(row)
        : '-';
    },
  };
};

const NamespaceSummaryTable: React.FC<NamespaceSummaryTableProps> = ({
  rows,
  navigate,
  navigateCluster,
  enableRowNavigation = true,
  showClusterColumn = false,
  clusterOptions = [],
  clusterIdentity,
  persistenceEnabled,
  loading,
  loaded,
  error = null,
  blocked = false,
  tableMode,
  partialLabel = null,
  cacheKey,
  emptyMessage,
}) => {
  const defaultPageSize = useDefaultTablePageSize();
  const { openWithObject } = useObjectPanel();
  const openNamespaceObject = useCallback(
    (row: NamespaceTableRow) => openWithObject(buildRequiredObjectReference(row.ref)),
    [openWithObject]
  );
  const columns = useMemo<GridColumnDefinition<NamespaceTableRow>[]>(() => {
    const result: GridColumnDefinition<NamespaceTableRow>[] = [
      cf.createKindColumn<NamespaceTableRow>({
        getKind: (row) => row.kind,
        onClick: openNamespaceObject,
        isInteractive: (row) => !row.scopeStatus,
        allowRowClick: false,
      }),
      cf.createTextColumn<NamespaceTableRow>('name', 'Namespace', (row) => row.name, {
        onClick: navigate,
        getClassName: () => 'object-panel-link',
        isInteractive: (row) => !row.scopeStatus,
      }),
    ];
    if (showClusterColumn) {
      result.push(
        cf.createTextColumn('cluster', 'Cluster', (row) => row.clusterName || row.clusterId, {
          onClick: navigateCluster,
          getClassName: () => 'object-panel-link',
        })
      );
    }
    result.push(
      {
        key: 'status',
        header: 'Status',
        sortable: true,
        sortValue: (row) => row.status ?? row.phase,
        render: (row) => (
          <span className={backendStatusTextClass(row.statusPresentation)}>
            {row.status ?? row.phase ?? 'Unknown'}
          </span>
        ),
      },
      cf.createTextColumn('workloads', 'Workloads', workloadText, {
        alignHeader: 'center',
        alignData: 'center',
      }),
      {
        key: 'unhealthyWorkloads',
        header: 'Attn',
        alignHeader: 'center',
        alignData: 'center',
        sortable: true,
        sortValue: (row) => row.unhealthyWorkloads ?? 0,
        render: (row) => {
          const count = row.unhealthyWorkloads ?? 0;
          return (
            <span className={count > 0 ? 'status-text warning' : 'status-text'}>
              {count > 0 ? count : '-'}
            </span>
          );
        },
      },
      cf.createTextColumn('warningEvents', 'Warn', warningEventText, {
        alignHeader: 'center',
        alignData: 'center',
        sortValue: (row) =>
          row.warningEventsState === 'available' ? (row.warningEvents ?? 0) : undefined,
        getClassName: (row) =>
          row.warningEventsState === 'available' && (row.warningEvents ?? 0) > 0
            ? 'status-text warning'
            : 'status-text',
      }),
      createNamespaceResourceColumn('cpu'),
      createNamespaceResourceColumn('memory'),
      cf.createTextColumn('quotaPressure', 'Quota pressure', quotaPressureText, {
        sortValue: (row) =>
          row.quotaPressureState === 'available'
            ? (row.quotaHighestUsedPercentage ?? 0)
            : undefined,
        getClassName: (row) =>
          row.quotaPressure === 'critical'
            ? 'status-text error'
            : row.quotaPressure === 'warning'
              ? 'status-text warning'
              : 'status-text',
      }),
      cf.createAgeColumn<NamespaceTableRow>()
    );
    cf.applyColumnSizing(result, {
      kind: { autoWidth: true },
      name: { autoWidth: true },
      cluster: { autoWidth: true },
      status: { autoWidth: true },
      workloads: { autoWidth: true },
      unhealthyWorkloads: { autoWidth: true },
      warningEvents: { autoWidth: true },
      cpu: { width: 200, minWidth: 200 },
      memory: { width: 200, minWidth: 200 },
      quotaPressure: { autoWidth: true },
      age: { autoWidth: true },
    });
    return result;
  }, [navigate, navigateCluster, openNamespaceObject, showClusterColumn]);

  const keyExtractor = useCallback(
    (row: NamespaceTableRow) => buildRequiredCanonicalObjectRowKey(row),
    []
  );
  const resolvedViewId = showClusterColumn ? 'global-namespaces' : 'cluster-namespaces';
  const persistence = useGridTablePersistence({
    viewId: resolvedViewId,
    clusterIdentity,
    isNamespaceScoped: false,
    columns,
    data: rows,
    keyExtractor,
    enabled: persistenceEnabled,
    filterOptions: showClusterColumn
      ? { clusters: clusterOptions.map(({ value }) => value) }
      : undefined,
    pageSizeOptions: TABLE_PAGE_SIZE_OPTIONS,
  });
  const { gridTableProps, favModal } = useClusterResourceGridTable({
    viewId: resolvedViewId,
    tableMode: tableMode === 'Local Partial' ? 'Local Partial' : 'Local Complete',
    data: rows,
    columns,
    keyExtractor,
    persistenceOverride: persistence,
    defaultSortKey: 'name',
    defaultSortDirection: 'asc',
    diagnosticsLabel: 'Namespaces',
    showKindDropdown: false,
    filterOptionOverrides: showClusterColumn
      ? {
          clusters: clusterOptions,
          showClusterDropdown: true,
          clusterDropdownSearchable: true,
          clusterDropdownBulkActions: true,
        }
      : undefined,
    filterAccessors: {
      getCluster: (row) => row.clusterId,
      getSearchText: (row) => [
        row.kind,
        row.name,
        ...(showClusterColumn ? [row.clusterName, row.clusterId] : []),
        row.status ?? row.phase,
        workloadSearchText(row),
        warningEventText(row),
        quotaPressureText(row),
      ],
    },
  });
  const source = boundedRowsSource({
    rows,
    loading,
    loaded,
    error,
    blocked,
    mode: tableMode,
    partialLabel,
    cacheKey,
  });

  return (
    <ResourceInventoryTable
      source={source}
      gridTableProps={gridTableProps}
      columns={columns}
      spinnerMessage="Loading namespaces..."
      updatingMessage="Updating namespaces…"
      emptyMessage={emptyMessage}
      diagnosticsLabel="Namespaces"
      diagnosticsMode="local"
      localPagination={{
        idPrefix: `${resolvedViewId}-${clusterIdentity}`,
        pageSize: persistence.pageSize ?? defaultPageSize,
        pageSizeOptions: TABLE_PAGE_SIZE_OPTIONS,
        onPageSizeChange: persistence.setPageSize,
      }}
      enableColumnVisibilityMenu
      allowHorizontalOverflow
      {...(enableRowNavigation ? { onRowClick: navigate, onRowPointerClick: navigate } : {})}
      favModal={favModal}
    />
  );
};

export default React.memo(NamespaceSummaryTable);
