import { useEffect } from 'react';
import { refreshOrchestrator } from '@/core/refresh';
import { eventBus } from '@/core/events';

const DEFAULT_CATALOG_SCOPE = 'limit=200';

/**
 * Initializes and manages the catalog stream, restarting it when kubeconfig changes.
 */
export function useCatalogStream(): void {
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const applyCatalogStream = () => {
      refreshOrchestrator.setDomainScope('catalog', DEFAULT_CATALOG_SCOPE);
      refreshOrchestrator.setDomainEnabled('catalog', true);
    };

    applyCatalogStream();

    const unsubChanged = eventBus.on('kubeconfig:changed', applyCatalogStream);

    return () => {
      unsubChanged();
      refreshOrchestrator.setDomainEnabled('catalog', false);
    };
  }, []);
}
