import { useViewState } from '@core/contexts/ViewStateContext';
import { namespaceAggregateUsageDisplay } from '@core/resource-metrics';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useNamespace } from '@modules/namespace/contexts/NamespaceContext';
import { boundedRowsSource } from '@modules/resource-grid/boundedRowsSource';
import ResourceInventoryTable from '@modules/resource-grid/ResourceInventoryTable';
import { useClusterResourceGridTable } from '@modules/resource-grid/useResourceGridTable';
import * as cf from '@shared/components/tables/columnFactories';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable';
import { useGridTablePersistence } from '@shared/components/tables/persistence/useGridTablePersistence';
import { backendStatusTextClass } from '@shared/utils/backendStatusPresentation';
import { buildRequiredCanonicalObjectRowKey } from '@shared/utils/objectIdentity';
import React, { useCallback, useMemo } from 'react';
import type { NamespaceSignalState, NamespaceSummary } from '@/core/refresh/types';

interface NamespaceTableRow extends NamespaceSummary {
  group: string;
  version: string;
  kind: string;
  namespace: string;
  ageTimestamp?: number;
  metricsState: NamespaceSignalState;
}

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

const ClusterViewNamespaces: React.FC = () => {
  const { selectedClusterId } = useKubeconfig();
  const {
    namespaceSummaries,
    namespaceMetricsState,
    namespaceError,
    namespaceLoading,
    namespacesPermissionDenied,
    setSelectedNamespace,
  } = useNamespace();
  const { onNamespaceSelect } = useViewState();

  const rows = useMemo<NamespaceTableRow[]>(() => {
    if (!selectedClusterId) {
      return [];
    }
    return namespaceSummaries
      .filter((namespace) => namespace.clusterId === selectedClusterId)
      .map((namespace) => ({
        ...namespace,
        clusterId: namespace.ref.clusterId,
        group: namespace.ref.group,
        version: namespace.ref.version,
        kind: namespace.ref.kind,
        namespace: namespace.ref.namespace ?? '',
        name: namespace.ref.name ?? namespace.name,
        ageTimestamp:
          namespace.creationTimestamp > 0 ? namespace.creationTimestamp * 1000 : undefined,
        metricsState: namespaceMetricsState,
      }));
  }, [namespaceMetricsState, namespaceSummaries, selectedClusterId]);

  const navigate = useCallback(
    (row: NamespaceTableRow) => {
      if (row.scopeStatus) {
        return;
      }
      setSelectedNamespace(row.name, row.clusterId);
      onNamespaceSelect(row.name);
    },
    [onNamespaceSelect, setSelectedNamespace]
  );

  const columns = useMemo<GridColumnDefinition<NamespaceTableRow>[]>(() => {
    const result: GridColumnDefinition<NamespaceTableRow>[] = [
      cf.createTextColumn<NamespaceTableRow>('name', 'Namespace', (row) => row.name, {
        onClick: navigate,
        getClassName: () => 'object-panel-link',
        isInteractive: (row) => !row.scopeStatus,
      }),
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
      cf.createTextColumn(
        'cpu',
        'CPU',
        (row) =>
          row.metricsState === 'available'
            ? (row.cpuUsageMilli ?? 0) > 0
              ? namespaceAggregateUsageDisplay(row.cpuUsageMilli ?? 0, row.memoryUsageBytes ?? 0)
                  .cpu
              : '-'
            : unavailableSignalText(row.metricsState),
        {
          sortValue: (row) =>
            row.metricsState === 'available' ? (row.cpuUsageMilli ?? 0) : undefined,
        }
      ),
      cf.createTextColumn(
        'memory',
        'Memory',
        (row) =>
          row.metricsState === 'available'
            ? (row.memoryUsageBytes ?? 0) > 0
              ? namespaceAggregateUsageDisplay(row.cpuUsageMilli ?? 0, row.memoryUsageBytes ?? 0)
                  .memory
              : '-'
            : unavailableSignalText(row.metricsState),
        {
          sortValue: (row) =>
            row.metricsState === 'available' ? (row.memoryUsageBytes ?? 0) : undefined,
        }
      ),
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
      cf.createAgeColumn<NamespaceTableRow>(),
    ];
    cf.applyColumnSizing(result, {
      name: { autoWidth: true },
      status: { autoWidth: true },
      workloads: { autoWidth: true },
      unhealthyWorkloads: { autoWidth: true },
      warningEvents: { autoWidth: true },
      cpu: { autoWidth: true },
      memory: { autoWidth: true },
      quotaPressure: { autoWidth: true },
      age: { autoWidth: true },
    });
    return result;
  }, [navigate]);

  const keyExtractor = useCallback(
    (row: NamespaceTableRow) => buildRequiredCanonicalObjectRowKey(row),
    []
  );
  const persistence = useGridTablePersistence({
    viewId: 'cluster-namespaces',
    clusterIdentity: selectedClusterId ?? '',
    isNamespaceScoped: false,
    columns,
    data: rows,
    keyExtractor,
    enabled: Boolean(selectedClusterId),
  });
  const { gridTableProps, favModal } = useClusterResourceGridTable({
    viewId: 'cluster-namespaces',
    tableMode: 'Local Complete',
    data: rows,
    columns,
    keyExtractor,
    persistenceOverride: persistence,
    defaultSortKey: 'name',
    defaultSortDirection: 'asc',
    diagnosticsLabel: 'Namespaces',
    showKindDropdown: false,
    filterAccessors: {
      getSearchText: (row) => [
        row.name,
        row.status ?? row.phase,
        workloadSearchText(row),
        warningEventText(row),
        quotaPressureText(row),
      ],
    },
  });

  // Local Complete: the namespaces domain already carries the complete
  // active-cluster namespace set used by the sidebar; this view reuses that
  // resident snapshot and GridTable virtualizes the rendered window.
  const source = boundedRowsSource({
    rows,
    loading: namespaceLoading,
    loaded:
      namespacesPermissionDenied ||
      Boolean(namespaceError) ||
      (Boolean(selectedClusterId) && !namespaceLoading),
    error: namespacesPermissionDenied
      ? 'Insufficient permission to list namespaces'
      : namespaceError,
    blocked: !selectedClusterId,
    mode: 'Local Complete',
    cacheKey: selectedClusterId ? `cluster-namespaces:${selectedClusterId}` : 'cluster-namespaces',
  });

  return (
    <div className="cluster-namespaces">
      <ResourceInventoryTable
        source={source}
        gridTableProps={gridTableProps}
        columns={columns}
        spinnerMessage="Loading namespaces..."
        emptyMessage="No namespaces found"
        diagnosticsLabel="Namespaces"
        diagnosticsMode="local"
        enableColumnVisibilityMenu
        allowHorizontalOverflow
        onRowClick={navigate}
        onRowPointerClick={navigate}
        favModal={favModal}
      />
    </div>
  );
};

export default React.memo(ClusterViewNamespaces);
