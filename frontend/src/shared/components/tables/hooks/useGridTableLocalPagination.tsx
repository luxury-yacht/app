import type { GridTableLocalPaginationConfig } from '@shared/components/tables/GridTable.types';
import TablePaginationControls, {
  shouldRenderTablePaginationControls,
} from '@shared/components/tables/TablePaginationControls';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';

interface UseGridTableLocalPaginationOptions<T> {
  data: T[];
  config?: GridTableLocalPaginationConfig;
  resetIdentity: string;
}

interface GridTableLocalPaginationResult<T> {
  data: T[];
  controls: ReactNode;
  onPrevious?: () => void;
  onNext?: () => void;
  canPagePrevious: boolean;
  canPageNext: boolean;
}

interface LocalPageState {
  resetKey: string;
  pageIndex: number;
}

export function useGridTableLocalPagination<T>({
  data,
  config,
  resetIdentity,
}: UseGridTableLocalPaginationOptions<T>): GridTableLocalPaginationResult<T> {
  const resetKey = config ? JSON.stringify([config.idPrefix, resetIdentity, config.pageSize]) : '';
  const [pageState, setPageState] = useState<LocalPageState>({
    resetKey,
    pageIndex: 1,
  });
  const pageSize = Math.max(1, config?.pageSize ?? 1);
  const pageCount = Math.max(1, Math.ceil(data.length / pageSize));
  const pageIndex = pageState.resetKey === resetKey ? Math.min(pageState.pageIndex, pageCount) : 1;

  useEffect(() => {
    setPageState((current) => {
      if (current.resetKey !== resetKey) {
        return { resetKey, pageIndex: 1 };
      }
      if (current.pageIndex <= pageCount) {
        return current;
      }
      return { resetKey, pageIndex: pageCount };
    });
  }, [pageCount, resetKey]);

  const onPrevious = useCallback(() => {
    setPageState((current) => {
      const currentPageIndex =
        current.resetKey === resetKey ? Math.min(current.pageIndex, pageCount) : 1;
      return { resetKey, pageIndex: Math.max(1, currentPageIndex - 1) };
    });
  }, [pageCount, resetKey]);
  const onNext = useCallback(() => {
    setPageState((current) => {
      const currentPageIndex =
        current.resetKey === resetKey ? Math.min(current.pageIndex, pageCount) : 1;
      return { resetKey, pageIndex: Math.min(pageCount, currentPageIndex + 1) };
    });
  }, [pageCount, resetKey]);
  const onPageJump = useCallback(
    (targetPageIndex: number) => {
      setPageState({
        resetKey,
        pageIndex: Math.max(1, Math.min(pageCount, targetPageIndex)),
      });
    },
    [pageCount, resetKey]
  );

  const pageData = useMemo(
    () => (config ? data.slice((pageIndex - 1) * pageSize, pageIndex * pageSize) : data),
    [config, data, pageIndex, pageSize]
  );
  const canPagePrevious = Boolean(config) && pageIndex > 1;
  const canPageNext = Boolean(config) && pageIndex < pageCount;
  const showControls =
    config &&
    shouldRenderTablePaginationControls({
      pageSizeOptions: config.pageSizeOptions,
      totalCount: data.length,
      totalIsExact: true,
      hasPrevious: canPagePrevious,
      hasNext: canPageNext,
    });
  const controls = showControls ? (
    <TablePaginationControls
      idPrefix={config.idPrefix}
      pageIndex={pageIndex}
      pageSize={pageSize}
      visibleItemCount={pageData.length}
      pageSizeOptions={config.pageSizeOptions}
      totalCount={data.length}
      totalIsExact
      hasPrevious={canPagePrevious}
      hasNext={canPageNext}
      loading={false}
      onPrevious={onPrevious}
      onNext={onNext}
      onPageSizeChange={config.onPageSizeChange}
      onPageJump={onPageJump}
    />
  ) : null;

  return {
    data: pageData,
    controls,
    onPrevious: config ? onPrevious : undefined,
    onNext: config ? onNext : undefined,
    canPagePrevious,
    canPageNext,
  };
}
