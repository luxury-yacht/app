/**
 * frontend/src/modules/cluster/components/ClusterViewEvents.tsx
 *
 * Renders cluster-scoped Kubernetes Events. It displays event rows, links
 * involved objects through ResourceLink-aware navigation, and wires event
 * context menu actions into the shared object action controller.
 */

import './ClusterViewEvents.css';
import { getDisplayKind } from '@/utils/kindAliasMap';
import { resolveEmptyStateMessage } from '@/utils/emptyState';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { useNavigateToView } from '@shared/hooks/useNavigateToView';
import { useShortNames } from '@/hooks/useShortNames';
import * as cf from '@shared/components/tables/columnFactories';
import React, { useMemo, useCallback } from 'react';
import ResourceInventoryTable from '@modules/resource-grid/ResourceInventoryTable';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import { useObjectActionController } from '@shared/hooks/useObjectActionController';
import { type GridColumnDefinition } from '@shared/components/tables/GridTable';
import { useQueryBackedClusterResourceGridTable } from '@modules/resource-grid/useQueryBackedResourceGridTable';
import { selectPayloadRows } from '@modules/resource-grid/typedResourceQueryScope';
import { splitEventObjectTarget } from '@shared/utils/eventObjectIdentity';
import {
  clusterEventRowIdentity,
  eventGridActionReference,
  eventGridCanOpenRelatedObject,
  eventGridSearchText,
  eventGridStableKey,
  resolveEventGridRelatedObject,
} from '@shared/events/eventGridModel';
import type { ClusterEventsSnapshotPayload, ResourceLink } from '@core/refresh/types';

interface EventData {
  kind: string;
  kindAlias?: string;
  name: string;
  namespace: string;
  clusterId: string;
  clusterName?: string;
  objectNamespace?: string;
  objectUid?: string;
  objectApiVersion?: string;
  involvedObject?: ResourceLink;
  type: string; // Event severity (Normal, Warning)
  source: string;
  reason: string;
  object: string;
  message: string;
  age?: string;
  ageTimestamp?: number;
}

interface EventViewProps {
  error?: string | null;
}

/**
 * GridTable component for cluster Events
 * Displays cluster-wide events
 */
const ClusterEventsView: React.FC<EventViewProps> = React.memo(({ error }) => {
  const { openWithObject } = useObjectPanel();
  const { navigateToView } = useNavigateToView();
  const { selectedClusterId } = useKubeconfig();
  const useShortResourceNames = useShortNames();
  const getSearchText = useCallback((event: EventData): string[] => eventGridSearchText(event), []);

  const canOpenEventObject = useCallback(
    (event: EventData) => eventGridCanOpenRelatedObject(event, { selectedClusterId }),
    [selectedClusterId]
  );

  const handleEventClick = useCallback(
    async (event: EventData) => {
      const ref = await resolveEventGridRelatedObject(event, { selectedClusterId });
      if (ref) {
        openWithObject(ref);
      }
    },
    [openWithObject, selectedClusterId]
  );

  const handleEventAltClick = useCallback(
    async (event: EventData) => {
      const ref = await resolveEventGridRelatedObject(event, { selectedClusterId });
      if (ref) {
        navigateToView(ref);
      }
    },
    [navigateToView, selectedClusterId]
  );

  const keyExtractor = useCallback(
    (event: EventData, index: number) => eventGridStableKey(event, index),
    []
  );

  const sortRowIdentity = useCallback(
    (event: EventData) => clusterEventRowIdentity(event, selectedClusterId),
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
      cf.createAgeColumn<EventData>('age', 'Age', (event) => event.age),
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

  const { gridTableProps, favModal, source } = useQueryBackedClusterResourceGridTable<
    ClusterEventsSnapshotPayload,
    EventData
  >({
    queryTableMode: 'Query Backed Static',
    clusterId: selectedClusterId,
    domain: 'cluster-events',
    label: 'Cluster Events',
    baseScope: 'cluster',
    selectRows: selectPayloadRows,
    viewId: 'cluster-events',
    columns,
    keyExtractor,
    defaultSortKey: 'age',
    defaultSortDirection: 'asc',
    rowIdentity: sortRowIdentity,
    filterAccessors: { getSearchText },
    showKindDropdown: false,
    filterOptions: { isNamespaceScoped: false },
  });

  const objectActions = useObjectActionController({
    context: 'gridtable',
    useDefaultHandlers: false,
    onViewInvolvedObject: (object) => {
      const event = source.rows.find(
        (candidate) =>
          candidate.clusterId === object.clusterId &&
          candidate.namespace === object.namespace &&
          candidate.name === object.name &&
          candidate.object === object.involvedObject
      );
      if (event) {
        void handleEventClick(event);
      }
    },
  });

  // Get context menu items
  const getContextMenuItems = useCallback(
    (event: EventData): ContextMenuItem[] => {
      const parsed = splitEventObjectTarget(event.object);
      if (!parsed.isLinkable || !canOpenEventObject(event)) {
        return [];
      }

      return objectActions.getMenuItems(
        eventGridActionReference(event, event.name, selectedClusterId, {
          involvedObject: event.object,
          involvedObjectRef: event.involvedObject,
        })
      );
    },
    [canOpenEventObject, objectActions, selectedClusterId]
  );

  // Resolve empty state message
  const emptyMessage = useMemo(
    () => resolveEmptyStateMessage(error, 'No cluster-scoped events found'),
    [error]
  );

  return (
    <>
      <ResourceInventoryTable
        source={source}
        gridTableProps={gridTableProps}
        spinnerMessage="Loading events..."
        favModal={favModal}
        columns={columns}
        diagnosticsLabel="Cluster Events"
        diagnosticsMode="live"
        onRowClick={handleEventClick}
        tableClassName="gridtable-cluster-events"
        enableContextMenu={true}
        getCustomContextMenuItems={getContextMenuItems}
        useShortNames={useShortResourceNames}
        emptyMessage={emptyMessage}
      />
      {objectActions.modals}
    </>
  );
});

ClusterEventsView.displayName = 'ClusterEventsView';

export default ClusterEventsView;
