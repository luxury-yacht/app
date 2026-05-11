/**
 * frontend/src/hooks/useDimInactiveNamespaces.ts
 *
 * Hook for the "Dim inactive namespaces" display setting.
 */
import { useEffect, useState } from 'react';
import { eventBus } from '@/core/events';
import { getDimInactiveNamespaces } from '@/core/settings/appPreferences';

export function useDimInactiveNamespaces(): boolean {
  const [dimInactiveNamespaces, setDimInactiveNamespaces] = useState(() => {
    return getDimInactiveNamespaces();
  });

  useEffect(() => {
    const unsubscribe = eventBus.on('settings:dim-inactive-namespaces', (value) => {
      setDimInactiveNamespaces(value);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  return dimInactiveNamespaces;
}
