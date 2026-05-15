import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import type { IconBarItem } from '@shared/components/IconBar/IconBar';
import { CopyIcon } from '@shared/components/icons/LogIcons';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';

const COPY_FEEDBACK_RESET_MS = 750;

const escapeCsvCell = (value: string): string => {
  const normalized = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return /[",\n]/.test(normalized) ? `"${normalized.replace(/"/g, '""')}"` : normalized;
};

interface UseGridTableCsvExportOptions<T> {
  data: T[];
  maxDisplayRows?: number;
  columns?: GridColumnDefinition<T>[];
  getTextContent?: (node: ReactNode) => string;
}

export function useGridTableCsvExport<T>({
  data,
  maxDisplayRows,
  columns,
  getTextContent,
}: UseGridTableCsvExportOptions<T>): IconBarItem {
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<'success' | 'error' | null>(null);

  const canCopyToClipboard =
    typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function';
  const visibleRowCount =
    typeof maxDisplayRows === 'number' && maxDisplayRows > 0
      ? Math.min(data.length, maxDisplayRows)
      : data.length;
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

  const buildCsvText = useCallback((): string => {
    if (!columns?.length || !getTextContent) {
      return '';
    }
    const rows =
      typeof maxDisplayRows === 'number' && maxDisplayRows > 0
        ? data.slice(0, maxDisplayRows)
        : data;

    const headerRow = columns.map((column) =>
      escapeCsvCell(getTextContent(column.header).trim() || column.key)
    );
    const dataRows = rows.map((item) =>
      columns.map((column) => escapeCsvCell(getTextContent(column.render(item)).trim()))
    );

    return [headerRow, ...dataRows].map((row) => row.join(',')).join('\n');
  }, [columns, data, getTextContent, maxDisplayRows]);

  const handleCopyCsv = useCallback(async () => {
    const csvText = buildCsvText();
    if (!canCopyToClipboard || !csvText) {
      setCopyFeedback('error');
      scheduleCopyReset();
      return;
    }

    try {
      await navigator.clipboard.writeText(csvText);
      setCopyFeedback('success');
      scheduleCopyReset();
    } catch (error) {
      console.error('Failed to copy GridTable CSV', error);
      setCopyFeedback('error');
      scheduleCopyReset();
    }
  }, [buildCsvText, canCopyToClipboard, scheduleCopyReset]);

  return useMemo<IconBarItem>(
    () => ({
      type: 'action',
      id: 'copy-gridtable-csv',
      icon: <CopyIcon width={18} height={18} />,
      onClick: () => {
        void handleCopyCsv();
      },
      title: 'Copy table as CSV',
      ariaLabel: 'Copy table as CSV',
      disabled: !canCopyToClipboard || !hasCopyableContent,
      feedback: copyFeedback,
    }),
    [canCopyToClipboard, copyFeedback, handleCopyCsv, hasCopyableContent]
  );
}
