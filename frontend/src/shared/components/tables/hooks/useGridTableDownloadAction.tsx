/**
 * frontend/src/shared/components/tables/hooks/useGridTableDownloadAction.tsx
 *
 * The table toolbar's Download button. Its menu copies the table's rows to the
 * clipboard as CSV or saves them to a CSV file. Both take every matching row when
 * the view can fetch all pages, and otherwise the rows the table holds.
 */

import { saveCsvFile } from '@core/data-access';
import { writeClipboardText } from '@core/desktop-runtime';
import type { IconBarItem } from '@shared/components/IconBar/IconBar';
import { DownloadIcon } from '@shared/components/icons/SharedIcons';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';
import { buildGridTableCsv } from '@shared/components/tables/gridTableCsv';
import { buildExportFilename } from '@shared/utils/exportFilename';
import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { useGridTableExportAction } from './useGridTableExportAction';

interface UseGridTableDownloadActionOptions<T> {
  data: T[];
  columns?: GridColumnDefinition<T>[];
  getTextContent?: (node: ReactNode) => string;
  /** Fetch every matching row (all pages). Without it, both choices take `data`. */
  fetchAllRows?: () => Promise<T[]>;
  /** `data` holds every filtered match, even if the table renders one page. */
  hasAllLocalMatches?: boolean;
  /** Base of the saved file's name: `luxury-yacht-<base>-<YYYYMMDDHHmmss>.csv`. */
  defaultFilename: string;
}

export function useGridTableDownloadAction<T>({
  data,
  columns,
  getTextContent,
  fetchAllRows,
  hasAllLocalMatches = false,
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
    return async () => {
      const csv = await buildCsv();
      if (!csv) {
        return false;
      }
      await writeClipboardText(csv);
      return true;
    };
  }, [buildCsv]);

  const saveToFile = useMemo(() => {
    if (!buildCsv) {
      return null;
    }
    return async () => {
      const csv = await buildCsv();
      // Stamp the name at export time, after acquiring the rows.
      const result = await saveCsvFile(buildExportFilename(defaultFilename, new Date(), 'csv'), csv);
      return Boolean(result?.path);
    };
  }, [buildCsv, defaultFilename]);

  const { feedback, exporting, run } = useGridTableExportAction();
  const title =
    fetchAllRows || hasAllLocalMatches ? 'Download all matching rows' : 'Download visible rows';

  return useMemo<IconBarItem>(
    () => ({
      type: 'menu',
      id: 'download-gridtable-csv',
      icon: <DownloadIcon width={18} height={18} />,
      title,
      ariaLabel: title,
      menuItems: [
        { label: 'Copy to Clipboard', onClick: () => void run('copyCsv', copyToClipboard) },
        { label: 'Save to File', onClick: () => void run('exportCsvFile', saveToFile) },
      ],
      disabled: data.length === 0 || !columns?.length || exporting,
      feedback,
    }),
    [columns?.length, copyToClipboard, data.length, exporting, feedback, run, saveToFile, title]
  );
}
