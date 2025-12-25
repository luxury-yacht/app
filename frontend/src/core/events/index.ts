/**
 * frontend/src/core/events/index.ts
 *
 * Barrel exports for events.
 * Re-exports public APIs for the core layer.
 */

export { eventBus, type AppEvents, type UnsubscribeFn } from './eventBus';
export { useEventBus } from './useEventBus';
