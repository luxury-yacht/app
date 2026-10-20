/**
 * frontend/src/core/refresh/hooks/useDocumentVisibilityEvents.ts
 *
 * Publishes the window's visibility to the refresh layer: while hidden, the
 * orchestrator pauses its polls and the stream managers suspend themselves.
 * Mount once per window root.
 */

import { useEffect } from 'react';
import { eventBus } from '@/core/events';

export const useDocumentVisibilityEvents = (): void => {
  useEffect(() => {
    const handleVisibilityChange = () => {
      eventBus.emit(document.hidden ? 'app:visibility-hidden' : 'app:visibility-visible');
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);
};
