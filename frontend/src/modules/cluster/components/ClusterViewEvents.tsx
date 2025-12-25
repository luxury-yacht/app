/**
 * frontend/src/modules/cluster/components/ClusterViewEvents.tsx
 *
 * UI component for ClusterViewEvents.
 * Handles rendering and interactions for the cluster feature.
 */


import './ClusterViewEvents.css';
import { formatAge } from '@/utils/ageFormatter';
import { getDisplayKind } from '@/utils/kindAliasMap';
import { resolveEmptyStateMessage } from '@/utils/emptyState';
import { useGridTablePersistence } from '@shared/components/tables/persistence/useGridTablePersistence';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
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

interface EventData {
  kind: string;
  kindAlias?: string;
  name: string;
  namespace: string;
  objectNamespace?: string;
  type: string; // Event severity (Normal, Warning)
  source: string;
  reason: string;
  object: string;
  message: string;
  age?: string;
  ageTimestamp?: number;
}

interface EventViewProps {
  data: EventData[];
  loading?: boolean;
  loaded?: boolean;
  error?: string | null;
}

/**
 * GridTable component for cluster Events
 * Displays cluster-wide events
 */
const ClusterEventsView: React.FC<EventViewProps> = React.memo(
  ({ data, loading = false, loaded, error }) => {
    const { openWithObject } = useObjectPanel();
    const { selectedKubeconfig } = useKubeconfig();
    const useShortResourceNames = useShortNames();

    const handleEventClick = useCallback(
      (event: EventData) => {
        // Events don't have a direct object panel view, but we could open the related object
        if (event.object && event.object.includes('/')) {
          const [kind, name] = event.object.split('/');
          const namespace =
            event.objectNamespace && event.objectNamespace.length > 0
              ? event.objectNamespace
              : undefined;
          openWithObject({
            kind,
            name,
            namespace,
          });
        }
      },
      [openWithObject]
    );

    const keyExtractor = useCallback(
      (event: EventData, index: number) =>
        `${event.namespace}-${event.reason}-${event.source}-${event.object}-${event.ageTimestamp ?? event.age ?? '0'}-${index}`,
      []
    );

    // Define columns for Events
    const columns: GridColumnDefinition<EventData>[] = useMemo(() => {
      const baseColumns: GridColumnDefinition<EventData>[] = [
        cf.createKindColumn<EventData>({
          getKind: () => 'Event',
          getDisplayText: () => getDisplayKind('Event', useShortResourceNames),
        }),
        cf.createTextColumn<EventData>('type', 'Type', (event) => event.type || 'Normal'),
        cf.createTextColumn('namespace', 'Namespace', (event) => event.namespace || '-'),
        cf.createTextColumn('source', 'Source', (event) => event.source || '-'),
        cf.createTextColumn<EventData>('object', 'Object', (event) => event.object || '-', {
          onClick: handleEventClick,
          isInteractive: (event) => Boolean(event.object && event.object.includes('/')),
        }),
        cf.createTextColumn('reason', 'Reason', (event) => event.reason || '-'),
        cf.createTextColumn('message', 'Message', (event) => event.message || '-'),
        {
          ...cf.createAgeColumn<EventData>('age', 'Age', (event) =>
            formatAge(event.ageTimestamp ?? event.age ?? null)
          ),
          sortValue: (event) => event.ageTimestamp ?? 0,
        },
      ];

      const sizing: cf.ColumnSizingMap = {
        kind: { autoWidth: true },
        type: { autoWidth: true },
        namespace: { autoWidth: true },
        source: { autoWidth: true },
        object: { autoWidth: true },
        reason: { autoWidth: true },
        message: { autoWidth: true },
        age: { autoWidth: true },
      };
      cf.applyColumnSizing(baseColumns, sizing);

      return baseColumns;
    }, [handleEventClick, useShortResourceNames]);

    // Set up grid table persistence
    const {
      sortConfig: persistedSort,
      setSortConfig: setPersistedSort,
      columnWidths,
      setColumnWidths,
      columnVisibility,
      setColumnVisibility,
      filters: persistedFilters,
      setFilters: setPersistedFilters,
      resetState: resetPersistedState,
    } = useGridTablePersistence<EventData>({
      viewId: 'cluster-events',
      clusterIdentity: selectedKubeconfig,
      namespace: null,
      isNamespaceScoped: false,
      columns,
      data,
      keyExtractor,
      filterOptions: { isNamespaceScoped: false },
    });

    // Set up table sorting
    const { sortedData, sortConfig, handleSort } = useTableSort(data, 'ageTimestamp', 'desc', {
      controlledSort: persistedSort,
      onChange: setPersistedSort,
    });

    // Get context menu items
    const getContextMenuItems = useCallback(
      (event: EventData): ContextMenuItem[] => {
        const items: ContextMenuItem[] = [];

        // Add option to view related object if available
        if (event.object && event.object.includes('/')) {
          const [kind] = event.object.split('/');
          items.push({
            label: `View ${kind}`,
            icon: '→',
            onClick: () => handleEventClick(event),
          });
        }

        return items;
      },
      [handleEventClick]
    );

    // Resolve empty state message
    const emptyMessage = useMemo(
      () => resolveEmptyStateMessage(error, 'No data available'),
      [error]
    );

    return (
      <ResourceLoadingBoundary
        loading={loading ?? false}
        dataLength={sortedData.length}
        hasLoaded={loaded}
        spinnerMessage="Loading events..."
      >
        <GridTable
          data={sortedData}
          columns={columns}
          loading={loading}
          keyExtractor={keyExtractor}
          onRowClick={handleEventClick}
          onSort={handleSort}
          sortConfig={sortConfig}
          tableClassName="gridtable-cluster-events"
          enableContextMenu={true}
          getCustomContextMenuItems={getContextMenuItems}
          useShortNames={useShortResourceNames}
          emptyMessage={emptyMessage}
          filters={{
            enabled: true,
            value: persistedFilters,
            onChange: setPersistedFilters,
            onReset: resetPersistedState,
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

ClusterEventsView.displayName = 'ClusterEventsView';

export default ClusterEventsView;
