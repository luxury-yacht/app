/**
 * frontend/src/modules/namespace/components/NsViewEvents.tsx
 *
 * Renders namespace-scoped Kubernetes Events via the shared events grid
 * skeleton; this view owns the namespace scope wiring (row identity, the
 * namespace column, and the namespace query hook).
 */

import type { NamespaceEventsSnapshotPayload } from '@core/refresh/types';
import { useNamespaceColumnLink } from '@modules/namespace/components/useNamespaceColumnLink';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import ResourceInventoryTable from '@modules/resource-grid/ResourceInventoryTable';
import { selectPayloadRows } from '@modules/resource-grid/typedResourceQueryScope';
import { useQueryBackedNamespaceResourceGridTable } from '@modules/resource-grid/useQueryBackedResourceGridTable';
import * as cf from '@shared/components/tables/columnFactories';
import {
  type EventGridRow,
  useEventsGridActions,
  useEventsGridParts,
} from '@shared/events/EventsGridView';
import { eventGridObjectNamespace, namespaceEventRowIdentity } from '@shared/events/eventGridModel';
import { EVENT_LABELS } from '@shared/events/eventPresentation';
import React, { useCallback, useMemo } from 'react';
import { resolveEmptyStateMessage } from '@/utils/emptyState';

export type EventData = EventGridRow;

interface EventViewProps {
  namespace: string;
  showNamespaceColumn?: boolean;
}

/**
 * GridTable component for namespace Events
 */
const NsEventsTable: React.FC<EventViewProps> = React.memo(
  ({ namespace, showNamespaceColumn = false }) => {
    const parts = useEventsGridParts({ defaultNamespace: namespace });
    const { selectedClusterId, keyExtractor, getSearchText, openEvent, buildColumns } = parts;
    const namespaceColumnLink = useNamespaceColumnLink<EventGridRow>('events', (event) =>
      event.objectNamespace && event.objectNamespace.length > 0
        ? event.objectNamespace
        : event.ref.namespace
    );

    const sortRowIdentity = useCallback(
      (event: EventGridRow) => namespaceEventRowIdentity(event, namespace, selectedClusterId),
      [namespace, selectedClusterId]
    );

    const columns = useMemo(
      () =>
        buildColumns({
          namespaceColumn: showNamespaceColumn
            ? cf.createTextColumn(
                'namespace',
                EVENT_LABELS.namespace,
                (event: EventGridRow) => eventGridObjectNamespace(event) ?? '-',
                namespaceColumnLink
              )
            : undefined,
        }),
      [buildColumns, namespaceColumnLink, showNamespaceColumn]
    );

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
      EventGridRow
    >({
      queryTableMode: 'Query Backed Static',
      clusterId: selectedClusterId,
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

    const { objectActions, getContextMenuItems } = useEventsGridActions({
      parts,
      rows: source.rows,
    });

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
          diagnosticsLabel={diagnosticsLabel}
          diagnosticsMode="live"
          onRowClick={openEvent}
          tableClassName="gridtable-ns-events"
          enableContextMenu={true}
          getCustomContextMenuItems={getContextMenuItems}
          useShortNames={parts.useShortResourceNames}
          emptyMessage={emptyMessage}
        />
        {objectActions.modals}
      </>
    );
  }
);

NsEventsTable.displayName = 'NsViewEvents';

export default NsEventsTable;
