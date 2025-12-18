import { eventBus } from '@/core/events';

export const PODS_UNHEALTHY_STORAGE_KEY = 'pods:unhealthy-filter-scope';

export const emitPodsUnhealthySignal = (scope: string) => {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.sessionStorage.setItem(PODS_UNHEALTHY_STORAGE_KEY, scope);
  } catch {
    // Ignore sessionStorage failures (for private browsing, etc.)
  }
  eventBus.emit('pods:show-unhealthy', { scope });
};
