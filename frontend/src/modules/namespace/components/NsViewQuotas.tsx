/* NsViewQuotas.tsx
 *
 * GridTable view for namespace quota resources.
 */

import './NsViewQuotas.css';
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

// Data interface for quota resources (ResourceQuotas, LimitRanges, PodDisruptionBudgets)
export interface QuotaData {
  kind: string;
  kindAlias?: string;
  name: string;
  namespace: string;
  details?: string;
  hard?: Record<string, string | number>;
  used?: Record<string, string | number>;
  limits?: any;
  minAvailable?: number;
  maxUnavailable?: number;
  currentHealthy?: number;
  desiredHealthy?: number;
  scopes?: string[];
  status?: any;
  age?: string;
  [key: string]: any; // Allow additional fields for flexibility
}

interface QuotasViewProps {
  namespace: string;
  data: QuotaData[];
  loading?: boolean;
  loaded?: boolean;
  showNamespaceColumn?: boolean;
}

/**
 * GridTable component for namespace quota resources
 * Aggregates ResourceQuotas, LimitRanges, and PodDisruptionBudgets
 */
const QuotasViewGrid: React.FC<QuotasViewProps> = React.memo(
  ({ namespace, data, loading = false, loaded = false, showNamespaceColumn = false }) => {
    const { openWithObject } = useObjectPanel();
    const useShortResourceNames = useShortNames();
    const permissionMap = useUserPermissions();

    const [deleteConfirm, setDeleteConfirm] = useState<{
      show: boolean;
      resource: QuotaData | null;
    }>({ show: false, resource: null });

    const handleResourceClick = useCallback(
      (resource: QuotaData) => {
        openWithObject({
          kind: resource.kind || resource.kindAlias,
          name: resource.name,
          namespace: resource.namespace,
        });
      },
      [openWithObject]
    );

    const keyExtractor = useCallback((resource: QuotaData) => {
      return [resource.namespace, resource.kind, resource.name].filter(Boolean).join('/');
    }, []);

    const formatResourceValue = (value: string | number) => {
      if (!value) return '-';

      // Handle memory values (convert from bytes if needed)
      if (typeof value === 'string' && value.match(/^\d+$/)) {
        const bytes = parseInt(value);
        if (bytes >= 1024 * 1024 * 1024) {
          return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}Gi`;
        } else if (bytes >= 1024 * 1024) {
          return `${(bytes / (1024 * 1024)).toFixed(1)}Mi`;
        } else if (bytes >= 1024) {
          return `${(bytes / 1024).toFixed(1)}Ki`;
        }
      }

      return value.toString();
    };

    const columns: GridColumnDefinition<QuotaData>[] = useMemo(() => {
      const baseColumns: GridColumnDefinition<QuotaData>[] = [
        cf.createKindColumn<QuotaData>({
          key: 'kind',
          getKind: (resource) => resource.kind,
          getAlias: (resource) => resource.kindAlias,
          getDisplayText: (resource) => getDisplayKind(resource.kind, useShortResourceNames),
          onClick: handleResourceClick,
        }),
        cf.createTextColumn<QuotaData>('name', 'Name', {
          onClick: handleResourceClick,
          getClassName: () => 'object-panel-link',
        }),
        cf.createTextColumn<QuotaData>(
          'resources',
          'Resources',
          (resource) => {
            if (resource.kind === 'ResourceQuota' && resource.hard) {
              const quotas: string[] = [];
              if (resource.hard['requests.cpu']) {
                quotas.push(`CPU: ${resource.hard['requests.cpu']}`);
              }
              if (resource.hard['requests.memory']) {
                quotas.push(`Memory: ${formatResourceValue(resource.hard['requests.memory'])}`);
              }
              if (resource.hard['pods']) {
                quotas.push(`Pods: ${resource.hard['pods']}`);
              }
              if (quotas.length > 0) {
                return quotas.join(' • ');
              }
            }
            if (resource.kind === 'LimitRange' && resource.limits && resource.limits.length > 0) {
              const limit = resource.limits[0];
              return limit.type || 'Container';
            }
            if (resource.kind === 'PodDisruptionBudget') {
              if (resource.minAvailable !== undefined && resource.minAvailable !== null) {
                return `Min Available: ${resource.minAvailable}`;
              }
              if (resource.maxUnavailable !== undefined && resource.maxUnavailable !== null) {
                return `Max Unavailable: ${resource.maxUnavailable}`;
              }
            }
            if (resource.details) {
              return resource.details;
            }
            return '-';
          },
          {
            getClassName: (resource) => {
              if (resource.kind === 'ResourceQuota' && resource.hard) {
                return 'quota-resources-inline';
              }
              if (resource.kind === 'LimitRange') {
                return 'limit-type';
              }
              if (resource.kind === 'PodDisruptionBudget') {
                return 'pdb-policy';
              }
              return undefined;
            },
            sortable: false,
          }
        ),
        cf.createTextColumn<QuotaData>(
          'status',
          'Status',
          (resource) => {
            if (resource.kind === 'ResourceQuota' && resource.used && resource.hard) {
              const items: string[] = [];
              if (resource.used['requests.cpu'] && resource.hard['requests.cpu']) {
                const used = resource.used['requests.cpu'];
                const hard = resource.hard['requests.cpu'];
                items.push(`CPU: ${used}/${hard}`);
              }
              if (resource.used['requests.memory'] && resource.hard['requests.memory']) {
                const used = formatResourceValue(resource.used['requests.memory']);
                const hard = formatResourceValue(resource.hard['requests.memory']);
                items.push(`Mem: ${used}/${hard}`);
              }
              if (items.length > 0) {
                return items.join(' • ');
              }
            }
            if (resource.kind === 'PodDisruptionBudget' && resource.status) {
              return `${resource.status.disruptionsAllowed || 0} disruptions allowed`;
            }
            if (resource.details) {
              return resource.details;
            }
            return '-';
          },
          {
            getClassName: (resource) => {
              if (resource.kind === 'ResourceQuota' && resource.used && resource.hard) {
                return 'quota-usage-inline';
              }
              if (resource.kind === 'PodDisruptionBudget' && resource.status) {
                return 'pdb-status';
              }
              return undefined;
            },
            sortable: false,
          }
        ),
        cf.createTextColumn<QuotaData>(
          'scope',
          'Scope',
          (resource) => {
            if (resource.kind === 'ResourceQuota' && resource.scopes) {
              return resource.scopes.join(', ');
            }
            return '-';
          },
          {
            getClassName: (resource) =>
              resource.kind === 'ResourceQuota' && resource.scopes
                ? 'quota-scopes-inline'
                : undefined,
          }
        ),
        cf.createAgeColumn(),
      ];

      const sizing: cf.ColumnSizingMap = {
        kind: { autoWidth: true },
        name: { autoWidth: true },
        namespace: { autoWidth: true },
        resources: { autoWidth: true },
        status: { autoWidth: true },
        scope: { autoWidth: true },
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
    }, [handleResourceClick, showNamespaceColumn, useShortResourceNames]);

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
    } = useNamespaceGridTablePersistence<QuotaData>({
      viewId: 'namespace-quotas',
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
      (resource: QuotaData): ContextMenuItem[] => {
        const items: ContextMenuItem[] = [];

        // Always add Open in Object Panel
        items.push({
          label: 'Open',
          icon: '→',
          onClick: () => handleResourceClick(resource),
        });

        const deleteStatus =
          permissionMap.get(getPermissionKey(resource.kind, 'delete', resource.namespace)) ?? null;

        if (deleteStatus?.allowed && !deleteStatus.pending) {
          items.push(
            { divider: true },
            {
              label: 'Delete',
              icon: <DeleteIcon />,
              onClick: () => setDeleteConfirm({ show: true, resource }),
            }
          );
        }

        return items;
      },
      [handleResourceClick, permissionMap]
    );

    const emptyMessage = useMemo(
      () => resolveEmptyStateMessage(undefined, 'No data available'),
      []
    );

    return (
      <>
        <ResourceLoadingBoundary
          loading={loading ?? false}
          dataLength={sortedData.length}
          hasLoaded={loaded}
          spinnerMessage="Loading quotas..."
        >
          <GridTable
            data={sortedData}
            columns={columns}
            loading={loading}
            keyExtractor={keyExtractor}
            onRowClick={handleResourceClick}
            onSort={handleSort}
            sortConfig={sortConfig}
            tableClassName="ns-quotas-table"
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

QuotasViewGrid.displayName = 'NsViewQuotas';

export default QuotasViewGrid;
