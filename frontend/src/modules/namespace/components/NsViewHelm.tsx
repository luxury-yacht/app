/**
 * frontend/src/modules/namespace/components/NsViewHelm.tsx
 *
 * UI component for NsViewHelm.
 * Handles rendering and interactions for the namespace feature.
 */

import { getDisplayKind } from '@/utils/kindAliasMap';
import { resolveEmptyStateMessage } from '@/utils/emptyState';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useNavigateToView } from '@shared/hooks/useNavigateToView';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { useShortNames } from '@/hooks/useShortNames';
import * as cf from '@shared/components/tables/columnFactories';
import React, { useMemo, useCallback } from 'react';
import ResourceInventoryTable from '@modules/resource-grid/ResourceInventoryTable';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import { useObjectActionController } from '@shared/hooks/useObjectActionController';
import { type GridColumnDefinition } from '@shared/components/tables/GridTable';
import { buildClusterScopedKey } from '@shared/components/tables/GridTable.utils';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import { useNamespaceColumnLink } from '@modules/namespace/components/useNamespaceColumnLink';
import { useQueryBackedNamespaceResourceGridTable } from '@modules/resource-grid/useQueryBackedResourceGridTable';
import {
  buildLocalPartialDataLabel,
  localTableModeForStats,
} from '@modules/resource-grid/tablePartialState';
import { buildSyntheticObjectReference } from '@shared/utils/objectIdentity';
import { backendStatusTextClass } from '@shared/utils/backendStatusPresentation';
import type { SnapshotStats } from '@/core/refresh/client';
import type { NamespaceHelmSnapshotPayload, NamespaceHelmSummary } from '@/core/refresh/types';

// Data interface for Helm releases
export interface HelmData {
  kind?: string;
  kindAlias?: string;
  name: string;
  namespace: string;
  chart?:
    | {
        name?: string;
        version?: string;
      }
    | string;
  chartVersion?: string;
  appVersion?: string;
  app_version?: string;
  status?: string;
  statusState?: string;
  statusPresentation?: string;
  statusReason?: string;
  info?: {
    status?: string;
    revision?: number;
    last_deployed?: string;
    description?: string;
  };
  revision?: number;
  updated?: string;
  lastDeployed?: string;
  description?: string;
  age?: string;
  ageTimestamp?: number;
  [key: string]: any; // Allow additional fields
}

interface HelmViewProps {
  namespace: string;
  data: HelmData[];
  stats?: SnapshotStats | null;
  loading?: boolean;
  loaded?: boolean;
  showNamespaceColumn?: boolean;
}

/**
 * GridTable component for namespace Helm releases
 */
const HelmViewGrid: React.FC<HelmViewProps> = React.memo(
  ({
    namespace,
    data,
    stats = null,
    loading = false,
    loaded = false,
    showNamespaceColumn = false,
  }) => {
    const { openWithObject } = useObjectPanel();
    const { navigateToView } = useNavigateToView();
    const { selectedClusterId } = useKubeconfig();
    const queryClusterId = selectedClusterId;
    const useShortResourceNames = useShortNames();
    const namespaceColumnLink = useNamespaceColumnLink<HelmData>('helm');
    const objectActions = useObjectActionController({
      context: 'gridtable',
      useDefaultHandlers: false,
      onOpen: (object) => openWithObject(object),
    });
    const handleResourceClick = useCallback(
      (resource: HelmData) => {
        openWithObject(
          buildSyntheticObjectReference({
            kind: 'HelmRelease',
            name: resource.name,
            namespace: resource.namespace,
            clusterId: resource.clusterId ?? undefined,
            clusterName: resource.clusterName ?? undefined,
          })
        );
      },
      [openWithObject]
    );

    const keyExtractor = useCallback(
      (resource: HelmData) =>
        buildClusterScopedKey(
          resource,
          [resource.namespace, 'helm-release', resource.name].filter(Boolean).join('/')
        ),
      []
    );

    const columns: GridColumnDefinition<HelmData>[] = useMemo(() => {
      const baseColumns: GridColumnDefinition<HelmData>[] = [
        cf.createKindColumn<HelmData>({
          key: 'kind',
          getKind: () => 'HelmRelease',
          getDisplayText: () => getDisplayKind('HelmRelease', useShortResourceNames),
          onClick: handleResourceClick,
          onAltClick: (resource) =>
            navigateToView(
              buildSyntheticObjectReference({
                kind: 'HelmRelease',
                name: resource.name,
                namespace: resource.namespace,
                clusterId: resource.clusterId,
                clusterName: resource.clusterName,
              })
            ),
          isInteractive: () => true,
        }),
        cf.createTextColumn<HelmData>('name', 'Name', {
          onClick: handleResourceClick,
          onAltClick: (resource) =>
            navigateToView(
              buildSyntheticObjectReference({
                kind: 'HelmRelease',
                name: resource.name,
                namespace: resource.namespace,
                clusterId: resource.clusterId,
                clusterName: resource.clusterName,
              })
            ),
          getClassName: () => 'object-panel-link',
        }),
      ];

      if (showNamespaceColumn) {
        cf.upsertNamespaceColumn(baseColumns, {
          accessor: (resource) => resource.namespace,
          sortValue: (resource) => (resource.namespace || '').toLowerCase(),
          ...namespaceColumnLink,
        });
      }

      baseColumns.push(
        cf.createTextColumn<HelmData>('chart', 'Chart', (resource) => {
          if (!resource.chart) {
            return '-';
          }

          const chartName =
            typeof resource.chart === 'string' ? resource.chart : resource.chart.name || '';
          const chartVersion =
            typeof resource.chart === 'string'
              ? resource.chartVersion
              : resource.chart.version || resource.chartVersion;

          return chartVersion ? `${chartName} v${chartVersion}` : chartName;
        }),
        cf.createTextColumn<HelmData>(
          'appVersion',
          'App Version',
          (resource) => {
            if (resource.appVersion || resource.app_version) {
              return resource.appVersion || resource.app_version;
            }
            return '-';
          },
          {
            getClassName: (resource) =>
              resource.appVersion || resource.app_version ? 'app-version' : undefined,
          }
        ),
        cf.createTextColumn<HelmData>(
          'status',
          'Status',
          (resource) => {
            const status = resource.status || resource.info?.status || 'unknown';
            return status;
          },
          {
            getClassName: (resource) => backendStatusTextClass(resource.statusPresentation),
          }
        ),
        cf.createTextColumn<HelmData>(
          'revision',
          'Revision',
          (resource) => {
            const revision = resource.revision || resource.info?.revision;
            if (revision !== undefined && revision !== null) {
              return String(revision);
            }
            return '-';
          },
          {
            getClassName: (resource) =>
              resource.revision || resource.info?.revision ? 'revision-number' : undefined,
          }
        ),
        cf.createTextColumn<HelmData>(
          'updated',
          'Updated',
          (resource) => {
            const updated =
              resource.updated || resource.info?.last_deployed || resource.lastDeployed;
            if (updated) {
              const date = new Date(updated);
              if (!Number.isNaN(date.getTime())) {
                const formatted = `${date.toLocaleDateString()} ${date.toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}`;
                return formatted;
              }
            }
            return '-';
          },
          {
            sortValue: (resource) =>
              resource.updated || resource.info?.last_deployed || resource.lastDeployed,
            getClassName: (resource) =>
              resource.updated || resource.info?.last_deployed || resource.lastDeployed
                ? 'last-updated'
                : undefined,
            getTitle: (resource) => {
              const updated =
                resource.updated || resource.info?.last_deployed || resource.lastDeployed;
              if (!updated) {
                return undefined;
              }
              const date = new Date(updated);
              return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
            },
          }
        ),
        cf.createTextColumn<HelmData>(
          'description',
          'Description',
          (resource) => {
            const description = resource.description || resource.info?.description;
            if (!description) {
              return '-';
            }
            return description.length > 60 ? `${description.substring(0, 60)}...` : description;
          },
          {
            getClassName: (resource) =>
              resource.description || resource.info?.description ? 'helm-description' : undefined,
            getTitle: (resource) => resource.description || resource.info?.description,
            sortable: false,
          }
        ),
        cf.createAgeColumn()
      );

      const sizing: cf.ColumnSizingMap = {
        kind: { autoWidth: true },
        name: { autoWidth: true },
        namespace: { autoWidth: true },
        chart: { autoWidth: true },
        appVersion: { autoWidth: true },
        status: { autoWidth: true },
        revision: { autoWidth: true },
        updated: { autoWidth: true },
        description: { autoWidth: true },
        age: { autoWidth: true },
      };
      cf.applyColumnSizing(baseColumns, sizing);

      return baseColumns;
    }, [
      handleResourceClick,
      namespaceColumnLink,
      navigateToView,
      showNamespaceColumn,
      useShortResourceNames,
    ]);

    const isAllNamespaces = namespace === ALL_NAMESPACES_SCOPE;
    const localTableMode = localTableModeForStats(stats);
    const diagnosticsLabel = isAllNamespaces ? 'All Namespaces Helm' : 'Namespace Helm';

    const selectRows = useCallback(
      (payload: NamespaceHelmSnapshotPayload) =>
        (payload.rows ?? []).map((release: NamespaceHelmSummary) => ({
          kind: 'HelmRelease',
          name: release.name,
          namespace: release.namespace,
          clusterId: release.clusterId,
          clusterName: release.clusterName,
          chart: release.chart,
          appVersion: release.appVersion,
          status: release.status,
          revision: release.revision,
          updated: release.updated,
          description: release.description,
          age: release.age,
          ageTimestamp: release.ageTimestamp,
        })),
      []
    );
    const { gridTableProps, favModal, source } = useQueryBackedNamespaceResourceGridTable<
      NamespaceHelmSnapshotPayload,
      HelmData
    >({
      enabled: isAllNamespaces,
      queryTableMode: 'Query Backed Static',
      clusterId: queryClusterId,
      domain: 'namespace-helm',
      label: 'All Namespaces Helm',
      localData: data,
      localLoading: loading,
      localLoaded: loaded,
      localTableMode,
      selectRows,
      viewId: 'namespace-helm',
      namespace,
      columns,
      keyExtractor,
      defaultSort: { key: 'name', direction: 'asc' },
      diagnosticsLabel,
      showKindDropdown: true,
      showNamespaceFilters: showNamespaceColumn,
      filterOptions: { isNamespaceScoped: !isAllNamespaces },
      filterOptionOverrides:
        localTableMode === 'Local Partial' && !isAllNamespaces
          ? {
              partialDataLabel: buildLocalPartialDataLabel({
                stats,
                fallback: `${diagnosticsLabel} is loaded as a bounded local snapshot.`,
                sourceLabel: diagnosticsLabel,
              }),
            }
          : undefined,
    });

    const getContextMenuItems = useCallback(
      (resource: HelmData): ContextMenuItem[] => {
        const status = resource.status || resource.info?.status;

        return objectActions.getMenuItems(
          buildSyntheticObjectReference(
            {
              kind: 'HelmRelease',
              name: resource.name,
              namespace: resource.namespace,
              clusterId: resource.clusterId,
              clusterName: resource.clusterName,
            },
            { status }
          )
        );
      },
      [objectActions]
    );

    const emptyMessage = useMemo(
      () =>
        resolveEmptyStateMessage(
          undefined,
          `No helm objects found ${namespace === ALL_NAMESPACES_SCOPE ? 'in any namespaces' : 'in this namespace'}`
        ),
      [namespace]
    );

    return (
      <>
        <ResourceInventoryTable
          source={source}
          gridTableProps={gridTableProps}
          spinnerMessage="Loading Helm releases..."
          favModal={favModal}
          columns={columns}
          diagnosticsLabel={
            namespace === ALL_NAMESPACES_SCOPE ? 'All Namespaces Helm' : 'Namespace Helm'
          }
          onRowClick={handleResourceClick}
          tableClassName="ns-helm-table"
          enableContextMenu={true}
          getCustomContextMenuItems={getContextMenuItems}
          useShortNames={useShortResourceNames}
          emptyMessage={emptyMessage}
        />
        {objectActions.modals}
      </>
    );
  }
);

HelmViewGrid.displayName = 'NsViewHelm';

export default HelmViewGrid;
