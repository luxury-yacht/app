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
import {
  parseApiVersion,
  resolveBuiltinGroupVersion,
} from '@/shared/constants/builtinGroupVersions';
import { useGridTablePersistence } from '@shared/components/tables/persistence/useGridTablePersistence';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { useObjectLink } from '@shared/hooks/useObjectLink';
import { useShortNames } from '@/hooks/useShortNames';
import { useTableSort } from '@/hooks/useTableSort';
import * as cf from '@shared/components/tables/columnFactories';
import React, { useMemo, useCallback } from 'react';
import ResourceLoadingBoundary from '@shared/components/ResourceLoadingBoundary';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import { buildObjectActionItems } from '@shared/hooks/useObjectActions';
import GridTable, {
  type GridColumnDefinition,
  GRIDTABLE_VIRTUALIZATION_DEFAULT,
} from '@shared/components/tables/GridTable';
import { buildClusterScopedKey } from '@shared/components/tables/GridTable.utils';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import { useNamespaceFilterOptions } from '@modules/namespace/hooks/useNamespaceFilterOptions';
import { useFavToggle } from '@ui/favorites/FavToggle';
import { buildObjectReference } from '@shared/utils/objectIdentity';

interface EventData {
  kind: string;
  kindAlias?: string;
  name: string;
  namespace: string;
  clusterId?: string;
  clusterName?: string;
  objectNamespace?: string;
  objectApiVersion?: string;
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
    const objectLink = useObjectLink();
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

    // Include all visible columns in search: type, source, reason, object, message.
    const getSearchText = useCallback((event: EventData): string[] => {
      const values = [
        event.kind,
        event.name,
        event.namespace,
        event.type,
        event.source,
        event.reason,
        event.object,
        event.message,
      ];
      return values.filter(Boolean);
    }, []);

    // Build an object reference from an event's involved object for navigation.
    const getEventObjectRef = useCallback(
      (event: EventData) => {
        const parsed = splitEventObject(event.object);
        if (!parsed.isLinkable) {
          return undefined;
        }
        const namespace =
          event.objectNamespace && event.objectNamespace.length > 0
            ? event.objectNamespace
            : undefined;
        const objectVersionParts = event.objectApiVersion
          ? parseApiVersion(event.objectApiVersion)
          : resolveBuiltinGroupVersion(parsed.objectType);
        if (!objectVersionParts.version) {
          return undefined;
        }
        return buildObjectReference({
          kind: parsed.objectType,
          name: parsed.objectName,
          namespace,
          group: objectVersionParts.group,
          version: objectVersionParts.version,
          clusterId: event.clusterId ?? undefined,
          clusterName: event.clusterName ?? undefined,
        });
      },
      [splitEventObject]
    );

    const handleEventClick = useCallback(
      (event: EventData) => {
        const ref = getEventObjectRef(event);
        if (ref) openWithObject(ref);
      },
      [getEventObjectRef, openWithObject]
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
            ...objectLink(getEventObjectRef),
            getClassName: () => 'object-panel-link',
            isInteractive: (event) => Boolean(getEventObjectRef(event)),
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
        source: { width: 200 },
        objectType: { autoWidth: true },
        objectName: { width: 200 },
        reason: { width: 200 },
        message: { width: 250 },
        age: { autoWidth: true },
      };
      cf.applyColumnSizing(baseColumns, sizing);

      return baseColumns;
    }, [getEventObjectRef, objectLink, splitEventObject, useShortResourceNames]);

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
      hydrated,
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
      columns,
      controlledSort: persistedSort,
      onChange: setPersistedSort,
    });

    const fallbackNamespaces = useMemo(
      () => [...new Set(data.map((r) => r.namespace).filter(Boolean))].sort(),
      [data]
    );
    const availableFilterNamespaces = useNamespaceFilterOptions(
      ALL_NAMESPACES_SCOPE,
      fallbackNamespaces
    );

    const { item: favToggle, modal: favModal } = useFavToggle({
      filters: persistedFilters,
      sortColumn: sortConfig?.key ?? null,
      sortDirection: sortConfig?.direction ?? 'asc',
      columnVisibility: columnVisibility ?? {},
      setFilters: setPersistedFilters,
      setSortConfig: setPersistedSort,
      setColumnVisibility,
      hydrated,
      availableFilterNamespaces,
    });

    // Get context menu items
    const getContextMenuItems = useCallback(
      (event: EventData): ContextMenuItem[] => {
        const parsed = splitEventObject(event.object);
        if (!parsed.isLinkable) {
          return [];
        }

        return buildObjectActionItems({
          object: buildObjectReference(
            {
              kind: 'Event',
              name: event.name,
              namespace: event.namespace,
              clusterId: event.clusterId,
              clusterName: event.clusterName,
            },
            { involvedObject: event.object }
          ),
          context: 'gridtable',
          handlers: {
            onViewInvolvedObject: () => handleEventClick(event),
          },
          permissions: {},
        });
      },
      [handleEventClick, splitEventObject]
    );

    // Resolve empty state message
    const emptyMessage = useMemo(
      () => resolveEmptyStateMessage(error, 'No cluster-scoped events found'),
      [error]
    );

    return (
      <>
        <ResourceLoadingBoundary
          loading={loading ?? false}
          dataLength={sortedData.length}
          hasLoaded={loaded}
          spinnerMessage="Loading events..."
        >
          <GridTable
            data={sortedData}
            columns={columns}
            diagnosticsLabel="Cluster Events"
            diagnosticsMode="live"
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
              accessors: {
                getSearchText,
              },
              options: {
                searchPlaceholder: 'Search events',
                namespaces: availableFilterNamespaces,
                preActions: [favToggle],
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
        {favModal}
      </>
    );
  }
);

ClusterEventsView.displayName = 'ClusterEventsView';

export default ClusterEventsView;
