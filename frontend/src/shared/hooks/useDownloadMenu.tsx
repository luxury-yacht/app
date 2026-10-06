/**
 * frontend/src/shared/hooks/useDownloadMenu.tsx
 *
 * The Download button every table and log view shows: a menu with Copy to
 * Clipboard and Save to File. It is busy while a choice runs, then shows brief
 * success or error feedback. A canceled save leaves the button as it was, and
 * failures are reported, never swallowed. Each view supplies how it copies and
 * saves.
 */

import type { IconBarItem } from '@shared/components/IconBar/IconBar';
import { DownloadIcon } from '@shared/components/icons/SharedIcons';
import type { DownloadOutcome } from '@shared/utils/exportFilename';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { reportOperationalError } from '@/utils/errorHandler';

const FEEDBACK_RESET_MS = 750;

/** One choice's write, or null when the view has nothing it can download. */
export type DownloadChoice = (() => Promise<DownloadOutcome>) | null;

export function useDownloadMenu({
  id,
  title,
  disabled,
  copy,
  save,
  copyTooltip,
  report,
}: {
  id: string;
  title: string;
  disabled: boolean;
  copy: DownloadChoice;
  save: DownloadChoice;
  copyTooltip?: string;
  /** Names the view and each choice in error reports. */
  report: { source: string; copy: string; save: string };
}): { downloadItem: IconBarItem; runCopy: () => Promise<void> } {
  const [feedback, setFeedback] = useState<'success' | 'error' | null>(null);
  const [busy, setBusy] = useState(false);
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

  const run = useCallback(
    async (action: string, choice: DownloadChoice) => {
      if (!choice) {
        showFeedback('error');
        return;
      }
      setBusy(true);
      let outcome: DownloadOutcome;
      try {
        outcome = await choice();
      } catch (error) {
        reportOperationalError(error, { source: report.source, action });
        outcome = 'failed';
      } finally {
        setBusy(false);
      }
      if (outcome !== 'canceled') {
        showFeedback(outcome === 'done' ? 'success' : 'error');
      }
    },
    [report.source, showFeedback]
  );

  const runCopy = useCallback(() => run(report.copy, copy), [copy, report.copy, run]);
  const runSave = useCallback(() => run(report.save, save), [report.save, run, save]);

  const downloadItem = useMemo<IconBarItem>(
    () => ({
      type: 'menu',
      id,
      icon: <DownloadIcon width={18} height={18} />,
      title,
      ariaLabel: title,
      menuItems: [
        { label: 'Copy to Clipboard', onClick: () => void runCopy(), tooltip: copyTooltip },
        { label: 'Save to File', onClick: () => void runSave() },
      ],
      disabled: disabled || busy,
      feedback,
    }),
    [busy, copyTooltip, disabled, feedback, id, runCopy, runSave, title]
  );

  return { downloadItem, runCopy };
}
