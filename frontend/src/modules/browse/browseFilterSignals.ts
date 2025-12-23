import { eventBus } from '@/core/events';

export const BROWSE_NAMESPACE_FILTER_STORAGE_KEY = 'browse:namespace-filter';

export const emitBrowseNamespaceFilter = (namespace: string) => {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    // Persist the requested namespace so BrowseView can hydrate after navigation.
    window.sessionStorage.setItem(BROWSE_NAMESPACE_FILTER_STORAGE_KEY, namespace);
  } catch {
    // Ignore sessionStorage failures (private browsing, etc.).
  }
  eventBus.emit('browse:namespace-filter', { namespace });
};
