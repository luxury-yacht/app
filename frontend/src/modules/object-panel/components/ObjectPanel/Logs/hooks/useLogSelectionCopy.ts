/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Logs/hooks/useLogSelectionCopy.ts
 *
 * Copying a text selection inside a log view, shared by Container Logs and Node
 * Logs. Failures are reported, never swallowed.
 */

import { writeClipboardText } from '@core/desktop-runtime';
import { useKeyboardSurface } from '@ui/shortcuts';
import type { RefObject } from 'react';
import { reportOperationalError } from '@/utils/errorHandler';
import { getSelectedTextWithinRoot, selectAllTextWithinRoot } from '../textSelection';

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
