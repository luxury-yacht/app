/**
 * frontend/src/shared/components/tables/hooks/useGridTableCsvFileExportAction.tsx
 *
 * The "Export all matching rows as CSV" toolbar action. It pulls EVERY matching row
 * via `fetchAllRows` (the active filters are part of the fetch scope), builds the CSV
 * from the table's displayed columns, and saves it to a file. It is the single
 * export mechanism shared by typed-resource and catalog-backed tables.
 */

import { saveCsvFile } from '@core/data-access';
import type { IconBarItem } from '@shared/components/IconBar/IconBar';
import { YamlSaveIcon } from '@shared/components/icons/YamlIcons';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';
import { buildCsvExportFilename, buildGridTableCsv } from '@shared/components/tables/gridTableCsv';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const FEEDBACK_RESET_MS = 750;

interface UseGridTableCsvFileExportActionOptions<T> {
  /** Fetch every matching row (all pages); Export always acts on the full set. */
  fetchAllRows: () => Promise<T[]>;
  columns?: GridColumnDefinition<T>[];
  getTextContent?: (node: ReactNode) => string;
  /**
   * Per-view base for the save-dialog file name; offered as
   * `luxury-yacht-<base>-<YYYYMMDDHHmmss>.csv`, stamped at export time.
   */
  defaultFilename: string;
  /** Disable when there is nothing to export (e.g. the table is empty). */
  disabled?: boolean;
}

export function useGridTableCsvFileExportAction<T>({
  fetchAllRows,
  columns,
  getTextContent,
  defaultFilename,
  disabled = false,
}: UseGridTableCsvFileExportActionOptions<T>): IconBarItem {
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [feedback, setFeedback] = useState<'success' | 'error' | null>(null);
  const [exporting, setExporting] = useState(false);

  const scheduleReset = useCallback(() => {
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
    }
    resetTimerRef.current = setTimeout(() => setFeedback(null), FEEDBACK_RESET_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  const handleExport = useCallback(async () => {
    if (!columns?.length || !getTextContent) {
      setFeedback('error');
      scheduleReset();
      return;
    }
    setExporting(true);
    try {
      const rows = await fetchAllRows();
      const csv = buildGridTableCsv(rows, columns, getTextContent);
      // Stamp the name at export time so the timestamp is the moment of export.
      const result = await saveCsvFile(buildCsvExportFilename(defaultFilename, new Date()), csv);
      setFeedback(result?.path ? 'success' : 'error');
    } catch (error) {
      // The backend rejects on a canceled save dialog too; surface a brief error
      // rather than crashing.
      console.error('Failed to export rows as CSV', error);
      setFeedback('error');
    } finally {
      setExporting(false);
      scheduleReset();
    }
  }, [columns, defaultFilename, fetchAllRows, getTextContent, scheduleReset]);

  const title = 'Export all matching rows to file';

  return useMemo<IconBarItem>(
    () => ({
      type: 'action',
      id: 'export-gridtable-csv',
      icon: <YamlSaveIcon width={18} height={18} />,
      onClick: () => {
        void handleExport();
      },
      title,
      ariaLabel: title,
      disabled: disabled || exporting || !columns?.length,
      feedback,
    }),
    [columns?.length, disabled, exporting, feedback, handleExport]
  );
}
