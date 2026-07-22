/**
 * frontend/src/modules/cluster/components/ClusterViewEvents.tsx
 *
 * Renders cluster-scoped Kubernetes Events. It displays event rows, links
 * Event details through the object panel, links involved objects through
 * ResourceLink-aware navigation, and wires both into shared object actions.
 */

import type { ClusterEventsSnapshotPayload } from '@core/refresh/types';
import ResourceInventoryTable from '@modules/resource-grid/ResourceInventoryTable';
import { selectPayloadRows } from '@modules/resource-grid/typedResourceQueryScope';
import { useQueryBackedClusterResourceGridTable } from '@modules/resource-grid/useQueryBackedResourceGridTable';
import {
  type EventGridRow,
  useEventsGridActions,
  useEventsGridParts,
} from '@shared/events/EventsGridView';
import { clusterEventRowIdentity } from '@shared/events/eventGridModel';
import React, { useCallback, useMemo } from 'react';
import { resolveEmptyStateMessage } from '@/utils/emptyState';

interface EventViewProps {
  error?: string | null;
}

/**
 * GridTable component for cluster Events
 * Displays cluster-wide events
 */
const ClusterEventsView: React.FC<EventViewProps> = React.memo(({ error }) => {
  const parts = useEventsGridParts();
  const { selectedClusterId, keyExtractor, getSearchText, openEvent, buildColumns } = parts;

  const sortRowIdentity = useCallback(
    (event: EventGridRow) => clusterEventRowIdentity(event, selectedClusterId),
    [selectedClusterId]
  );

  const columns = useMemo(() => buildColumns({ kindAllowRowClick: false }), [buildColumns]);

  const { gridTableProps, favModal, source } = useQueryBackedClusterResourceGridTable<
    ClusterEventsSnapshotPayload,
    EventGridRow
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

  const { objectActions, getContextMenuItems } = useEventsGridActions({
    parts,
    rows: source.rows,
  });

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
        useShortNames={parts.useShortResourceNames}
        emptyMessage={emptyMessage}
      />
      {objectActions.modals}
    </>
  );
});

ClusterEventsView.displayName = 'ClusterEventsView';

export default ClusterEventsView;
