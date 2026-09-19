/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Jobs/JobsTab.tsx
 *
 * Displays a table of Jobs owned by a CronJob.
 * Modeled after PodsTab but without metrics bars.
 */

import type { types } from '@core/backend-api/models';
import { useOptionalViewState } from '@core/contexts/ViewStateContext';
import { useNamespace } from '@modules/namespace/contexts/NamespaceContext';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import {
  type ColumnSizingMap,
  createAgeColumn,
  createKindColumn,
  createResourceNameColumn,
  createTextColumn,
  withColumnSizing,
  withNamespaceColumn,
} from '@shared/components/tables/columnFactories';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable';
import { useNavigateToView } from '@shared/hooks/useNavigateToView';
import type React from 'react';
import { useCallback, useMemo } from 'react';
import '../shared.css';
import { ObjectPanelResourceGridTableSurface } from '@modules/resource-grid/ObjectPanelResourceGridTableSurface';
import { useResourceGridObjectIdentity } from '@modules/resource-grid/useResourceGridObjectIdentity';
import { useObjectPanelResourceGridTable } from '@modules/resource-grid/useResourceGridTable';
import { useObjectActionController } from '@shared/hooks/useObjectActionController';
import { backendStatusTextClass } from '@shared/utils/backendStatusPresentation';

// Rows carry the backend job summary plus the panel's cluster context.
type JobRow = types.JobSimpleInfo & {
  clusterId?: string | null;
  clusterName?: string | null;
};

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

export const JobsTab: React.FC<JobsTabProps> = ({
  jobs,
  loading,
  isActive,
  clusterId,
  clusterName,
}) => {
  const { openWithObject, objectData } = useObjectPanel();
  const { available: navigationAvailable, navigateToView } = useNavigateToView();
  const viewState = useOptionalViewState();
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

  const getJobIdentity = useCallback(
    (job: JobRow) => ({
      kind: 'Job',
      name: job.name,
      namespace: job.namespace,
      clusterId: job.clusterId,
      clusterName: job.clusterName,
    }),
    []
  );
  const jobIdentity = useResourceGridObjectIdentity({
    fallbackClusterId: objectData?.clusterId,
    getObject: getJobIdentity,
    openWithObject,
    navigateToView,
  });
  const { open: handleJobOpen, key: keyExtractor, navigate } = jobIdentity;
  const navigateJob = navigationAvailable ? navigate : undefined;

  const handleNamespaceSelect = useCallback(
    (job: JobRow) => {
      if (!job.namespace || !viewState) {
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
        onAltClick: navigateJob,
        sortable: false,
      }),
      createResourceNameColumn<JobRow>({
        onClick: handleJobOpen,
        onAltClick: navigateJob,
        getClassName: () => 'object-panel-link',
        getTitle: (job) => job.name,
      }),
      createTextColumn<JobRow>('status', 'Status', (job) => job.status || '\u2014', {
        getClassName: (job) => backendStatusTextClass(job.statusPresentation),
      }),
      createTextColumn<JobRow>('completions', 'Completions', (job) => job.completions || '\u2014', {
        alignData: 'right',
      }),
      createTextColumn<JobRow>('duration', 'Duration', (job) => job.duration || '\u2014'),
    ];

    const withNamespace = withNamespaceColumn(base, {
      afterColumnKey: 'name',
      accessor: (job) => job.namespace,
      onClick: handleNamespaceSelect,
      isInteractive: (job) => Boolean(job.namespace && viewState),
      getClassName: (job) => (job.namespace && viewState ? 'object-panel-link' : undefined),
    });

    withNamespace.push(createAgeColumn<JobRow>('age', 'Age', (job) => job.age ?? '\u2014'));

    return withColumnSizing(withNamespace, COLUMN_SIZING);
  }, [handleJobOpen, handleNamespaceSelect, navigateJob, viewState]);

  const getSearchTokens = useCallback((job: JobRow) => {
    const tokens = [job.name, job.namespace, job.status];
    return tokens.filter((token): token is string => Boolean(token));
  }, []);

  const { gridTableProps } = useObjectPanelResourceGridTable<JobRow>({
    tableMode: 'Local Complete',
    supportsCustomMetadataColumns: false,
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
        <ObjectPanelResourceGridTableSurface<JobRow>
          gridTableProps={{
            ...gridTableProps,
            // Local-complete table: "all matching rows" is the local row set.
            // fetchAllRows arms the standard scope-toggle + Copy + Export trio.
            fetchAllRows: () => Promise.resolve(jobRows),
            exportFilename: 'object-panel-jobs',
          }}
          columns={columns}
          diagnosticsLabel="Object Panel Jobs"
          onRowClick={handleJobOpen}
          enableContextMenu
          getCustomContextMenuItems={(job) => objectActions.getMenuItems(jobIdentity.ref(job))}
          tableClassName="gridtable-pods gridtable-pods--namespaced"
          loading={loading}
          spinnerMessage="Loading jobs..."
          updatingMessage="Updating jobs..."
          hideHeader={!isActive}
        />
      </div>
      {objectActions.modals}
    </div>
  );
};
