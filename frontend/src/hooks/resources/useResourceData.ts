/**
 * frontend/src/hooks/resources/useResourceData.ts
 *
 * Tracks versions to avoid fetching unchanged data, reducing bandwidth for large clusters.
 * Provides loading, refreshing, error handling, and cancellation functionalities for Kubernetes resource data.
 */

export interface ResourceDataReturn<T> {
  data: T | null;
  loading: boolean;
  refreshing: boolean;
  error: Error | null;
  load: (showSpinner?: boolean) => Promise<void>;
  refresh: () => Promise<void>;
  reset: () => void;
  cancel: () => void;
  lastFetchTime: Date | null;
  hasLoaded: boolean;
}
