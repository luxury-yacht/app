/**
 * frontend/src/modules/namespace/components/NsViewHelm.tsx
 *
 * UI component for NsViewHelm.
 * Handles rendering and interactions for the namespace feature.
 */

import './NsViewHelm.css';
import { getDisplayKind } from '@/utils/kindAliasMap';
import { resolveEmptyStateMessage } from '@/utils/emptyState';
import { useNamespaceGridTablePersistence } from '@modules/namespace/hooks/useNamespaceGridTablePersistence';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { useShortNames } from '@/hooks/useShortNames';
import { useTableSort } from '@/hooks/useTableSort';
import * as cf from '@shared/components/tables/columnFactories';
import React, { useMemo, useCallback } from 'react';
import ResourceLoadingBoundary from '@shared/components/ResourceLoadingBoundary';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import GridTable, {
  type GridColumnDefinition,
  GRIDTABLE_VIRTUALIZATION_DEFAULT,
} from '@shared/components/tables/GridTable';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';

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
    const useShortResourceNames = useShortNames();

    const handleResourceClick = useCallback(
      (resource: HelmData) => {
        openWithObject({
          kind: 'HelmRelease',
          name: resource.name,
          namespace: resource.namespace,
        });
      },
      [openWithObject]
    );

    const keyExtractor = useCallback((resource: HelmData) => {
      return [resource.namespace, 'helm-release', resource.name].filter(Boolean).join('/');
    }, []);

    const columns: GridColumnDefinition<HelmData>[] = useMemo(() => {
      const baseColumns: GridColumnDefinition<HelmData>[] = [
        cf.createKindColumn<HelmData>({
          key: 'kind',
          getKind: () => 'HelmRelease',
          getDisplayText: () => getDisplayKind('HelmRelease', useShortResourceNames),
          onClick: handleResourceClick,
          isInteractive: () => true,
        }),
        cf.createTextColumn<HelmData>('name', 'Name', {
          onClick: handleResourceClick,
          getClassName: () => 'object-panel-link',
        }),
      ];

      cf.upsertClusterColumn(baseColumns, {
        accessor: (resource) => resource.clusterName ?? resource.clusterId ?? '—',
        sortValue: (resource) => (resource.clusterName ?? resource.clusterId ?? '').toLowerCase(),
      });

      if (showNamespaceColumn) {
        cf.upsertNamespaceColumn(baseColumns, {
          accessor: (resource) => resource.namespace,
          sortValue: (resource) => (resource.namespace || '').toLowerCase(),
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
        cluster: { autoWidth: true },
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
    }, [handleResourceClick, showNamespaceColumn, useShortResourceNames]);

    const isNamespaceScoped = namespace !== ALL_NAMESPACES_SCOPE;

    const {
      sortConfig: persistedSort,
      onSortChange,
      columnWidths,
      setColumnWidths,
      columnVisibility,
      setColumnVisibility,
      filters: persistedFilters,
      setFilters: setPersistedFilters,
      resetState: resetPersistedState,
    } = useNamespaceGridTablePersistence<HelmData>({
      viewId: 'namespace-helm',
      namespace,
      columns,
      data,
      keyExtractor,
      defaultSort: { key: 'name', direction: 'asc' },
      filterOptions: { isNamespaceScoped },
    });

    const { sortedData, sortConfig, handleSort } = useTableSort(data, undefined, 'asc', {
      controlledSort: persistedSort,
      onChange: onSortChange,
    });

    const getContextMenuItems = useCallback(
      (resource: HelmData): ContextMenuItem[] => {
        const items: ContextMenuItem[] = [];

        // Always add Open in Object Panel
        items.push({
          label: 'Open',
          icon: '→',
          onClick: () => handleResourceClick(resource),
        });

        // Add Helm-specific actions
        items.push(
          { divider: true },
          {
            label: 'View Values',
            icon: '⚙️',
            onClick: () => {
              openWithObject({
                kind: 'HelmRelease',
                name: resource.name,
                namespace: resource.namespace,
                viewMode: 'values',
              });
            },
          },
          {
            label: 'View Chart',
            icon: '📦',
            onClick: () => {
              openWithObject({
                kind: 'HelmRelease',
                name: resource.name,
                namespace: resource.namespace,
                viewMode: 'chart',
              });
            },
          },
          {
            label: 'View History',
            icon: '📚',
            onClick: () => {
              openWithObject({
                kind: 'HelmRelease',
                name: resource.name,
                namespace: resource.namespace,
                viewMode: 'history',
              });
            },
          }
        );

        // Add status-specific actions
        const status = resource.status || resource.info?.status;
        if (status === 'failed') {
          items.push(
            { divider: true },
            {
              label: 'View Failure Details',
              icon: '❌',
              onClick: () => {
                openWithObject({
                  kind: 'HelmRelease',
                  name: resource.name,
                  namespace: resource.namespace,
                  viewMode: 'failure',
                });
              },
            }
          );
        }

        return items;
      },
      [handleResourceClick, openWithObject]
    );

    const emptyMessage = useMemo(
      () => resolveEmptyStateMessage(undefined, 'No data available'),
      []
    );

    return (
      <ResourceLoadingBoundary
        loading={loading ?? false}
        dataLength={sortedData.length}
        hasLoaded={loaded}
        spinnerMessage="Loading Helm releases..."
      >
        <GridTable
          data={sortedData}
          columns={columns}
          loading={loading}
          keyExtractor={keyExtractor}
          onRowClick={handleResourceClick}
          onSort={handleSort}
          sortConfig={sortConfig}
          tableClassName="ns-helm-table"
          enableContextMenu={true}
          getCustomContextMenuItems={getContextMenuItems}
          useShortNames={useShortResourceNames}
          emptyMessage={emptyMessage}
          filters={{
            enabled: true,
            value: persistedFilters,
            onChange: setPersistedFilters,
            onReset: resetPersistedState,
            options: {
              showKindDropdown: true,
              showNamespaceDropdown: showNamespaceColumn,
              showClusterDropdown: true,
            },
          }}
          virtualization={GRIDTABLE_VIRTUALIZATION_DEFAULT}
          columnWidths={columnWidths}
          onColumnWidthsChange={setColumnWidths}
          columnVisibility={columnVisibility}
          onColumnVisibilityChange={setColumnVisibility}
          allowHorizontalOverflow={true}
        />
      </ResourceLoadingBoundary>
    );
  }
);

HelmViewGrid.displayName = 'NsViewHelm';

export default HelmViewGrid;
