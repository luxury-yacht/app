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
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { useNavigateToView } from '@shared/hooks/useNavigateToView';
import { useShortNames } from '@/hooks/useShortNames';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import * as cf from '@shared/components/tables/columnFactories';
import React, { useMemo, useCallback } from 'react';
import ResourceGridTableView from '@shared/components/tables/ResourceGridTableView';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import { type GridColumnDefinition } from '@shared/components/tables/GridTable';
import { buildClusterScopedKey } from '@shared/components/tables/GridTable.utils';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import { buildObjectActionItems } from '@shared/hooks/useObjectActions';
import { useNamespaceColumnLink } from '@modules/namespace/components/useNamespaceColumnLink';
import { useNamespaceResourceGridTable } from '@shared/hooks/useResourceGridTable';
import {
  canResolveEventObjectReference,
  resolveEventObjectReference,
  splitEventObjectTarget,
} from '@shared/utils/eventObjectIdentity';
import {
  buildRequiredCanonicalObjectRowKey,
  buildRequiredObjectReference,
} from '@shared/utils/objectIdentity';

export interface EventData {
  kind: string;
  kindAlias?: string;
  type: string; // Event severity (Normal, Warning)
  source: string;
  reason: string;
  object: string;
  message: string;
  clusterId?: string;
  clusterName?: string;
  objectNamespace?: string;
  objectUid?: string;
  objectApiVersion?: string;
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
    const { navigateToView } = useNavigateToView();
    const { selectedClusterId } = useKubeconfig();
    const useShortResourceNames = useShortNames();
    const namespaceColumnLink = useNamespaceColumnLink<EventData>('events', (event) =>
      event.objectNamespace && event.objectNamespace.length > 0
        ? event.objectNamespace
        : event.namespace
    );
    // Include all visible columns in search: type, source, reason, object, message.
    const getSearchText = useCallback(
      (event: EventData): string[] =>
        [
          event.kind,
          event.namespace,
          event.type,
          event.source,
          event.reason,
          event.object,
          event.message,
        ].filter((v): v is string => Boolean(v)),
      []
    );

    // Build an object reference from an event's involved object for navigation.
    const getEventObjectRefInput = useCallback(
      (event: EventData) => ({
        object: event.object,
        objectUid: event.objectUid,
        objectApiVersion: event.objectApiVersion,
        objectNamespace: event.objectNamespace,
        eventNamespace: event.namespace,
        defaultNamespace: namespace,
        clusterId: event.clusterId ?? selectedClusterId ?? undefined,
        clusterName: event.clusterName ?? undefined,
      }),
      [namespace, selectedClusterId]
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
      (event: EventData, index: number) => {
        const eventNamespace =
          event.objectNamespace && event.objectNamespace.length > 0
            ? event.objectNamespace
            : event.namespace && event.namespace.length > 0
              ? event.namespace
              : namespace;
        const baseKey = `${eventNamespace}-${event.reason}-${event.source}-${event.object}-${event.ageTimestamp ?? event.age ?? '0'}-${index}`;
        return buildClusterScopedKey(event, baseKey);
      },
      [namespace]
    );

    const sortRowIdentity = useCallback(
      (event: EventData) =>
        buildRequiredCanonicalObjectRowKey(
          {
            kind: 'Event',
            name: `${event.reason}:${event.source}:${event.object}`,
            namespace:
              (event.objectNamespace && event.objectNamespace.length > 0
                ? event.objectNamespace
                : event.namespace) ?? namespace,
            clusterId: event.clusterId,
          },
          { fallbackClusterId: selectedClusterId }
        ),
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
            (event) =>
              event.objectNamespace && event.objectNamespace.length > 0
                ? event.objectNamespace
                : event.namespace || '-',
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
        }
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

    const { gridTableProps, favModal } = useNamespaceResourceGridTable<EventData>({
      viewId: 'namespace-events',
      namespace,
      data,
      columns,
      keyExtractor,
      defaultSort: { key: 'ageTimestamp', direction: 'desc' },
      rowIdentity: sortRowIdentity,
      filterAccessors: { getSearchText },
      showNamespaceFilters: showNamespaceFilter,
      diagnosticsLabel:
        namespace === ALL_NAMESPACES_SCOPE ? 'All Namespaces Events' : 'Namespace Events',
      filterOptions: { isNamespaceScoped: namespace !== ALL_NAMESPACES_SCOPE },
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
              name: event.reason,
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
        <ResourceGridTableView
          gridTableProps={gridTableProps}
          boundaryLoading={loading ?? false}
          loaded={loaded}
          spinnerMessage="Loading events..."
          favModal={favModal}
          columns={columns}
          diagnosticsLabel={
            namespace === ALL_NAMESPACES_SCOPE ? 'All Namespaces Events' : 'Namespace Events'
          }
          diagnosticsMode="live"
          loading={loading}
          keyExtractor={keyExtractor}
          onRowClick={handleEventClick}
          tableClassName="gridtable-ns-events"
          enableContextMenu={true}
          getCustomContextMenuItems={getContextMenuItems}
          useShortNames={useShortResourceNames}
          emptyMessage={emptyMessage}
        />
      </>
    );
  }
);

NsEventsTable.displayName = 'NsViewEvents';

export default NsEventsTable;
