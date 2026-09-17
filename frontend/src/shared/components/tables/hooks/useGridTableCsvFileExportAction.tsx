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
import { useMemo } from 'react';
import { useGridTableExportAction } from './useGridTableExportAction';

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
  const operation = useMemo(() => {
    if (!columns?.length || !getTextContent) {
      return null;
    }
    return async () => {
      const rows = await fetchAllRows();
      const csv = buildGridTableCsv(rows, columns, getTextContent);
      // Stamp the name at export time, after acquiring every matching row.
      const result = await saveCsvFile(buildCsvExportFilename(defaultFilename, new Date()), csv);
      return Boolean(result?.path);
    };
  }, [columns, defaultFilename, fetchAllRows, getTextContent]);
  const { feedback, exporting, handleExport } = useGridTableExportAction(
    'exportCsvFile',
    operation
  );

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
