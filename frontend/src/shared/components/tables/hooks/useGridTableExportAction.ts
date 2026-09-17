import { useCallback, useEffect, useRef, useState } from 'react';
import { reportOperationalError } from '@/utils/errorHandler';

const FEEDBACK_RESET_MS = 750;

/** Shared operation lifetime for table CSV actions; each destination owns its write policy. */
export function useGridTableExportAction(
  action: 'copyCsv' | 'exportCsvFile',
  operation: (() => Promise<boolean>) | null
) {
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

  const handleExport = useCallback(async () => {
    if (!operation) {
      setFeedback('error');
      scheduleReset();
      return;
    }
    setExporting(true);
    try {
      setFeedback((await operation()) ? 'success' : 'error');
    } catch (error) {
      reportOperationalError(error, { source: 'GridTable', action });
      setFeedback('error');
    } finally {
      setExporting(false);
      scheduleReset();
    }
  }, [action, operation, scheduleReset]);

  return { feedback, exporting, handleExport };
}
