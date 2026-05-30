/**
 * frontend/src/shared/components/tables/ResourceGridTableView.tsx
 *
 * Wraps a shared resource-grid GridTable binding in the standard loading
 * boundary used by browse, namespace, and cluster resource views.
 */

import type React from 'react';
import GridTable, { type GridTableProps } from '@shared/components/tables/GridTable';
import ResourceLoadingBoundary from '@shared/components/ResourceLoadingBoundary';

interface ResourceGridTableViewProps<T> extends Omit<GridTableProps<T>, 'data' | 'keyExtractor'> {
  gridTableProps: Partial<GridTableProps<T>> & Pick<GridTableProps<T>, 'data' | 'keyExtractor'>;
  boundaryLoading?: boolean;
  loaded?: boolean;
  spinnerMessage: string;
  favModal?: React.ReactNode;
  allowPartial?: boolean;
  suppressEmptyWarning?: boolean;
}

export default function ResourceGridTableView<T>({
  gridTableProps,
  boundaryLoading = false,
  loaded,
  spinnerMessage,
  favModal,
  allowPartial,
  suppressEmptyWarning,
  ...tableProps
}: ResourceGridTableViewProps<T>) {
  return (
    <>
      <ResourceLoadingBoundary
        loading={boundaryLoading}
        dataLength={gridTableProps.data.length}
        hasLoaded={loaded}
        spinnerMessage={spinnerMessage}
        allowPartial={allowPartial}
        suppressEmptyWarning={suppressEmptyWarning}
      >
        <GridTable<T> {...gridTableProps} {...tableProps} />
      </ResourceLoadingBoundary>
      {favModal}
    </>
  );
}
