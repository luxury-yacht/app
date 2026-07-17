/**
 * frontend/src/modules/cluster/components/ClusterViewEvents.tsx
 *
 * Renders cluster-scoped Kubernetes Events. It displays event rows, links
 * Event details through the object panel, links involved objects through
 * ResourceLink-aware navigation, and wires both into shared object actions.
 */

import './ClusterViewEvents.css';
import type { ClusterEventsSnapshotPayload, ResourceLink } from '@core/refresh/types';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import ResourceInventoryTable from '@modules/resource-grid/ResourceInventoryTable';
import { selectPayloadRows } from '@modules/resource-grid/typedResourceQueryScope';
import { useQueryBackedClusterResourceGridTable } from '@modules/resource-grid/useQueryBackedResourceGridTable';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import * as cf from '@shared/components/tables/columnFactories';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable';
import { createEventTypeColumn } from '@shared/events/eventColumns';
import {
  clusterEventRowIdentity,
  eventGridActionReference,
  eventGridCanOpenRelatedObject,
  eventGridObjectReference,
  eventGridSearchText,
  eventGridStableKey,
  resolveEventGridRelatedObject,
} from '@shared/events/eventGridModel';
import { EVENT_LABELS } from '@shared/events/eventPresentation';
import { useNavigateToView } from '@shared/hooks/useNavigateToView';
import { useObjectActionController } from '@shared/hooks/useObjectActionController';
import { splitEventObjectTarget } from '@shared/utils/eventObjectIdentity';
import React, { useCallback, useMemo } from 'react';
import { useShortNames } from '@/hooks/useShortNames';
import { resolveEmptyStateMessage } from '@/utils/emptyState';
import { getDisplayKind } from '@/utils/kindAliasMap';

interface EventData {
  kind: string;
  kindAlias?: string;
  name: string;
  uid: string;
  resourceVersion: string;
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

  const canOpenInvolvedObject = useCallback(
    (event: EventData) => eventGridCanOpenRelatedObject(event, { selectedClusterId }),
    [selectedClusterId]
  );

  const openInvolvedObject = useCallback(
    async (event: EventData) => {
      const ref = await resolveEventGridRelatedObject(event, { selectedClusterId });
      if (ref) {
        openWithObject(ref);
      }
    },
    [openWithObject, selectedClusterId]
  );

  const navigateToInvolvedObject = useCallback(
    async (event: EventData) => {
      const ref = await resolveEventGridRelatedObject(event, { selectedClusterId });
      if (ref) {
        navigateToView(ref);
      }
    },
    [navigateToView, selectedClusterId]
  );

  const openEvent = useCallback(
    (event: EventData) => {
      openWithObject(eventGridObjectReference(event, selectedClusterId));
    },
    [openWithObject, selectedClusterId]
  );

  const navigateToEvent = useCallback(
    (event: EventData) => {
      navigateToView(eventGridObjectReference(event, selectedClusterId));
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
        onClick: openEvent,
        onAltClick: navigateToEvent,
        allowRowClick: false,
      }),
      createEventTypeColumn<EventData>(),
      cf.createTextColumn('source', EVENT_LABELS.source, (event) => event.source || '-'),
      cf.createTextColumn<EventData>('objectType', EVENT_LABELS.objectType, (event) => {
        const parsed = splitEventObjectTarget(event.object);
        return parsed.objectType;
      }),
      cf.createTextColumn<EventData>(
        'objectName',
        EVENT_LABELS.objectName,
        (event) => {
          const parsed = splitEventObjectTarget(event.object);
          return parsed.objectName;
        },
        {
          onClick: (event) => {
            void openInvolvedObject(event);
          },
          onAltClick: (event) => {
            void navigateToInvolvedObject(event);
          },
          getClassName: () => 'object-panel-link',
          isInteractive: canOpenInvolvedObject,
          allowRowClick: false,
        }
      ),
      cf.createTextColumn('reason', EVENT_LABELS.reason, (event) => event.reason || '-'),
      cf.createTextColumn('message', EVENT_LABELS.message, (event) => event.message || '-'),
      cf.createAgeColumn<EventData>('age', EVENT_LABELS.lastSeen, (event) => event.age),
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
  }, [
    canOpenInvolvedObject,
    navigateToEvent,
    navigateToInvolvedObject,
    openEvent,
    openInvolvedObject,
    useShortResourceNames,
  ]);

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
    onOpen: (object) => openWithObject(object),
    onViewInvolvedObject: (object) => {
      const event = source.rows.find(
        (candidate) =>
          candidate.clusterId === object.clusterId &&
          candidate.namespace === object.namespace &&
          candidate.name === object.name &&
          candidate.object === object.involvedObject
      );
      if (event) {
        void openInvolvedObject(event);
      }
    },
  });

  // Get context menu items
  const getContextMenuItems = useCallback(
    (event: EventData): ContextMenuItem[] => {
      const parsed = splitEventObjectTarget(event.object);
      const involvedObjectExtras =
        parsed.isLinkable && canOpenInvolvedObject(event)
          ? {
              involvedObject: event.object,
              involvedObjectRef: event.involvedObject,
            }
          : {};

      return objectActions.getMenuItems(
        eventGridActionReference(event, selectedClusterId, involvedObjectExtras)
      );
    },
    [canOpenInvolvedObject, objectActions, selectedClusterId]
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
        onRowClick={openEvent}
        onRowPointerClick={openEvent}
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
