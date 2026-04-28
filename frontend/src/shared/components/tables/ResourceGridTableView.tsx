import type React from 'react';
import GridTable, { type GridTableProps } from '@shared/components/tables/GridTable';
import ResourceLoadingBoundary from '@shared/components/ResourceLoadingBoundary';

interface ResourceGridTableViewProps<T> extends Omit<GridTableProps<T>, 'data'> {
  gridTableProps: Partial<GridTableProps<T>> & Pick<GridTableProps<T>, 'data'>;
  boundaryLoading?: boolean;
  loaded: boolean;
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
