/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Logs/hooks/useLogCopyAction.ts
 *
 * Clipboard actions shared by Container Logs and Node Logs: copying the shown
 * logs with icon feedback, and copying a text selection inside the log view.
 * Failures are reported, never swallowed.
 */

import { writeClipboardText } from '@core/desktop-runtime';
import { useKeyboardSurface } from '@ui/shortcuts';
import { type Dispatch, type RefObject, useCallback, useEffect, useRef } from 'react';
import { reportOperationalError } from '@/utils/errorHandler';
import type { LogOptionsAction } from '../logOptionsReducer';
import { getSelectedTextWithinRoot, selectAllTextWithinRoot } from '../textSelection';

const COPY_FEEDBACK_MS = 750;

/**
 * Returns an action that copies the text `getText` builds and shows success or
 * failure on the copy icon. The text is built only when copying.
 */
export function useLogCopyAction({
  getText,
  dispatch,
  source,
}: {
  getText: () => string;
  dispatch: Dispatch<LogOptionsAction>;
  source: string;
}): () => Promise<void> {
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
    (feedback: 'copied' | 'error') => {
      dispatch({ type: 'SET_COPY_FEEDBACK', payload: feedback });
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
      }
      resetTimerRef.current = setTimeout(
        () => dispatch({ type: 'SET_COPY_FEEDBACK', payload: 'idle' }),
        COPY_FEEDBACK_MS
      );
    },
    [dispatch]
  );

  return useCallback(async () => {
    const text = getText();
    if (!text) {
      showFeedback('error');
      return;
    }
    try {
      await writeClipboardText(text);
      showFeedback('copied');
    } catch (error) {
      reportOperationalError(error, { source, action: 'copyLogs' });
      showFeedback('error');
    }
  }, [getText, showFeedback, source]);
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
