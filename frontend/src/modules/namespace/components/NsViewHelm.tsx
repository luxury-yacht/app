/**
 * frontend/src/modules/namespace/components/NsViewHelm.tsx
 *
 * UI component for NsViewHelm.
 * Handles rendering and interactions for the namespace feature.
 */

import './NsViewHelm.css';
import { getDisplayKind } from '@/utils/kindAliasMap';
import { resolveEmptyStateMessage } from '@/utils/emptyState';
import { useNavigateToView } from '@shared/hooks/useNavigateToView';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { useShortNames } from '@/hooks/useShortNames';
import * as cf from '@shared/components/tables/columnFactories';
import React, { useMemo, useCallback } from 'react';
import ResourceGridTableView from '@shared/components/tables/ResourceGridTableView';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import { buildObjectActionItems } from '@shared/hooks/useObjectActions';
import { type GridColumnDefinition } from '@shared/components/tables/GridTable';
import { buildClusterScopedKey } from '@shared/components/tables/GridTable.utils';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import { useNamespaceColumnLink } from '@modules/namespace/components/useNamespaceColumnLink';
import { useNamespaceResourceGridTable } from '@shared/hooks/useResourceGridTable';
import { buildSyntheticObjectReference } from '@shared/utils/objectIdentity';

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
  notes?: string;
  age?: string;
  [key: string]: any; // Allow additional fields
}

interface HelmViewProps {
  namespace: string;
  data: HelmData[];
  loading?: boolean;
  loaded?: boolean;
  showNamespaceColumn?: boolean;
}

/**
 * GridTable component for namespace Helm releases
 */
const HelmViewGrid: React.FC<HelmViewProps> = React.memo(
  ({ namespace, data, loading = false, loaded = false, showNamespaceColumn = false }) => {
    const { openWithObject } = useObjectPanel();
    const { navigateToView } = useNavigateToView();
    const useShortResourceNames = useShortNames();
    const namespaceColumnLink = useNamespaceColumnLink<HelmData>('helm');
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
            getClassName: (resource) => {
              const status = (resource.status || resource.info?.status || 'unknown').toLowerCase();
              return `helm-status status-${status}`;
            },
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
            const description =
              resource.description || resource.info?.description || resource.notes;
            if (!description) {
              return '-';
            }
            return description.length > 60 ? `${description.substring(0, 60)}...` : description;
          },
          {
            getClassName: (resource) =>
              resource.description || resource.info?.description || resource.notes
                ? 'helm-description'
                : undefined,
            getTitle: (resource) =>
              resource.description || resource.info?.description || resource.notes,
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

    const { gridTableProps, favModal } = useNamespaceResourceGridTable<HelmData>({
      viewId: 'namespace-helm',
      namespace,
      data,
      columns,
      keyExtractor,
      defaultSort: { key: 'name', direction: 'asc' },
      diagnosticsLabel:
        namespace === ALL_NAMESPACES_SCOPE ? 'All Namespaces Helm' : 'Namespace Helm',
      showKindDropdown: true,
      showNamespaceFilters: showNamespaceColumn,
      filterOptions: { isNamespaceScoped: namespace !== ALL_NAMESPACES_SCOPE },
    });

    const getContextMenuItems = useCallback(
      (resource: HelmData): ContextMenuItem[] => {
        const status = resource.status || resource.info?.status;

        return buildObjectActionItems({
          object: buildSyntheticObjectReference(
            {
              kind: 'HelmRelease',
              name: resource.name,
              namespace: resource.namespace,
              clusterId: resource.clusterId,
              clusterName: resource.clusterName,
            },
            { status }
          ),
          context: 'gridtable',
          handlers: {
            onOpen: () => handleResourceClick(resource),
          },
          permissions: {},
        });
      },
      [handleResourceClick]
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
        <ResourceGridTableView
          gridTableProps={gridTableProps}
          boundaryLoading={loading ?? false}
          loaded={loaded}
          spinnerMessage="Loading Helm releases..."
          favModal={favModal}
          columns={columns}
          diagnosticsLabel={
            namespace === ALL_NAMESPACES_SCOPE ? 'All Namespaces Helm' : 'Namespace Helm'
          }
          loading={loading}
          keyExtractor={keyExtractor}
          onRowClick={handleResourceClick}
          tableClassName="ns-helm-table"
          enableContextMenu={true}
          getCustomContextMenuItems={getContextMenuItems}
          useShortNames={useShortResourceNames}
          emptyMessage={emptyMessage}
        />
      </>
    );
  }
);

HelmViewGrid.displayName = 'NsViewHelm';

export default HelmViewGrid;
