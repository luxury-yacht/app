/**
 * frontend/src/modules/namespace/components/NsViewEvents.tsx
 *
 * Renders namespace-scoped Kubernetes Events. It displays event rows, links
 * Event details through the object panel, links involved objects through
 * ResourceLink-aware navigation, and wires both into shared object actions.
 */

import './NsViewEvents.css';
import type { NamespaceEventsSnapshotPayload, ResourceLink } from '@core/refresh/types';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useNamespaceColumnLink } from '@modules/namespace/components/useNamespaceColumnLink';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import ResourceInventoryTable from '@modules/resource-grid/ResourceInventoryTable';
import { selectPayloadRows } from '@modules/resource-grid/typedResourceQueryScope';
import { useQueryBackedNamespaceResourceGridTable } from '@modules/resource-grid/useQueryBackedResourceGridTable';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import * as cf from '@shared/components/tables/columnFactories';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable';
import { createEventTypeColumn } from '@shared/events/eventColumns';
import {
  eventGridActionReference,
  eventGridCanOpenRelatedObject,
  eventGridObjectNamespace,
  eventGridObjectReference,
  eventGridSearchText,
  eventGridStableKey,
  namespaceEventRowIdentity,
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

export interface EventData {
  kind: string;
  kindAlias?: string;
  name: string;
  uid: string;
  resourceVersion: string;
  type: string; // Event severity (Normal, Warning)
  source: string;
  reason: string;
  object: string;
  message: string;
  clusterId: string;
  clusterName?: string;
  objectNamespace?: string;
  objectUid?: string;
  objectApiVersion?: string;
  involvedObject?: ResourceLink;
  namespace: string;
  age?: string;
  ageTimestamp?: number;
}

interface EventViewProps {
  namespace: string;
  showNamespaceColumn?: boolean;
}

/**
 * GridTable component for namespace Events
 */
const NsEventsTable: React.FC<EventViewProps> = React.memo(
  ({ namespace, showNamespaceColumn = false }) => {
    const { openWithObject } = useObjectPanel();
    const { navigateToView } = useNavigateToView();
    const { selectedClusterId } = useKubeconfig();
    const queryClusterId = selectedClusterId;
    const useShortResourceNames = useShortNames();
    const namespaceColumnLink = useNamespaceColumnLink<EventData>('events', (event) =>
      event.objectNamespace && event.objectNamespace.length > 0
        ? event.objectNamespace
        : event.namespace
    );
    const getSearchText = useCallback(
      (event: EventData): string[] => eventGridSearchText(event),
      []
    );

    const canOpenInvolvedObject = useCallback(
      (event: EventData) =>
        eventGridCanOpenRelatedObject(event, {
          defaultNamespace: namespace,
          selectedClusterId,
        }),
      [namespace, selectedClusterId]
    );

    const openInvolvedObject = useCallback(
      async (event: EventData) => {
        const ref = await resolveEventGridRelatedObject(event, {
          defaultNamespace: namespace,
          selectedClusterId,
        });
        if (ref) {
          openWithObject(ref);
        }
      },
      [namespace, openWithObject, selectedClusterId]
    );

    const navigateToInvolvedObject = useCallback(
      async (event: EventData) => {
        const ref = await resolveEventGridRelatedObject(event, {
          defaultNamespace: namespace,
          selectedClusterId,
        });
        if (ref) {
          navigateToView(ref);
        }
      },
      [namespace, navigateToView, selectedClusterId]
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
      (event: EventData, index: number) => eventGridStableKey(event, index, namespace),
      [namespace]
    );

    const sortRowIdentity = useCallback(
      (event: EventData) => namespaceEventRowIdentity(event, namespace, selectedClusterId),
      [namespace, selectedClusterId]
    );

    // Define columns for Events
    const columns: GridColumnDefinition<EventData>[] = useMemo(() => {
      const baseColumns: GridColumnDefinition<EventData>[] = [
        cf.createKindColumn<EventData>({
          getKind: () => 'Event',
          getDisplayText: () => getDisplayKind('Event', useShortResourceNames),
          onClick: openEvent,
          onAltClick: navigateToEvent,
        }),
        createEventTypeColumn<EventData>(),
      ];

      if (showNamespaceColumn) {
        baseColumns.push(
          cf.createTextColumn(
            'namespace',
            EVENT_LABELS.namespace,
            (event) => eventGridObjectNamespace(event) ?? '-',
            namespaceColumnLink
          )
        );
      }

      baseColumns.push(
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
        cf.createAgeColumn<EventData>('age', EVENT_LABELS.lastSeen, (event) => event.age)
      );

      const sizing: cf.ColumnSizingMap = {
        kind: { autoWidth: true },
        type: { autoWidth: true },
        namespace: { width: 200 },
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
      namespaceColumnLink,
      openEvent,
      openInvolvedObject,
      showNamespaceColumn,
      useShortResourceNames,
    ]);

    const showNamespaceFilter = namespace === ALL_NAMESPACES_SCOPE;
    const defaultSort = useMemo(
      () =>
        ({
          key: 'age',
          direction: 'asc',
        }) as const,
      []
    );

    const diagnosticsLabel =
      namespace === ALL_NAMESPACES_SCOPE ? 'All Namespaces Events' : 'Namespace Events';
    const { gridTableProps, favModal, source } = useQueryBackedNamespaceResourceGridTable<
      NamespaceEventsSnapshotPayload,
      EventData
    >({
      queryTableMode: 'Query Backed Static',
      clusterId: queryClusterId,
      domain: 'namespace-events',
      label: diagnosticsLabel,
      selectRows: selectPayloadRows,
      viewId: 'namespace-events',
      namespace,
      columns,
      keyExtractor,
      defaultSort,
      rowIdentity: sortRowIdentity,
      filterAccessors: { getSearchText },
      showNamespaceFilters: showNamespaceFilter,
      showKindDropdown: false,
      diagnosticsLabel,
      filterOptions: { isNamespaceScoped: namespace !== ALL_NAMESPACES_SCOPE },
    });

    // The involved-object action handler reads the single source of truth.
    const displayedEvents = source.rows;

    const objectActions = useObjectActionController({
      context: 'gridtable',
      useDefaultHandlers: false,
      onOpen: (object) => openWithObject(object),
      onViewInvolvedObject: (object) => {
        const event = displayedEvents.find(
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

    const emptyMessage = useMemo(
      () =>
        resolveEmptyStateMessage(
          undefined,
          `No events found ${namespace === ALL_NAMESPACES_SCOPE ? 'in any namespaces' : 'in this namespace'}`
        ),
      [namespace]
    );

    return (
      <>
        <ResourceInventoryTable
          source={source}
          gridTableProps={gridTableProps}
          spinnerMessage="Loading events..."
          favModal={favModal}
          columns={columns}
          diagnosticsLabel={
            namespace === ALL_NAMESPACES_SCOPE ? 'All Namespaces Events' : 'Namespace Events'
          }
          diagnosticsMode="live"
          onRowClick={openEvent}
          tableClassName="gridtable-ns-events"
          enableContextMenu={true}
          getCustomContextMenuItems={getContextMenuItems}
          useShortNames={useShortResourceNames}
          emptyMessage={emptyMessage}
        />
        {objectActions.modals}
      </>
    );
  }
);

NsEventsTable.displayName = 'NsViewEvents';

export default NsEventsTable;
