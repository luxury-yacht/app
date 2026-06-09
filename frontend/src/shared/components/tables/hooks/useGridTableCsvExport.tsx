import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import type { IconBarItem } from '@shared/components/IconBar/IconBar';
import { CopyIcon } from '@shared/components/icons/LogIcons';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';
import { buildGridTableCsv } from '@shared/components/tables/gridTableCsv';

const COPY_FEEDBACK_RESET_MS = 750;

interface UseGridTableCsvExportOptions<T> {
  data: T[];
  columns?: GridColumnDefinition<T>[];
  getTextContent?: (node: ReactNode) => string;
  /** Fetch every matching row (all pages); used when scope is 'all'. */
  fetchAllRows?: () => Promise<T[]>;
  /** 'page' copies the visible page; 'all' copies every matching row. */
  scope?: 'page' | 'all';
}

export function useGridTableCsvExport<T>({
  data,
  columns,
  getTextContent,
  fetchAllRows,
  scope = 'page',
}: UseGridTableCsvExportOptions<T>): IconBarItem {
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<'success' | 'error' | null>(null);
  const [copying, setCopying] = useState(false);
  const allScope = scope === 'all' && Boolean(fetchAllRows);

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
      // 'all' scope pulls every matching row; 'page' copies the rows already on screen.
      const rows = allScope && fetchAllRows ? await fetchAllRows() : data;
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
  }, [
    allScope,
    canCopyToClipboard,
    columns,
    data,
    fetchAllRows,
    getTextContent,
    scheduleCopyReset,
  ]);

  const title = !fetchAllRows
    ? 'Copy visible rows as CSV'
    : allScope
      ? 'Copy all matching rows to clipboard'
      : 'Copy current page to clipboard';

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
