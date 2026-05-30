/**
 * frontend/src/modules/resource-grid/ObjectPanelResourceGridTableSurface.tsx
 *
 * Shared object-panel table surface for resource-grid adapters.
 */

import GridTable from '@shared/components/tables/GridTable';
import ResourceLoadingBoundary from '@shared/components/ResourceLoadingBoundary';
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

  return (
    <ResourceLoadingBoundary
      loading={loading}
      dataLength={gridTableProps.data.length}
      hasLoaded={!loading || hasRows}
      spinnerMessage={spinnerMessage}
    >
      <GridTable<T>
        {...gridTableProps}
        columns={columns}
        diagnosticsLabel={diagnosticsLabel}
        diagnosticsMode={diagnosticsMode}
        onRowClick={onRowClick}
        enableContextMenu={enableContextMenu}
        getCustomContextMenuItems={getCustomContextMenuItems}
        tableClassName={tableClassName}
        loading={loading && !hasRows}
        loadingOverlay={{
          show: loading && hasRows,
          message: updatingMessage,
        }}
        hideHeader={hideHeader}
      />
    </ResourceLoadingBoundary>
  );
}
