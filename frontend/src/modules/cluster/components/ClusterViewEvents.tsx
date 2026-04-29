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
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { useNavigateToView } from '@shared/hooks/useNavigateToView';
import { useShortNames } from '@/hooks/useShortNames';
import * as cf from '@shared/components/tables/columnFactories';
import React, { useMemo, useCallback } from 'react';
import ResourceGridTableView from '@shared/components/tables/ResourceGridTableView';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import { buildObjectActionItems } from '@shared/hooks/useObjectActions';
import { type GridColumnDefinition } from '@shared/components/tables/GridTable';
import { buildClusterScopedKey } from '@shared/components/tables/GridTable.utils';
import { useClusterResourceGridTable } from '@shared/hooks/useResourceGridTable';
import {
  canResolveEventObjectReference,
  resolveEventObjectReference,
  splitEventObjectTarget,
} from '@shared/utils/eventObjectIdentity';
import {
  buildRequiredCanonicalObjectRowKey,
  buildRequiredObjectReference,
} from '@shared/utils/objectIdentity';

interface EventData {
  kind: string;
  kindAlias?: string;
  name: string;
  namespace: string;
  clusterId?: string;
  clusterName?: string;
  objectNamespace?: string;
  objectUid?: string;
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
    const { navigateToView } = useNavigateToView();
    const { selectedClusterId } = useKubeconfig();
    const useShortResourceNames = useShortNames();
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
    const getEventObjectRefInput = useCallback(
      (event: EventData) => {
        return {
          object: event.object,
          objectUid: event.objectUid,
          objectApiVersion: event.objectApiVersion,
          objectNamespace: event.objectNamespace,
          clusterId: event.clusterId ?? selectedClusterId ?? undefined,
          clusterName: event.clusterName ?? undefined,
        };
      },
      [selectedClusterId]
    );

    const canOpenEventObject = useCallback(
      (event: EventData) => canResolveEventObjectReference(getEventObjectRefInput(event)),
      [getEventObjectRefInput]
    );

    const handleEventClick = useCallback(
      async (event: EventData) => {
        const ref = await resolveEventObjectReference(getEventObjectRefInput(event));
        if (ref) {
          openWithObject(ref);
        }
      },
      [getEventObjectRefInput, openWithObject]
    );

    const handleEventAltClick = useCallback(
      async (event: EventData) => {
        const ref = await resolveEventObjectReference(getEventObjectRefInput(event));
        if (ref) {
          navigateToView(ref);
        }
      },
      [getEventObjectRefInput, navigateToView]
    );

    const keyExtractor = useCallback(
      (event: EventData, index: number) =>
        buildClusterScopedKey(
          event,
          `${event.namespace}-${event.reason}-${event.source}-${event.object}-${event.ageTimestamp ?? event.age ?? '0'}-${index}`
        ),
      []
    );

    const sortRowIdentity = useCallback(
      (event: EventData) =>
        buildRequiredCanonicalObjectRowKey(
          {
            kind: 'Event',
            name: event.name,
            namespace: event.namespace,
            clusterId: event.clusterId,
          },
          { fallbackClusterId: selectedClusterId }
        ),
      [selectedClusterId]
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
          const parsed = splitEventObjectTarget(event.object);
          return parsed.objectType;
        }),
        cf.createTextColumn<EventData>(
          'objectName',
          'Object Name',
          (event) => {
            const parsed = splitEventObjectTarget(event.object);
            return parsed.objectName;
          },
          {
            onClick: (event) => {
              void handleEventClick(event);
            },
            onAltClick: (event) => {
              void handleEventAltClick(event);
            },
            getClassName: () => 'object-panel-link',
            isInteractive: canOpenEventObject,
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
    }, [canOpenEventObject, handleEventAltClick, handleEventClick, useShortResourceNames]);

    const { gridTableProps, favModal } = useClusterResourceGridTable<EventData>({
      viewId: 'cluster-events',
      data,
      columns,
      keyExtractor,
      defaultSortKey: 'ageTimestamp',
      defaultSortDirection: 'desc',
      rowIdentity: sortRowIdentity,
      filterAccessors: { getSearchText },
      showKindDropdown: false,
      filterOptions: { isNamespaceScoped: false },
    });

    // Get context menu items
    const getContextMenuItems = useCallback(
      (event: EventData): ContextMenuItem[] => {
        const parsed = splitEventObjectTarget(event.object);
        if (!parsed.isLinkable || !canOpenEventObject(event)) {
          return [];
        }

        return buildObjectActionItems({
          object: buildRequiredObjectReference(
            {
              kind: 'Event',
              name: event.name,
              namespace: event.namespace,
              clusterId: event.clusterId,
              clusterName: event.clusterName,
            },
            { fallbackClusterId: selectedClusterId },
            { involvedObject: event.object }
          ),
          context: 'gridtable',
          handlers: {
            onViewInvolvedObject: () => {
              void handleEventClick(event);
            },
          },
          permissions: {},
        });
      },
      [canOpenEventObject, handleEventClick, selectedClusterId]
    );

    // Resolve empty state message
    const emptyMessage = useMemo(
      () => resolveEmptyStateMessage(error, 'No cluster-scoped events found'),
      [error]
    );

    return (
      <>
        <ResourceGridTableView
          gridTableProps={gridTableProps}
          boundaryLoading={loading ?? false}
          loaded={loaded}
          spinnerMessage="Loading events..."
          favModal={favModal}
          columns={columns}
          diagnosticsLabel="Cluster Events"
          diagnosticsMode="live"
          loading={loading}
          keyExtractor={keyExtractor}
          onRowClick={handleEventClick}
          tableClassName="gridtable-cluster-events"
          enableContextMenu={true}
          getCustomContextMenuItems={getContextMenuItems}
          useShortNames={useShortResourceNames}
          emptyMessage={emptyMessage}
        />
      </>
    );
  }
);

ClusterEventsView.displayName = 'ClusterEventsView';

export default ClusterEventsView;
