/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Jobs/JobsTab.tsx
 *
 * Displays a table of Jobs owned by a CronJob.
 * Modeled after PodsTab but without metrics bars.
 */

import React, { useCallback, useMemo } from 'react';
import GridTable, { type GridColumnDefinition } from '@shared/components/tables/GridTable';
import {
  applyColumnSizing,
  createAgeColumn,
  createKindColumn,
  createTextColumn,
  upsertNamespaceColumn,
  type ColumnSizingMap,
} from '@shared/components/tables/columnFactories';
import { useNavigateToView } from '@shared/hooks/useNavigateToView';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import ResourceLoadingBoundary from '@shared/components/ResourceLoadingBoundary';
import type { types } from '@wailsjs/go/models';
import { useViewState } from '@core/contexts/ViewStateContext';
import { useNamespace } from '@modules/namespace/contexts/NamespaceContext';
import '../shared.css';
import { useObjectActionController } from '@shared/hooks/useObjectActionController';
import { useObjectPanelResourceGridTable } from '@shared/hooks/useResourceGridTable';
import {
  buildRequiredCanonicalObjectRowKey,
  buildRequiredObjectReference,
} from '@shared/utils/objectIdentity';

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
  const { navigateToView } = useNavigateToView();
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
    (job: JobRow) =>
      buildRequiredCanonicalObjectRowKey(
        {
          kind: 'Job',
          name: job.name,
          namespace: job.namespace,
          clusterId: job.clusterId,
        },
        { fallbackClusterId: objectData?.clusterId }
      ),
    [objectData?.clusterId]
  );

  const handleJobOpen = useCallback(
    (job: JobRow) => {
      openWithObject(
        buildRequiredObjectReference(
          {
            kind: 'Job',
            name: job.name,
            namespace: job.namespace,
            clusterId: job.clusterId,
            clusterName: job.clusterName ?? undefined,
          },
          { fallbackClusterId: objectData?.clusterId }
        )
      );
    },
    [objectData?.clusterId, openWithObject]
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
        onClick: handleJobOpen,
        onAltClick: (job) =>
          navigateToView(
            buildRequiredObjectReference(
              {
                kind: 'Job',
                name: job.name,
                namespace: job.namespace,
                clusterId: job.clusterId,
                clusterName: job.clusterName,
              },
              { fallbackClusterId: objectData?.clusterId }
            )
          ),
        sortable: false,
      }),
      createTextColumn<JobRow>('name', 'Name', {
        onClick: handleJobOpen,
        onAltClick: (job) =>
          navigateToView(
            buildRequiredObjectReference(
              {
                kind: 'Job',
                name: job.name,
                namespace: job.namespace,
                clusterId: job.clusterId,
                clusterName: job.clusterName,
              },
              { fallbackClusterId: objectData?.clusterId }
            )
          ),
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
  }, [handleJobOpen, handleNamespaceSelect, navigateToView, objectData?.clusterId]);

  const getSearchTokens = useCallback((job: JobRow) => {
    const tokens = [job.name, job.namespace, job.status];
    return tokens.filter((token): token is string => Boolean(token));
  }, []);

  const { gridTableProps } = useObjectPanelResourceGridTable<JobRow>({
    viewId: 'object-panel-jobs',
    clusterIdentity: objectData?.clusterId ?? '',
    enabled: Boolean(objectData?.clusterId),
    data: jobRows,
    columns,
    keyExtractor,
    diagnosticsLabel: 'Object Panel Jobs',
    defaultSort: { key: 'name', direction: 'asc' },
    filterAccessors: {
      getKind: () => 'Job',
      getNamespace: (job) => job.namespace,
      getSearchText: getSearchTokens,
    },
  });

  const objectActions = useObjectActionController({
    context: 'gridtable',
    useDefaultHandlers: false,
    onOpen: (object) => openWithObject(object),
    onOpenObjectMap: (object) => openWithObject(object, { initialTab: 'map' }),
  });

  return (
    <div className="object-panel-pods">
      <div className="object-panel-pods__table">
        <ResourceLoadingBoundary
          loading={loading}
          dataLength={gridTableProps.data.length}
          hasLoaded={!loading || gridTableProps.data.length > 0}
          spinnerMessage="Loading jobs..."
        >
          <GridTable<JobRow>
            {...gridTableProps}
            columns={columns}
            diagnosticsLabel="Object Panel Jobs"
            diagnosticsMode="live"
            keyExtractor={keyExtractor}
            onRowClick={handleJobOpen}
            enableContextMenu
            getCustomContextMenuItems={(job) =>
              objectActions.getMenuItems(
                buildRequiredObjectReference(
                  {
                    kind: 'Job',
                    name: job.name,
                    namespace: job.namespace,
                    clusterId: job.clusterId,
                    clusterName: job.clusterName ?? undefined,
                  },
                  { fallbackClusterId: objectData?.clusterId }
                )
              )
            }
            tableClassName="gridtable-pods gridtable-pods--namespaced"
            loading={loading && gridTableProps.data.length === 0}
            loadingOverlay={{
              show: loading && gridTableProps.data.length > 0,
              message: 'Updating jobs\u2026',
            }}
            hideHeader={!isActive}
          />
        </ResourceLoadingBoundary>
      </div>
      {objectActions.modals}
    </div>
  );
};
