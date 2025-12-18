/* NsViewAutoscaling.tsx
 *
 * GridTable view for namespace autoscaling resources.
 */

import './NsViewAutoscaling.css';
import { getDisplayKind } from '@/utils/kindAliasMap';
import { resolveEmptyStateMessage } from '@/utils/emptyState';
import { getPermissionKey, useUserPermissions } from '@/core/capabilities';
import { useNamespaceGridTablePersistence } from '@modules/namespace/hooks/useNamespaceGridTablePersistence';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { useShortNames } from '@/hooks/useShortNames';
import { useTableSort } from '@/hooks/useTableSort';
import * as cf from '@shared/components/tables/columnFactories';
import React, { useMemo, useState, useCallback } from 'react';
import ConfirmationModal from '@components/modals/ConfirmationModal';
import ResourceLoadingBoundary from '@shared/components/ResourceLoadingBoundary';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import GridTable, {
  type GridColumnDefinition,
  GRIDTABLE_VIRTUALIZATION_DEFAULT,
} from '@shared/components/tables/GridTable';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import { DeleteIcon } from '@shared/components/icons/MenuIcons';
import { DeleteResource } from '@wailsjs/go/backend/App';
import { errorHandler } from '@utils/errorHandler';

// Data interface for autoscaling resources
export interface AutoscalingData {
  kind: string;
  kindAlias?: string;
  name: string;
  namespace: string;
  // HorizontalPodAutoscaler-specific fields
  scaleTargetRef?: {
    kind: string;
    name: string;
  };
  target?: string;
  min?: number;
  max?: number;
  current?: number;
  targetCPUUtilizationPercentage?: number;
  metrics?: Array<{
    type: string;
    target: string;
  }>;
  minReplicas?: number;
  maxReplicas?: number;
  currentReplicas?: number;
  // VerticalPodAutoscaler-specific fields
  updatePolicy?: {
    updateMode?: string;
  };
  status?: string;
  age?: string;
  [key: string]: any; // Allow additional fields
}

interface AutoscalingViewProps {
  namespace: string;
  data: AutoscalingData[];
  loading?: boolean;
  loaded?: boolean;
  showNamespaceColumn?: boolean;
}

/**
 * GridTable component for namespace autoscaling resources
 * Aggregates HorizontalPodAutoscalers and VerticalPodAutoscalers
 */
const AutoscalingViewGrid: React.FC<AutoscalingViewProps> = React.memo(
  ({ namespace, data, loading = false, loaded = false, showNamespaceColumn = false }) => {
    const { openWithObject } = useObjectPanel();
    const useShortResourceNames = useShortNames();
    const permissionMap = useUserPermissions();

    const [deleteConfirm, setDeleteConfirm] = useState<{
      show: boolean;
      resource: AutoscalingData | null;
    }>({ show: false, resource: null });

    const handleResourceClick = useCallback(
      (resource: AutoscalingData) => {
        openWithObject({
          kind: resource.kind || resource.kindAlias,
          name: resource.name,
          namespace: resource.namespace,
        });
      },
      [openWithObject]
    );

    const keyExtractor = useCallback((resource: AutoscalingData) => {
      return [resource.namespace, resource.kind, resource.name].filter(Boolean).join('/');
    }, []);

    const columns: GridColumnDefinition<AutoscalingData>[] = useMemo(() => {
      const baseColumns: GridColumnDefinition<AutoscalingData>[] = [];

      baseColumns.push(
        cf.createKindColumn<AutoscalingData>({
          key: 'kind',
          getKind: (resource) => resource.kind,
          getAlias: (resource) => resource.kindAlias,
          getDisplayText: (resource) =>
            getDisplayKind(
              resource.kind || resource.kindAlias || 'Autoscaler',
              useShortResourceNames
            ),
          onClick: handleResourceClick,
        })
      );

      baseColumns.push(
        cf.createTextColumn<AutoscalingData>('name', 'Name', {
          onClick: handleResourceClick,
          getClassName: () => 'object-panel-link',
        })
      );

      baseColumns.push(
        cf.createTextColumn<AutoscalingData>(
          'scaleTarget',
          'Scale Target',
          (resource) => {
            if (resource.scaleTargetRef) {
              const ref = resource.scaleTargetRef;
              return `${ref.kind}/${ref.name}`;
            }
            if (resource.target) {
              return resource.target;
            }
            return '-';
          },
          {
            onClick: (resource) => {
              if (!resource.scaleTargetRef) {
                return;
              }
              openWithObject({
                kind: resource.scaleTargetRef.kind,
                name: resource.scaleTargetRef.name,
                namespace: resource.namespace,
              });
            },
            isInteractive: (resource) => Boolean(resource.scaleTargetRef),
            getClassName: (resource) =>
              ['scale-reference', resource.scaleTargetRef ? 'object-panel-link' : undefined]
                .filter(Boolean)
                .join(' '),
          }
        )
      );

      baseColumns.push(
        cf.createTextColumn<AutoscalingData>(
          'replicas',
          'Min/Max',
          (resource) => {
            if (resource.kind === 'HorizontalPodAutoscaler') {
              const minValue = resource.minReplicas ?? resource.min;
              const min = minValue !== undefined && minValue !== null ? minValue : 1;
              const maxValue = resource.maxReplicas ?? resource.max;
              return `${min}/${maxValue !== undefined && maxValue !== null ? maxValue : '-'}`;
            }
            return '-';
          },
          {
            getClassName: (resource) =>
              resource.kind === 'HorizontalPodAutoscaler' ? 'replica-range' : undefined,
          }
        )
      );

      baseColumns.push(
        cf.createTextColumn<AutoscalingData>(
          'current',
          'Current',
          (resource) => {
            if (resource.kind === 'HorizontalPodAutoscaler') {
              const current = resource.currentReplicas ?? resource.current;
              return `${current !== undefined && current !== null ? current : 0}`;
            }
            if (resource.kind === 'VerticalPodAutoscaler') {
              return resource.status || 'Unknown';
            }
            return '-';
          },
          {
            getClassName: (resource) => {
              if (resource.kind === 'HorizontalPodAutoscaler') {
                return 'current-replicas';
              }
              if (resource.kind === 'VerticalPodAutoscaler') {
                const status = resource.status || 'Unknown';
                return `vpa-status ${status.toLowerCase()}`;
              }
              return undefined;
            },
          }
        )
      );

      baseColumns.push(cf.createAgeColumn());

      const sizing: cf.ColumnSizingMap = {
        kind: { autoWidth: true },
        name: { autoWidth: true },
        namespace: { autoWidth: true },
        scaleTarget: { autoWidth: true },
        replicas: { autoWidth: true },
        current: { autoWidth: true },
        age: { autoWidth: true },
      };
      cf.applyColumnSizing(baseColumns, sizing);

      if (showNamespaceColumn) {
        cf.upsertNamespaceColumn(baseColumns, {
          accessor: (resource) => resource.namespace,
          sortValue: (resource) => (resource.namespace || '').toLowerCase(),
        });
      }

      return baseColumns;
    }, [handleResourceClick, openWithObject, showNamespaceColumn, useShortResourceNames]);

    const showNamespaceFilter = namespace === ALL_NAMESPACES_SCOPE;

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
    } = useNamespaceGridTablePersistence<AutoscalingData>({
      viewId: 'namespace-autoscaling',
      namespace,
      columns,
      data,
      keyExtractor,
      defaultSort: { key: 'name', direction: 'asc' },
      filterOptions: { isNamespaceScoped: namespace !== ALL_NAMESPACES_SCOPE },
    });

    const { sortedData, sortConfig, handleSort } = useTableSort(data, undefined, 'asc', {
      controlledSort: persistedSort,
      onChange: onSortChange,
    });

    const handleDeleteConfirm = useCallback(async () => {
      if (!deleteConfirm.resource) return;

      try {
        await DeleteResource(
          deleteConfirm.resource.kind,
          deleteConfirm.resource.namespace,
          deleteConfirm.resource.name
        );
        setDeleteConfirm({ show: false, resource: null });
      } catch (error) {
        errorHandler.handle(error, {
          action: 'delete',
          kind: deleteConfirm.resource.kind,
          name: deleteConfirm.resource.name,
        });
        setDeleteConfirm({ show: false, resource: null });
      }
    }, [deleteConfirm.resource]);

    const getContextMenuItems = useCallback(
      (resource: AutoscalingData): ContextMenuItem[] => {
        const items: ContextMenuItem[] = [];

        // Always add Open in Object Panel
        items.push({
          label: 'Open',
          icon: '→',
          onClick: () => handleResourceClick(resource),
        });

        // Add type-specific actions
        if (resource.kind === 'HorizontalPodAutoscaler') {
          items.push(
            { divider: true },
            {
              label: 'View Scaling Events',
              icon: '📊',
              onClick: () => {
                // This would show scaling history/events
                openWithObject({
                  kind: resource.kind,
                  name: resource.name,
                  namespace: resource.namespace,
                  viewMode: 'events',
                });
              },
            }
          );
        }

        const deleteStatus =
          permissionMap.get(getPermissionKey(resource.kind, 'delete', resource.namespace)) ?? null;

        if (deleteStatus?.allowed && !deleteStatus.pending) {
          if (items.length > 0 && !items[items.length - 1].divider) {
            items.push({ divider: true });
          }
          items.push({
            label: 'Delete',
            icon: <DeleteIcon />,
            onClick: () => setDeleteConfirm({ show: true, resource }),
          });
        }

        return items;
      },
      [handleResourceClick, openWithObject, permissionMap]
    );

    const emptyMessage = useMemo(
      () => resolveEmptyStateMessage(undefined, 'No data available'),
      []
    );

    return (
      <>
        <ResourceLoadingBoundary
          loading={loading}
          dataLength={sortedData.length}
          hasLoaded={loaded}
          spinnerMessage="Loading autoscaling resources..."
        >
          <GridTable
            data={sortedData}
            columns={columns}
            loading={loading}
            keyExtractor={keyExtractor}
            onRowClick={handleResourceClick}
            onSort={handleSort}
            sortConfig={sortConfig}
            tableClassName="ns-autoscaling-table"
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
                showNamespaceDropdown: showNamespaceFilter,
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

        <ConfirmationModal
          isOpen={deleteConfirm.show}
          title={`Delete ${deleteConfirm.resource?.kind || 'Resource'}`}
          message={`Are you sure you want to delete ${deleteConfirm.resource?.kind.toLowerCase()} "${deleteConfirm.resource?.name}"?\n\nThis action cannot be undone.`}
          confirmText="Delete"
          cancelText="Cancel"
          confirmButtonClass="danger"
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteConfirm({ show: false, resource: null })}
        />
      </>
    );
  }
);

AutoscalingViewGrid.displayName = 'NsViewAutoscaling';

export default AutoscalingViewGrid;
