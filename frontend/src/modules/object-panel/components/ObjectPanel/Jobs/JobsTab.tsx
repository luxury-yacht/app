/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Jobs/JobsTab.tsx
 *
 * Displays a table of Jobs owned by a CronJob.
 * Modeled after PodsTab but without metrics bars.
 */

import React, { useCallback, useMemo } from 'react';
import GridTable, {
  GRIDTABLE_VIRTUALIZATION_DEFAULT,
  type GridColumnDefinition,
} from '@shared/components/tables/GridTable';
import { buildClusterScopedKey } from '@shared/components/tables/GridTable.utils';
import {
  applyColumnSizing,
  createAgeColumn,
  createKindColumn,
  createTextColumn,
  upsertNamespaceColumn,
  type ColumnSizingMap,
} from '@shared/components/tables/columnFactories';
import { useTableSort } from '@hooks/useTableSort';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import ResourceLoadingBoundary from '@shared/components/ResourceLoadingBoundary';
import { useGridTablePersistence } from '@shared/components/tables/persistence/useGridTablePersistence';
import type { types } from '@wailsjs/go/models';
import { useViewState } from '@core/contexts/ViewStateContext';
import { useNamespace } from '@modules/namespace/contexts/NamespaceContext';
import '../shared.css';
import { buildObjectActionItems } from '@shared/hooks/useObjectActions';

// Row type for the jobs table, combining job info with cluster context.
interface JobRow {
  kind: string;
  name: string;
  namespace: string;
  status: string;
  completions: string;
  succeeded: number;
  failed: number;
  active: number;
  startTime?: any;
  duration?: string;
  age: string;
  clusterId?: string | null;
  clusterName?: string | null;
}

interface JobsTabProps {
  jobs: types.JobSimpleInfo[];
  loading: boolean;
  isActive: boolean;
  clusterId?: string | null;
  clusterName?: string | null;
}

const COLUMN_SIZING: ColumnSizingMap = {
  kind: { autoWidth: true },
  name: { autoWidth: true },
  status: { autoWidth: true },
  completions: { autoWidth: true },
  namespace: { autoWidth: true },
  duration: { autoWidth: true },
  age: { autoWidth: true },
};

// Map job statuses to severity classes for the status badge.
const getJobStatusSeverity = (status: string): string => {
  switch (status) {
    case 'Failed':
      return 'error';
    case 'Running':
      return 'info';
    case 'Suspended':
    case 'Pending':
      return 'warning';
    case 'Completed':
    default:
      return '';
  }
};

export const JobsTab: React.FC<JobsTabProps> = ({
  jobs,
  loading,
  isActive,
  clusterId,
  clusterName,
}) => {
  const { openWithObject, objectData } = useObjectPanel();
  const viewState = useViewState();
  const namespaceContext = useNamespace();

  // Augment each job with cluster context from the panel.
  const jobRows = useMemo<JobRow[]>(
    () =>
      jobs.map((job) => ({
        ...job,
        clusterId: clusterId ?? objectData?.clusterId,
        clusterName: clusterName ?? objectData?.clusterName,
      })),
    [jobs, clusterId, clusterName, objectData?.clusterId, objectData?.clusterName]
  );

  const keyExtractor = useCallback(
    (job: JobRow) => buildClusterScopedKey(job, `${job.namespace}:${job.name}`),
    []
  );

  const getJobClusterMeta = useCallback(
    (job: JobRow) => ({
      clusterId: job.clusterId ?? undefined,
      clusterName: job.clusterName ?? undefined,
    }),
    []
  );

  const handleNamespaceSelect = useCallback(
    (job: JobRow) => {
      if (!job.namespace) {
        return;
      }
      namespaceContext.setSelectedNamespace(job.namespace, job.clusterId ?? undefined);
      viewState.onNamespaceSelect(job.namespace);
      viewState.setActiveNamespaceTab('workloads');
    },
    [namespaceContext, viewState]
  );

  const columns = useMemo<GridColumnDefinition<JobRow>[]>(() => {
    const base: GridColumnDefinition<JobRow>[] = [
      createKindColumn<JobRow>({
        getKind: () => 'Job',
        onClick: (job) =>
          openWithObject({
            kind: 'Job',
            name: job.name,
            namespace: job.namespace,
            ...getJobClusterMeta(job),
          }),
        sortable: false,
      }),
      createTextColumn<JobRow>('name', 'Name', {
        onClick: (job) =>
          openWithObject({
            kind: 'Job',
            name: job.name,
            namespace: job.namespace,
            ...getJobClusterMeta(job),
          }),
        getClassName: () => 'object-panel-link',
        getTitle: (job) => job.name,
      }),
      createTextColumn<JobRow>('status', 'Status', (job) => job.status || '\u2014', {
        getClassName: (job) => {
          const severity = getJobStatusSeverity(job.status);
          return ['status-badge', severity].join(' ').trim();
        },
      }),
      createTextColumn<JobRow>('completions', 'Completions', (job) => job.completions || '\u2014', {
        className: 'text-right',
      }),
      createTextColumn<JobRow>('duration', 'Duration', (job) => job.duration || '\u2014'),
    ];

    upsertNamespaceColumn(base, {
      accessor: (job) => job.namespace,
      onClick: handleNamespaceSelect,
      isInteractive: (job) => Boolean(job.namespace),
      getClassName: () => 'object-panel-link',
    });

    base.push(
      createAgeColumn<JobRow & { age?: string }>(
        'age',
        'Age',
        (job) => job.age ?? '\u2014'
      ) as GridColumnDefinition<JobRow>
    );

    applyColumnSizing(base, COLUMN_SIZING);
    return base;
  }, [handleNamespaceSelect, getJobClusterMeta, openWithObject]);

  const {
    sortConfig,
    setSortConfig,
    columnWidths,
    setColumnWidths,
    columnVisibility,
    setColumnVisibility,
    filters,
    setFilters,
    resetState,
  } = useGridTablePersistence<JobRow>({
    viewId: 'object-panel-jobs',
    // Use the panel-scoped cluster ID, not the global sidebar selection.
    clusterIdentity: objectData?.clusterId ?? '',
    namespace: null,
    isNamespaceScoped: false,
    columns,
    data: jobRows,
    keyExtractor,
  });

  const {
    sortedData,
    sortConfig: tableSort,
    handleSort,
  } = useTableSort(jobRows, undefined, 'asc', {
    columns,
    controlledSort: sortConfig,
    onChange: setSortConfig,
  });

  const getSearchTokens = useCallback((job: JobRow) => {
    const tokens = [job.name, job.namespace, job.status];
    return tokens.filter((token): token is string => Boolean(token));
  }, []);

  return (
    <div className="object-panel-pods">
      <div className="object-panel-pods__table">
        <ResourceLoadingBoundary
          loading={loading}
          dataLength={sortedData.length}
          hasLoaded={!loading || sortedData.length > 0}
          spinnerMessage="Loading jobs..."
        >
          <GridTable<JobRow>
            data={sortedData}
            columns={columns}
            onSort={handleSort}
            sortConfig={tableSort}
            keyExtractor={keyExtractor}
            onRowClick={(job) =>
              openWithObject({
                kind: 'Job',
                name: job.name,
                namespace: job.namespace,
                ...getJobClusterMeta(job),
              })
            }
            enableContextMenu
            getCustomContextMenuItems={(job) =>
              buildObjectActionItems({
                object: {
                  kind: 'Job',
                  name: job.name,
                  namespace: job.namespace,
                  ...getJobClusterMeta(job),
                },
                context: 'gridtable',
                handlers: {
                  onOpen: () =>
                    openWithObject({
                      kind: 'Job',
                      name: job.name,
                      namespace: job.namespace,
                      ...getJobClusterMeta(job),
                    }),
                },
                permissions: {},
              })
            }
            tableClassName="gridtable-pods gridtable-pods--namespaced"
            filters={{
              enabled: true,
              value: filters,
              onChange: setFilters,
              onReset: resetState,
              accessors: {
                getKind: () => 'Job',
                getNamespace: (job) => job.namespace,
                getSearchText: getSearchTokens,
              },
            }}
            virtualization={GRIDTABLE_VIRTUALIZATION_DEFAULT}
            columnWidths={columnWidths}
            onColumnWidthsChange={setColumnWidths}
            columnVisibility={columnVisibility}
            onColumnVisibilityChange={setColumnVisibility}
            allowHorizontalOverflow={true}
            loading={loading && sortedData.length === 0}
            loadingOverlay={{
              show: loading && sortedData.length > 0,
              message: 'Updating jobs\u2026',
            }}
            hideHeader={!isActive}
          />
        </ResourceLoadingBoundary>
      </div>
    </div>
  );
};
