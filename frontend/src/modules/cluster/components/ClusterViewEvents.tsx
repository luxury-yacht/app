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
import { OpenIcon } from '@shared/components/icons/MenuIcons';
import GridTable, {
  type GridColumnDefinition,
  GRIDTABLE_VIRTUALIZATION_DEFAULT,
} from '@shared/components/tables/GridTable';
import { buildClusterScopedKey } from '@shared/components/tables/GridTable.utils';

interface EventData {
  kind: string;
  kindAlias?: string;
  name: string;
  namespace: string;
  clusterId?: string;
  clusterName?: string;
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
    const { selectedClusterId } = useKubeconfig();
    const useShortResourceNames = useShortNames();

    // Parse the involved object reference into its type and name for display/navigation.
    const splitEventObject = useCallback((value?: string | null) => {
      const raw = (value ?? '').trim();
      if (!raw || raw === '-') {
        return { objectType: '-', objectName: '-', isLinkable: false };
      }
      const [objectType, objectName] = raw.split('/', 2);
      if (!objectName) {
        return { objectType: raw, objectName: '-', isLinkable: false };
      }
      return {
        objectType: objectType || '-',
        objectName: objectName || '-',
        isLinkable: Boolean(objectType && objectName),
      };
    }, []);

    const handleEventClick = useCallback(
      (event: EventData) => {
        // Events don't have a direct object panel view, but we could open the related object.
        const parsed = splitEventObject(event.object);
        if (!parsed.isLinkable) {
          return;
        }
        const namespace =
          event.objectNamespace && event.objectNamespace.length > 0
            ? event.objectNamespace
            : undefined;
        openWithObject({
          kind: parsed.objectType,
          name: parsed.objectName,
          namespace,
          clusterId: event.clusterId ?? undefined,
          clusterName: event.clusterName ?? undefined,
        });
      },
      [openWithObject, splitEventObject]
    );

    const keyExtractor = useCallback(
      (event: EventData, index: number) =>
        buildClusterScopedKey(
          event,
          `${event.namespace}-${event.reason}-${event.source}-${event.object}-${event.ageTimestamp ?? event.age ?? '0'}-${index}`
        ),
      []
    );

    // Define columns for Events
    const columns: GridColumnDefinition<EventData>[] = useMemo(() => {
      const baseColumns: GridColumnDefinition<EventData>[] = [
        cf.createKindColumn<EventData>({
          getKind: () => 'Event',
          getDisplayText: () => getDisplayKind('Event', useShortResourceNames),
        }),
        cf.createTextColumn<EventData>('type', 'Type', (event) => event.type || 'Normal', {
          getClassName: (event) => `event-badge ${(event.type || 'normal').toLowerCase()}`,
        }),
        cf.createTextColumn('namespace', 'Namespace', (event) => event.namespace || '-'),
        cf.createTextColumn('source', 'Source', (event) => event.source || '-'),
        cf.createTextColumn<EventData>('objectType', 'Object Type', (event) => {
          const parsed = splitEventObject(event.object);
          return parsed.objectType;
        }),
        cf.createTextColumn<EventData>(
          'objectName',
          'Object Name',
          (event) => {
            const parsed = splitEventObject(event.object);
            return parsed.objectName;
          },
          {
            onClick: handleEventClick,
            isInteractive: (event) => splitEventObject(event.object).isLinkable,
          }
        ),
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
        source: { autoWidth: true, maxWidth: 250 },
        objectType: { autoWidth: true },
        objectName: { autoWidth: true },
        reason: { autoWidth: true },
        message: { autoWidth: true },
        age: { autoWidth: true },
      };
      cf.applyColumnSizing(baseColumns, sizing);

      return baseColumns;
    }, [handleEventClick, splitEventObject, useShortResourceNames]);

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
      clusterIdentity: selectedClusterId,
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
        const parsed = splitEventObject(event.object);
        if (parsed.isLinkable) {
          const kind = parsed.objectType;
          items.push({
            label: `View ${kind}`,
            icon: <OpenIcon />,
            onClick: () => handleEventClick(event),
          });
        }

        return items;
      },
      [handleEventClick, splitEventObject]
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
