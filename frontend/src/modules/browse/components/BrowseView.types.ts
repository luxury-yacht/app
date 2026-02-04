/**
 * frontend/src/modules/browse/components/BrowseView.types.ts
 *
 * Type definitions for the BrowseView component.
 */

/**
 * Props for the BrowseView component.
 */
export interface BrowseViewProps {
  /**
   * The namespace scope for the browse view.
   * - undefined: Cluster-scoped browse (shows all namespaces)
   * - specific namespace: Namespace-scoped browse (pinned to that namespace)
   * - ALL_NAMESPACES_SCOPE: All namespaces browse (shows all namespaces)
   */
  namespace?: string | null;

  /**
   * View ID for persistence.
   * Defaults to 'browse' for cluster scope or 'namespace-browse' for namespace scope.
   */
  viewId?: string;

  /** Additional class name for the container */
  className?: string;

  /** Class name for the table */
  tableClassName?: string;

  /** Message shown when no items are found */
  emptyMessage?: string;

  /** Message shown while loading */
  loadingMessage?: string;
}

/**
 * The scope type derived from the namespace prop.
 */
export type BrowseScope = 'cluster' | 'namespace' | 'all-namespaces';
