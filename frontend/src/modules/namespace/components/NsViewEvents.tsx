/**
 * frontend/src/modules/namespace/components/NsViewEvents.tsx
 *
 * UI component for NsViewEvents.
 * Handles rendering and interactions for the namespace feature.
 */


import './NsViewEvents.css';
import { formatAge } from '@/utils/ageFormatter';
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

export interface EventData {
  kind: string;
  kindAlias?: string;
  type: string; // Event severity (Normal, Warning)
  source: string;
  reason: string;
  object: string;
  message: string;
  objectNamespace?: string;
  namespace?: string;
  age?: string;
  ageTimestamp?: number;
}

interface EventViewProps {
  namespace: string;
  data: EventData[];
  loading?: boolean;
  loaded?: boolean;
  showNamespaceColumn?: boolean;
}

/**
 * GridTable component for namespace Events
 */
const NsEventsTable: React.FC<EventViewProps> = React.memo(
  ({ namespace, data, loading = false, loaded = false, showNamespaceColumn = false }) => {
    const { openWithObject } = useObjectPanel();
    const useShortResourceNames = useShortNames();

    const handleEventClick = useCallback(
      (event: EventData) => {
        // Events don't have a direct object panel view, but we could open the related object
        if (event.object && event.object.includes('/')) {
          const [kind, name] = event.object.split('/');
          const resolvedNamespace =
            event.objectNamespace && event.objectNamespace.length > 0
              ? event.objectNamespace
              : event.namespace && event.namespace.length > 0
                ? event.namespace
                : namespace;
          openWithObject({
            kind,
            name,
            namespace: resolvedNamespace,
          });
        }
      },
      [openWithObject, namespace]
    );

    const keyExtractor = useCallback(
      (event: EventData, index: number) => {
        const eventNamespace =
          event.objectNamespace && event.objectNamespace.length > 0
            ? event.objectNamespace
            : event.namespace && event.namespace.length > 0
              ? event.namespace
              : namespace;
        return `${eventNamespace}-${event.reason}-${event.source}-${event.object}-${event.ageTimestamp ?? event.age ?? '0'}-${index}`;
      },
      [namespace]
    );

    // Define columns for Events
    const columns: GridColumnDefinition<EventData>[] = useMemo(() => {
      const baseColumns: GridColumnDefinition<EventData>[] = [
        cf.createKindColumn<EventData>({
          getKind: () => 'Event',
          getDisplayText: () => getDisplayKind('Event', useShortResourceNames),
        }),
        cf.createTextColumn<EventData>('type', 'Type', (event) => event.type || 'Normal'),
      ];

      if (showNamespaceColumn) {
        baseColumns.push(
          cf.createTextColumn('namespace', 'Namespace', (event) =>
            event.objectNamespace && event.objectNamespace.length > 0
              ? event.objectNamespace
              : event.namespace || '-'
          )
        );
      }

      baseColumns.push(
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
        }
      );

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
    }, [handleEventClick, showNamespaceColumn, useShortResourceNames]);

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
    } = useNamespaceGridTablePersistence<EventData>({
      viewId: 'namespace-events',
      namespace,
      columns,
      data,
      keyExtractor,
      defaultSort: { key: 'ageTimestamp', direction: 'desc' },
      filterOptions: { isNamespaceScoped: namespace !== ALL_NAMESPACES_SCOPE },
    });

    const { sortedData, sortConfig, handleSort } = useTableSort(data, undefined, 'asc', {
      controlledSort: persistedSort,
      onChange: onSortChange,
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

    const emptyMessage = useMemo(
      () => resolveEmptyStateMessage(undefined, 'No data available'),
      []
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
          tableClassName="gridtable-ns-events"
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
    );
  }
);

NsEventsTable.displayName = 'NsViewEvents';

export default NsEventsTable;
