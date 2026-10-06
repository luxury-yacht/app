/**
 * frontend/src/shared/hooks/useLogDownloadMenu.tsx
 *
 * The Download button of a log view (Container Logs, Node Logs, App Logs): the
 * shared Download menu, copying or saving the shown logs as text.
 */

import { saveCsvFile, saveLogFile } from '@core/data-access';
import { writeClipboardText } from '@core/desktop-runtime';
import type { IconBarItem } from '@shared/components/IconBar/IconBar';
import { useDownloadMenu } from '@shared/hooks/useDownloadMenu';
import { buildExportFilename, type DownloadOutcome } from '@shared/utils/exportFilename';
import { useCallback } from 'react';

/**
 * Returns the log view's Download menu item (useDownloadMenu) and its copy
 * action. Copy writes the text `getText` builds; Save writes it to a file named
 * `luxury-yacht-<fileBase>-<YYYYMMDDHHmmss>`, a .csv file in a Table view (whose
 * text is CSV) and a .log file otherwise. The text is built only when a choice
 * runs; empty text is an error.
 */
export function useLogDownloadMenu({
  getText,
  isTableView = false,
  fileBase,
  source,
  disabled,
  copyShortcut,
}: {
  getText: () => string;
  isTableView?: boolean;
  fileBase: string;
  /** Names the view in error reports. */
  source: string;
  disabled: boolean;
  /** The view's copy shortcut, shown in the Copy to Clipboard tooltip. */
  copyShortcut?: string;
}): { downloadItem: IconBarItem; copyLogs: () => Promise<void> } {
  const copy = useCallback(async (): Promise<DownloadOutcome> => {
    const text = getText();
    if (!text) {
      return 'failed';
    }
    await writeClipboardText(text);
    return 'done';
  }, [getText]);

  const save = useCallback(async (): Promise<DownloadOutcome> => {
    const text = getText();
    if (!text) {
      return 'failed';
    }
    const saveFile = isTableView ? saveCsvFile : saveLogFile;
    const extension = isTableView ? 'csv' : 'log';
    const result = await saveFile(buildExportFilename(fileBase, new Date(), extension), text);
    if (result?.canceled) {
      return 'canceled';
    }
    return result?.path ? 'done' : 'failed';
  }, [fileBase, getText, isTableView]);

  const { downloadItem, runCopy } = useDownloadMenu({
    id: 'download',
    title: 'Download logs',
    disabled,
    copy,
    save,
    copyTooltip: copyShortcut
      ? `Copy logs to clipboard (${copyShortcut})`
      : 'Copy logs to clipboard',
    report: { source, copy: 'copyLogs', save: 'saveLogs' },
  });
  return { downloadItem, copyLogs: runCopy };
}
