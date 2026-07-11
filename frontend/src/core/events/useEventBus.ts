/**
 * frontend/src/core/events/useEventBus.ts
 *
 * React hook for subscribing to event bus events with automatic cleanup.
 * Simplifies event subscription in functional components.
 */

import { useEffect, useRef } from 'react';
import { type AppEvents, eventBus } from './eventBus';

type EventCallback<T> = (payload: T) => void;

/**
 * Subscribe to an event bus event. Automatically unsubscribes on unmount.
 */
export function useEventBus<K extends keyof AppEvents>(
  event: K,
  callback: EventCallback<AppEvents[K]>,
  deps: React.DependencyList = []
): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    const unsubscribe = eventBus.on(event, (payload) => callbackRef.current(payload));
    return unsubscribe;
  }, [event, ...deps]);
}
