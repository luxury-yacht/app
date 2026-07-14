import type { IconBarItem } from '@shared/components/IconBar/IconBar';
import { CopyIcon } from '@shared/components/icons/LogIcons';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';
import { buildGridTableCsv } from '@shared/components/tables/gridTableCsv';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const COPY_FEEDBACK_RESET_MS = 750;

interface UseGridTableCsvExportOptions<T> {
  data: T[];
  columns?: GridColumnDefinition<T>[];
  getTextContent?: (node: ReactNode) => string;
  /**
   * Fetch every matching row (all pages). When provided, Copy ALWAYS copies the
   * full matching set (filters respected); without it, Copy takes the visible
   * rows — which on non-paginated tables is already everything.
   */
  fetchAllRows?: () => Promise<T[]>;
  /** The provided local rows are every filtered match, even if the table renders one page. */
  hasAllLocalMatches?: boolean;
}

export function useGridTableCsvExport<T>({
  data,
  columns,
  getTextContent,
  fetchAllRows,
  hasAllLocalMatches = false,
}: UseGridTableCsvExportOptions<T>): IconBarItem {
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<'success' | 'error' | null>(null);
  const [copying, setCopying] = useState(false);

  const canCopyToClipboard =
    typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function';
  const visibleRowCount = data.length;
  const hasCopyableContent = visibleRowCount > 0 && Boolean(columns?.length);

  const scheduleCopyReset = useCallback(() => {
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
    }
    resetTimerRef.current = setTimeout(() => {
      setCopyFeedback(null);
    }, COPY_FEEDBACK_RESET_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  const handleCopyCsv = useCallback(async () => {
    if (!canCopyToClipboard || !columns?.length || !getTextContent) {
      setCopyFeedback('error');
      scheduleCopyReset();
      return;
    }
    setCopying(true);
    try {
      // A fetcher supplies every backend match. Otherwise copy the provided local row set,
      // which can contain all local matches even when presentation pagination is enabled.
      const rows = fetchAllRows ? await fetchAllRows() : data;
      const csvText = buildGridTableCsv(rows, columns, getTextContent);
      if (!csvText) {
        setCopyFeedback('error');
        return;
      }
      await navigator.clipboard.writeText(csvText);
      setCopyFeedback('success');
    } catch (error) {
      console.error('Failed to copy GridTable CSV', error);
      setCopyFeedback('error');
    } finally {
      setCopying(false);
      scheduleCopyReset();
    }
  }, [canCopyToClipboard, columns, data, fetchAllRows, getTextContent, scheduleCopyReset]);

  const title = fetchAllRows
    ? 'Copy all matching rows to clipboard'
    : hasAllLocalMatches
      ? 'Copy all matching rows as CSV'
      : 'Copy visible rows as CSV';

  return useMemo<IconBarItem>(
    () => ({
      type: 'action',
      id: 'copy-gridtable-csv',
      icon: <CopyIcon width={18} height={18} />,
      onClick: () => {
        void handleCopyCsv();
      },
      title,
      ariaLabel: title,
      disabled: !canCopyToClipboard || !hasCopyableContent || copying,
      feedback: copyFeedback,
    }),
    [canCopyToClipboard, copyFeedback, copying, handleCopyCsv, hasCopyableContent, title]
  );
}
