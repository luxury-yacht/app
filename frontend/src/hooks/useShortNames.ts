import { useState, useEffect } from 'react';
import { eventBus } from '@/core/events';

/**
 * Custom hook that listens to changes in the "use short resource names" setting
 * and triggers re-renders when the setting changes
 */
export function useShortNames(): boolean {
  const [useShortNames, setUseShortNames] = useState(() => {
    return localStorage.getItem('useShortResourceNames') === 'true';
  });

  useEffect(() => {
    // Listen for the event bus event
    const unsubscribe = eventBus.on('settings:short-names', (value) => {
      setUseShortNames(value);
    });

    // Also listen for storage events (in case the setting changes in another tab)
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'useShortResourceNames' && e.newValue !== null) {
        setUseShortNames(e.newValue === 'true');
      }
    };
    window.addEventListener('storage', handleStorageChange);

    // Cleanup
    return () => {
      unsubscribe();
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  return useShortNames;
}
