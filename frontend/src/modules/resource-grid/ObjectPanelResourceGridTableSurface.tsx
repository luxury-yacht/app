/**
 * frontend/src/modules/resource-grid/ObjectPanelResourceGridTableSurface.tsx
 *
 * Shared object-panel table surface. Object-panel related-resource tables (a
 * parent's Pods, a CronJob's Jobs) are bounded local data — the full owner-scoped
 * set is already resident, with no query or pagination — so this surface routes
 * them through `boundedRowsSource` + the one `ResourceInventoryTable` controller
 * rather than owning its own loading boundary. The controller derives the same
 * behavior the surface used to hand-roll: a cold load with no rows shows the
 * boundary spinner, a refresh with rows shows the `updatingMessage` overlay, and
 * a settled-empty result shows the empty state.
 */

import { boundedRowsSource } from './boundedRowsSource';
import ResourceInventoryTable from './ResourceInventoryTable';
import type {
  ObjectPanelResourceGridTableSurfaceProps,
  ResourceGridTableRow,
} from './resourceGridTableTypes';

export function ObjectPanelResourceGridTableSurface<T extends ResourceGridTableRow>({
  gridTableProps,
  columns,
  diagnosticsLabel,
  loading,
  spinnerMessage,
  updatingMessage,
  diagnosticsMode = 'live',
  tableClassName,
  hideHeader,
  onRowClick,
  enableContextMenu,
  getCustomContextMenuItems,
}: ObjectPanelResourceGridTableSurfaceProps<T>) {
  const hasRows = gridTableProps.data.length > 0;
  // Bounded local: the array IS the complete owner-scoped set. `loaded` mirrors
  // the surface's former hasLoaded — visible rows count as loaded, and a load in
  // flight without rows is still cold.
  const source = boundedRowsSource<T>({
    rows: gridTableProps.data,
    loading,
    loaded: !loading || hasRows,
  });

  return (
    <ResourceInventoryTable<T>
      source={source}
      gridTableProps={gridTableProps}
      spinnerMessage={spinnerMessage}
      updatingMessage={updatingMessage}
      columns={columns}
      diagnosticsLabel={diagnosticsLabel}
      diagnosticsMode={diagnosticsMode}
      onRowClick={onRowClick}
      enableContextMenu={enableContextMenu}
      getCustomContextMenuItems={getCustomContextMenuItems}
      tableClassName={tableClassName}
      hideHeader={hideHeader}
    />
  );
}
