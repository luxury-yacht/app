/**
 * frontend/src/core/events/useEventBus.ts
 *
 * React hook for subscribing to event bus events with automatic cleanup.
 * Simplifies event subscription in functional components.
 */

import { useEffect } from 'react';
import { eventBus, type AppEvents } from './eventBus';

type EventCallback<T> = (payload: T) => void;

/**
 * Subscribe to an event bus event. Automatically unsubscribes on unmount.
 */
export function useEventBus<K extends keyof AppEvents>(
  event: K,
  callback: EventCallback<AppEvents[K]>,
  deps: React.DependencyList = []
): void {
  useEffect(() => {
    const unsubscribe = eventBus.on(event, callback);
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event, ...deps]);
}
