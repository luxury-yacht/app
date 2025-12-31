/**
 * frontend/src/hooks/useShortNames.ts
 *
 * Hook for useShortNames.
 * Listens to changes in the "use short resource names" setting and triggers re-renders when the setting changes.
 */
import { useState, useEffect } from 'react';
import { eventBus } from '@/core/events';
import { getUseShortResourceNames } from '@/core/settings/appPreferences';

/**
 * Custom hook that listens to changes in the "use short resource names" setting
 * and triggers re-renders when the setting changes
 */
export function useShortNames(): boolean {
  const [useShortNames, setUseShortNames] = useState(() => {
    return getUseShortResourceNames();
  });

  useEffect(() => {
    // Listen for the event bus event
    const unsubscribe = eventBus.on('settings:short-names', (value) => {
      setUseShortNames(value);
    });

    // Cleanup
    return () => {
      unsubscribe();
    };
  }, []);

  return useShortNames;
}
