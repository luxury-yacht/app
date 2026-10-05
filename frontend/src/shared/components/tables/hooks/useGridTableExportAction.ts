import type { DownloadOutcome } from '@shared/utils/exportFilename';
import { useCallback, useEffect, useRef, useState } from 'react';
import { reportOperationalError } from '@/utils/errorHandler';

const FEEDBACK_RESET_MS = 750;

/**
 * Operation lifetime of the table Download button: busy while a choice runs, then
 * brief success or error feedback. Each destination owns its write policy.
 */
export function useGridTableExportAction() {
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [feedback, setFeedback] = useState<'success' | 'error' | null>(null);
  const [exporting, setExporting] = useState(false);

  const scheduleReset = useCallback(() => {
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
    }
    resetTimerRef.current = setTimeout(() => setFeedback(null), FEEDBACK_RESET_MS);
  }, []);

  useEffect(
    () => () => {
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
      }
    },
    []
  );

  const run = useCallback(
    async (
      action: 'copyCsv' | 'exportCsvFile',
      operation: (() => Promise<DownloadOutcome>) | null
    ) => {
      if (!operation) {
        setFeedback('error');
        scheduleReset();
        return;
      }
      setExporting(true);
      let outcome: DownloadOutcome;
      try {
        outcome = await operation();
      } catch (error) {
        reportOperationalError(error, { source: 'GridTable', action });
        outcome = 'failed';
      } finally {
        setExporting(false);
      }
      // A canceled save leaves the button as it was.
      if (outcome === 'canceled') {
        return;
      }
      setFeedback(outcome === 'done' ? 'success' : 'error');
      scheduleReset();
    },
    [scheduleReset]
  );

  return { feedback, exporting, run };
}
