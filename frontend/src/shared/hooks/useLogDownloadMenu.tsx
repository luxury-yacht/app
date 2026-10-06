/**
 * frontend/src/shared/hooks/useLogDownloadMenu.tsx
 *
 * The Download button of a log view (Container Logs, Node Logs, App Logs): a
 * menu that copies the shown logs or saves them to a file, with brief success
 * or error feedback on the button. Failures are reported, never swallowed.
 */

import { saveCsvFile, saveLogFile } from '@core/data-access';
import { writeClipboardText } from '@core/desktop-runtime';
import type { IconBarItem } from '@shared/components/IconBar/IconBar';
import { DownloadIcon } from '@shared/components/icons/SharedIcons';
import { buildExportFilename, type DownloadOutcome } from '@shared/utils/exportFilename';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { reportOperationalError } from '@/utils/errorHandler';

const FEEDBACK_RESET_MS = 750;

/**
 * Returns the Download menu item and its copy action. Copy writes the text
 * `getText` builds; Save writes it to a file named
 * `luxury-yacht-<fileBase>-<YYYYMMDDHHmmss>`, a .csv file in a Table view
 * (whose text is CSV) and a .log file otherwise. The text is built only when a
 * choice runs, and a canceled save leaves the button as it was.
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
  const [feedback, setFeedback] = useState<'success' | 'error' | null>(null);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
      }
    },
    []
  );

  const showFeedback = useCallback((next: 'success' | 'error') => {
    setFeedback(next);
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
    }
    resetTimerRef.current = setTimeout(() => {
      resetTimerRef.current = null;
      setFeedback(null);
    }, FEEDBACK_RESET_MS);
  }, []);

  // Runs one destination's write for the built text and reports how it went.
  const download = useCallback(
    async (action: 'copyLogs' | 'saveLogs', write: (text: string) => Promise<DownloadOutcome>) => {
      const text = getText();
      if (!text) {
        showFeedback('error');
        return;
      }
      let outcome: DownloadOutcome;
      try {
        outcome = await write(text);
      } catch (error) {
        reportOperationalError(error, { source, action });
        outcome = 'failed';
      }
      if (outcome !== 'canceled') {
        showFeedback(outcome === 'done' ? 'success' : 'error');
      }
    },
    [getText, showFeedback, source]
  );

  const copyLogs = useCallback(
    () =>
      download('copyLogs', async (text) => {
        await writeClipboardText(text);
        return 'done';
      }),
    [download]
  );

  const saveLogs = useCallback(
    () =>
      download('saveLogs', async (text) => {
        const save = isTableView ? saveCsvFile : saveLogFile;
        const extension = isTableView ? 'csv' : 'log';
        const result = await save(buildExportFilename(fileBase, new Date(), extension), text);
        if (result?.canceled) {
          return 'canceled';
        }
        return result?.path ? 'done' : 'failed';
      }),
    [download, fileBase, isTableView]
  );

  const downloadItem = useMemo<IconBarItem>(
    () => ({
      type: 'menu',
      id: 'download',
      icon: <DownloadIcon width={18} height={18} />,
      title: 'Download logs',
      menuItems: [
        {
          label: 'Copy to Clipboard',
          onClick: copyLogs,
          tooltip: copyShortcut
            ? `Copy logs to clipboard (${copyShortcut})`
            : 'Copy logs to clipboard',
        },
        { label: 'Save to File', onClick: saveLogs },
      ],
      disabled,
      feedback,
    }),
    [copyLogs, copyShortcut, disabled, feedback, saveLogs]
  );

  return { downloadItem, copyLogs };
}
