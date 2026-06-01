import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { IconBarItem } from '@shared/components/IconBar/IconBar';
import { CopyIcon } from '@shared/components/icons/LogIcons';
import { readCatalogQueryCSV, requestData } from '@core/data-access';
import type { CatalogQuerySelectionDescriptor } from '@modules/browse/querySelection';

const COPY_QUERY_CSV_FEEDBACK_RESET_MS = 750;

interface UseCatalogQueryCsvActionOptions {
  query: CatalogQuerySelectionDescriptor;
  totalCount: number;
  pending?: boolean;
  disableWhenUnscoped?: boolean;
  id?: string;
  title?: string;
}

export function useCatalogQueryCsvAction({
  query,
  totalCount,
  pending = false,
  disableWhenUnscoped = false,
  id = 'copy-catalog-query-csv',
  title = 'Copy all matching rows as CSV',
}: UseCatalogQueryCsvActionOptions): IconBarItem {
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [feedback, setFeedback] = useState<'success' | 'error' | null>(null);
  const canCopy =
    typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function';

  const scheduleReset = useCallback(() => {
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
    }
    resetTimerRef.current = setTimeout(() => {
      setFeedback(null);
    }, COPY_QUERY_CSV_FEEDBACK_RESET_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  const handleCopy = useCallback(async () => {
    if (
      !query.clusterId ||
      !canCopy ||
      pending ||
      (disableWhenUnscoped && (query.namespaces?.length ?? 0) === 0)
    ) {
      setFeedback('error');
      scheduleReset();
      return;
    }

    try {
      const result = await requestData({
        resource: 'catalog-query-csv',
        adapter: 'rpc-read',
        reason: 'user',
        label: title,
        scope: query.scope,
        read: () =>
          readCatalogQueryCSV(
            query.clusterId,
            query.kinds ?? [],
            query.namespaces ?? [],
            query.search ?? '',
            query.sortField ?? '',
            query.sortDirection ?? '',
            query.customOnly
          ),
      });
      if (result.status !== 'executed') {
        setFeedback('error');
        return;
      }
      await navigator.clipboard.writeText(result.data ?? '');
      setFeedback('success');
    } catch (error) {
      console.error('Failed to copy all matching catalog rows as CSV', error);
      setFeedback('error');
    } finally {
      scheduleReset();
    }
  }, [canCopy, disableWhenUnscoped, pending, query, scheduleReset, title]);

  return useMemo<IconBarItem>(
    () => ({
      type: 'action',
      id,
      icon: <CopyIcon width={18} height={18} />,
      onClick: () => {
        void handleCopy();
      },
      title,
      ariaLabel: title,
      disabled:
        !query.clusterId ||
        !canCopy ||
        pending ||
        totalCount === 0 ||
        (disableWhenUnscoped && (query.namespaces?.length ?? 0) === 0),
      feedback,
    }),
    [canCopy, disableWhenUnscoped, feedback, handleCopy, id, pending, query, title, totalCount]
  );
}
