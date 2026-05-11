/**
 * frontend/src/hooks/useExclusiveNamespaces.ts
 *
 * Hook for the "Exclusive namespaces" Sidebar setting.
 */
import { useEffect, useState } from 'react';
import { eventBus } from '@/core/events';
import { getExclusiveNamespaces } from '@/core/settings/appPreferences';

export function useExclusiveNamespaces(): boolean {
  const [exclusiveNamespaces, setExclusiveNamespaces] = useState(() => {
    return getExclusiveNamespaces();
  });

  useEffect(() => {
    const unsubscribe = eventBus.on('settings:exclusive-namespaces', (value) => {
      setExclusiveNamespaces(value);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  return exclusiveNamespaces;
}
