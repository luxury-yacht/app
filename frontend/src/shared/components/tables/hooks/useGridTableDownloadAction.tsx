/**
 * frontend/src/shared/components/tables/hooks/useGridTableDownloadAction.tsx
 *
 * The table toolbar's Download button (useDownloadMenu). Its menu copies the
 * table's rows to the clipboard as CSV or saves them to a CSV file. Both take
 * every matching row when the view can fetch all pages, and otherwise the rows
 * the table holds.
 */

import { saveCsvFile } from '@core/data-access';
import { writeClipboardText } from '@core/desktop-runtime';
import type { IconBarItem } from '@shared/components/IconBar/IconBar';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';
import { buildGridTableCsv } from '@shared/components/tables/gridTableCsv';
import { useDownloadMenu } from '@shared/hooks/useDownloadMenu';
import { buildExportFilename, type DownloadOutcome } from '@shared/utils/exportFilename';
import type { ReactNode } from 'react';
import { useMemo } from 'react';

interface UseGridTableDownloadActionOptions<T> {
  data: T[];
  columns?: GridColumnDefinition<T>[];
  getTextContent?: (node: ReactNode) => string;
  /** Fetch every matching row (all pages). Without it, both choices take `data`. */
  fetchAllRows?: () => Promise<T[]>;
  /** The rows downloaded are every row the filters match, not just those shown. */
  allMatchingRows: boolean;
  /** Base of the saved file's name: `luxury-yacht-<base>-<YYYYMMDDHHmmss>.csv`. */
  defaultFilename: string;
}

export function useGridTableDownloadAction<T>({
  data,
  columns,
  getTextContent,
  fetchAllRows,
  allMatchingRows,
  defaultFilename,
}: UseGridTableDownloadActionOptions<T>): IconBarItem {
  // The CSV both choices write, built only when one runs.
  const buildCsv = useMemo(() => {
    if (!columns?.length || !getTextContent) {
      return null;
    }
    return async () =>
      buildGridTableCsv(fetchAllRows ? await fetchAllRows() : data, columns, getTextContent);
  }, [columns, data, fetchAllRows, getTextContent]);

  const copyToClipboard = useMemo(() => {
    if (!buildCsv) {
      return null;
    }
    return async (): Promise<DownloadOutcome> => {
      const csv = await buildCsv();
      if (!csv) {
        return 'failed';
      }
      await writeClipboardText(csv);
      return 'done';
    };
  }, [buildCsv]);

  const saveToFile = useMemo(() => {
    if (!buildCsv) {
      return null;
    }
    return async (): Promise<DownloadOutcome> => {
      const csv = await buildCsv();
      // Stamp the name at export time, after acquiring the rows.
      const result = await saveCsvFile(
        buildExportFilename(defaultFilename, new Date(), 'csv'),
        csv
      );
      if (result?.canceled) {
        return 'canceled';
      }
      return result?.path ? 'done' : 'failed';
    };
  }, [buildCsv, defaultFilename]);

  const { downloadItem } = useDownloadMenu({
    id: 'download-gridtable-csv',
    title: allMatchingRows ? 'Download all matching rows' : 'Download visible rows',
    disabled: data.length === 0 || !columns?.length,
    copy: copyToClipboard,
    save: saveToFile,
    report: { source: 'GridTable', copy: 'copyCsv', save: 'exportCsvFile' },
  });
  return downloadItem;
}
