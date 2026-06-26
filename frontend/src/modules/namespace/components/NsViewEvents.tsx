/**
 * frontend/src/modules/namespace/components/NsViewEvents.tsx
 *
 * Renders namespace-scoped Kubernetes Events. It displays event rows, links
 * involved objects through ResourceLink-aware navigation, and wires event
 * context menu actions into the shared object action controller.
 */

import './NsViewEvents.css';
import { getDisplayKind } from '@/utils/kindAliasMap';
import { resolveEmptyStateMessage } from '@/utils/emptyState';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { useNavigateToView } from '@shared/hooks/useNavigateToView';
import { useShortNames } from '@/hooks/useShortNames';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import * as cf from '@shared/components/tables/columnFactories';
import React, { useMemo, useCallback } from 'react';
import ResourceInventoryTable from '@modules/resource-grid/ResourceInventoryTable';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import { type GridColumnDefinition } from '@shared/components/tables/GridTable';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import { useObjectActionController } from '@shared/hooks/useObjectActionController';
import { useNamespaceColumnLink } from '@modules/namespace/components/useNamespaceColumnLink';
import { useQueryBackedNamespaceResourceGridTable } from '@modules/resource-grid/useQueryBackedResourceGridTable';
import { selectPayloadRows } from '@modules/resource-grid/typedResourceQueryScope';
import { splitEventObjectTarget } from '@shared/utils/eventObjectIdentity';
import {
  eventGridActionReference,
  eventGridCanOpenRelatedObject,
  eventGridObjectNamespace,
  eventGridSearchText,
  eventGridStableKey,
  namespaceEventRowIdentity,
  resolveEventGridRelatedObject,
} from '@shared/events/eventGridModel';
import type { NamespaceEventsSnapshotPayload, ResourceLink } from '@core/refresh/types';

export interface EventData {
  kind: string;
  kindAlias?: string;
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
  namespace?: string;
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

    const canOpenEventObject = useCallback(
      (event: EventData) =>
        eventGridCanOpenRelatedObject(event, {
          defaultNamespace: namespace,
          selectedClusterId,
        }),
      [namespace, selectedClusterId]
    );

    const handleEventClick = useCallback(
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

    const handleEventAltClick = useCallback(
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
        }),
        cf.createTextColumn<EventData>('type', 'Type', (event) => event.type || 'Normal', {
          getClassName: (event) => `event-badge ${(event.type || 'normal').toLowerCase()}`,
        }),
      ];

      if (showNamespaceColumn) {
        baseColumns.push(
          cf.createTextColumn(
            'namespace',
            'Namespace',
            (event) => eventGridObjectNamespace(event) ?? '-',
            namespaceColumnLink
          )
        );
      }

      baseColumns.push(
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
        cf.createAgeColumn<EventData>('age', 'Age', (event) => event.age)
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
      canOpenEventObject,
      handleEventAltClick,
      handleEventClick,
      namespaceColumnLink,
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
      onViewInvolvedObject: (object) => {
        const event = displayedEvents.find(
          (candidate) =>
            candidate.clusterId === object.clusterId &&
            candidate.namespace === object.namespace &&
            candidate.reason === object.name &&
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
          eventGridActionReference(event, event.reason, selectedClusterId, {
            involvedObject: event.object,
            involvedObjectRef: event.involvedObject,
          })
        );
      },
      [canOpenEventObject, objectActions, selectedClusterId]
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
          onRowClick={handleEventClick}
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
