/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Logs/hooks/useLogDownloadActions.ts
 *
 * Download actions shared by Container Logs and Node Logs: copying the shown
 * logs or saving them to a file, with feedback on the Download button, and
 * copying a text selection inside the log view. Failures are reported, never
 * swallowed.
 */

import { saveCsvFile, saveLogFile } from '@core/data-access';
import { writeClipboardText } from '@core/desktop-runtime';
import { buildExportFilename, type DownloadOutcome } from '@shared/utils/exportFilename';
import { useKeyboardSurface } from '@ui/shortcuts';
import { type Dispatch, type RefObject, useCallback, useEffect, useRef } from 'react';
import { reportOperationalError } from '@/utils/errorHandler';
import type { LogOptionsAction } from '../logOptionsReducer';
import { getSelectedTextWithinRoot, selectAllTextWithinRoot } from '../textSelection';

const DOWNLOAD_FEEDBACK_MS = 750;

/**
 * Returns actions that copy the text `getText` builds, or save it to a file named
 * `luxury-yacht-<fileBase>-<YYYYMMDDHHmmss>`, and show success or failure on the
 * Download button. The text is built only when one runs. In Table view the text is
 * CSV, so it is saved as a .csv file; otherwise as a .log file.
 */
export function useLogDownloadActions({
  getText,
  isTableView,
  fileBase,
  dispatch,
  source,
}: {
  getText: () => string;
  isTableView: boolean;
  fileBase: string;
  dispatch: Dispatch<LogOptionsAction>;
  source: string;
}): { copyLogs: () => Promise<void>; saveLogs: () => Promise<void> } {
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
      }
    },
    []
  );

  const showFeedback = useCallback(
    (feedback: 'done' | 'error') => {
      dispatch({ type: 'SET_DOWNLOAD_FEEDBACK', payload: feedback });
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
      }
      resetTimerRef.current = setTimeout(
        () => dispatch({ type: 'SET_DOWNLOAD_FEEDBACK', payload: 'idle' }),
        DOWNLOAD_FEEDBACK_MS
      );
    },
    [dispatch]
  );

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
      // A canceled save leaves the button as it was.
      if (outcome !== 'canceled') {
        showFeedback(outcome === 'done' ? 'done' : 'error');
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

  return { copyLogs, saveLogs };
}

/** Routes the app's native copy and select-all to the text inside the log view. */
export function useLogSelectionCopy({
  rootRef,
  active,
  source,
}: {
  rootRef: RefObject<HTMLElement | null>;
  active: boolean;
  source: string;
}): void {
  useKeyboardSurface({
    kind: 'editor',
    rootRef,
    active,
    captureWhenActive: true,
    onNativeAction: ({ action, selection }) => {
      if (action === 'copy') {
        const text = getSelectedTextWithinRoot(selection, rootRef.current);
        if (!text) {
          return false;
        }
        void writeClipboardText(text).catch((error) => {
          reportOperationalError(error, { source, action: 'copySelectedLogText' });
        });
        return true;
      }
      if (action === 'selectAll') {
        return selectAllTextWithinRoot(selection, rootRef.current);
      }
      return false;
    },
  });
}
