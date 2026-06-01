import type { ResourceDataReturn } from '@hooks/resources';

const noop = () => {};

// Custom resource tables are catalog-backed on this branch. This handle keeps
// legacy refresh-domain consumers explicit without starting the old CRD fanout.
export const createCatalogBackedCustomResourceHandle = <T>(): ResourceDataReturn<T[]> => ({
  data: [],
  loading: false,
  refreshing: false,
  error: null,
  load: async () => {},
  refresh: async () => {},
  reset: noop,
  cancel: noop,
  lastFetchTime: null,
  hasLoaded: false,
  meta: {
    source: 'catalog-backed-custom',
    refreshDomainEnabled: false,
  },
});
