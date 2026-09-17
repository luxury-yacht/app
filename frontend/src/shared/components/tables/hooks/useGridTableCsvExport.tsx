import type { IconBarItem } from '@shared/components/IconBar/IconBar';
import { CopyIcon } from '@shared/components/icons/LogIcons';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';
import { buildGridTableCsv } from '@shared/components/tables/gridTableCsv';
import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { useGridTableExportAction } from './useGridTableExportAction';

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
  const canCopyToClipboard =
    typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function';
  const hasCopyableContent = data.length > 0 && Boolean(columns?.length);
  const operation = useMemo(() => {
    if (!canCopyToClipboard || !columns?.length || !getTextContent) {
      return null;
    }
    return async () => {
      // Backend fetches own all matching rows; local data already includes every local match.
      const rows = fetchAllRows ? await fetchAllRows() : data;
      const csvText = buildGridTableCsv(rows, columns, getTextContent);
      if (!csvText) {
        return false;
      }
      await navigator.clipboard.writeText(csvText);
      return true;
    };
  }, [canCopyToClipboard, columns, data, fetchAllRows, getTextContent]);
  const {
    feedback: copyFeedback,
    exporting: copying,
    handleExport: handleCopyCsv,
  } = useGridTableExportAction('copyCsv', operation);

  let title: string;

  if (fetchAllRows) {
    title = 'Copy all matching rows to clipboard';
  } else if (hasAllLocalMatches) {
    title = 'Copy all matching rows as CSV';
  } else {
    title = 'Copy visible rows as CSV';
  }

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
