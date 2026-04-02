/**
 * frontend/src/ui/favorites/FavToggle.tsx
 *
 * Hook that returns an IconBarItem for a heart toggle in the GridTableFiltersBar.
 * When the current view matches a saved favorite the heart is filled;
 * otherwise it is outlined.  Clicking the heart opens a small popover with
 * context-appropriate actions (add / update / remove).
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { FavoriteOutlineIcon, FavoriteFilledIcon } from '@shared/components/icons/MenuIcons';
import type { IconBarItem } from '@shared/components/IconBar/IconBar';
import { useFavorites } from '@core/contexts/FavoritesContext';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useViewState } from '@core/contexts/ViewStateContext';
import { useNamespace } from '@modules/namespace/contexts/NamespaceContext';
import type { Favorite, FavoriteFilters, FavoriteTableState } from '@/core/persistence/favorites';
import type { GridTableFilterState } from '@shared/components/tables/GridTable.types';

/** Current view state that the FavToggle needs to snapshot when saving a favorite.
 *  Also accepts setters for restoring state from a pending favorite on navigation. */
export interface FavToggleState {
  /** Current grid table filter state (search, kinds, namespaces, caseSensitive). */
  filters: GridTableFilterState;
  /** Whether the include-metadata search toggle is active. */
  includeMetadata?: boolean;
  /** Current sort column key, or null if unsorted. */
  sortColumn: string | null;
  /** Current sort direction. */
  sortDirection: 'asc' | 'desc';
  /** Current column visibility map. */
  columnVisibility: Record<string, boolean>;
  /** Whether the persistence layer has finished hydrating. Restore waits for this. */
  hydrated?: boolean;
  /** Setters for restoring state from a pending favorite. */
  setFilters?: (filters: GridTableFilterState) => void;
  setSortConfig?: (config: { key: string; direction: 'asc' | 'desc' }) => void;
  setColumnVisibility?: (visibility: Record<string, boolean>) => void;
  setIncludeMetadata?: (value: boolean) => void;
}

// ---------------------------------------------------------------------------
// View-label lookup — maps tab id to display label for auto-generated names.
// Mirrors the labels used in the Sidebar navigation.
// ---------------------------------------------------------------------------

const NAMESPACE_VIEW_LABELS: Record<string, string> = {
  browse: 'Browse',
  workloads: 'Workloads',
  pods: 'Pods',
  config: 'Config',
  network: 'Network',
  rbac: 'RBAC',
  storage: 'Storage',
  autoscaling: 'Autoscaling',
  quotas: 'Quotas',
  custom: 'Custom',
  helm: 'Helm',
  events: 'Events',
};

const CLUSTER_VIEW_LABELS: Record<string, string> = {
  browse: 'Browse',
  nodes: 'Nodes',
  config: 'Config',
  crds: 'CRDs',
  custom: 'Custom',
  events: 'Events',
  rbac: 'RBAC',
  storage: 'Storage',
};

// ---------------------------------------------------------------------------
// FavTogglePopover — small absolutely-positioned popover with action choices.
// ---------------------------------------------------------------------------

interface FavTogglePopoverProps {
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  children: React.ReactNode;
}

/**
 * Renders an absolutely positioned popover near the anchor element.
 * Closes on click-outside.
 */
const FavTogglePopover: React.FC<FavTogglePopoverProps> = ({ anchorRef, onClose, children }) => {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  // Compute fixed position from anchor element's bounding rect.
  useEffect(() => {
    if (!anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    setPosition({ top: rect.bottom + 4, left: rect.left });
  }, [anchorRef]);

  // Close on click-outside.
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [anchorRef, onClose]);

  // Render via portal to escape overflow:hidden on .gridtable-container.
  return createPortal(
    <div
      ref={popoverRef}
      className="fav-toggle-popover"
      data-testid="fav-toggle-popover"
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        top: position.top,
        left: position.left,
        width: 'max-content',
        minWidth: '160px',
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--border-radius-lg, 8px)',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
        zIndex: 9999,
        overflow: 'hidden',
        padding: '0.35rem 0',
      }}
    >
      {children}
    </div>,
    document.body
  );
};

interface PopoverItemProps {
  label: string;
  onClick: () => void;
}

const PopoverItem: React.FC<PopoverItemProps> = ({ label, onClick }) => (
  <div
    className="fav-toggle-popover-item"
    data-testid="fav-toggle-popover-item"
    role="menuitem"
    onClick={(e) => {
      // Stop propagation so the click doesn't bubble up to the icon-bar
      // toggle button, which would re-open the popover immediately.
      e.stopPropagation();
      onClick();
    }}
    style={{
      padding: '0.4rem 0.75rem',
      cursor: 'pointer',
      fontSize: '0.8rem',
      color: 'var(--color-text)',
      whiteSpace: 'nowrap',
    }}
    onMouseEnter={(e) => {
      (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg-secondary)';
    }}
    onMouseLeave={(e) => {
      (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
    }}
  >
    {label}
  </div>
);

// ---------------------------------------------------------------------------
// useFavToggle hook
// ---------------------------------------------------------------------------

/**
 * Returns an IconBarItem (toggle type) for the heart favorite button
 * in the GridTableFiltersBar's preActions slot.
 */
export function useFavToggle(state: FavToggleState): IconBarItem {
  const { currentFavoriteMatch, addFavorite, updateFavorite, deleteFavorite, pendingFavorite, setPendingFavorite } = useFavorites();
  const { selectedKubeconfig, selectedClusterName } = useKubeconfig();
  const { viewType, activeNamespaceTab, activeClusterTab } = useViewState();
  const { selectedNamespace } = useNamespace();

  // Restore filter/table state from a pending favorite when it matches this view.
  // Waits for the persistence layer to finish hydrating so the restore isn't
  // overwritten by the hydration effect.
  useEffect(() => {
    if (!pendingFavorite) return;
    if (!state.hydrated) return; // Wait for persistence hydration to complete.
    if (pendingFavorite.viewType !== viewType) return;
    const expectedTab = viewType === 'namespace' ? activeNamespaceTab : activeClusterTab;
    if (pendingFavorite.view !== expectedTab) return;
    if (viewType === 'namespace' && pendingFavorite.namespace !== selectedNamespace) return;

    if (pendingFavorite.filters && state.setFilters) {
      state.setFilters({
        search: pendingFavorite.filters.search ?? '',
        kinds: pendingFavorite.filters.kinds ?? [],
        namespaces: pendingFavorite.filters.namespaces ?? [],
        caseSensitive: pendingFavorite.filters.caseSensitive ?? false,
      });
    }
    if (pendingFavorite.filters && state.setIncludeMetadata) {
      state.setIncludeMetadata(pendingFavorite.filters.includeMetadata ?? false);
    }
    if (pendingFavorite.tableState?.sortColumn && state.setSortConfig) {
      state.setSortConfig({
        key: pendingFavorite.tableState.sortColumn,
        direction: (pendingFavorite.tableState.sortDirection as 'asc' | 'desc') ?? 'asc',
      });
    }
    if (pendingFavorite.tableState?.columnVisibility && state.setColumnVisibility) {
      state.setColumnVisibility(pendingFavorite.tableState.columnVisibility);
    }
    setPendingFavorite(null);
  }, [pendingFavorite, setPendingFavorite, viewType, activeNamespaceTab, activeClusterTab, selectedNamespace, state]);

  const [popoverOpen, setPopoverOpen] = useState(false);
  // Ref to the icon-bar button element so the popover can position near it.
  const anchorRef = useRef<HTMLElement | null>(null);

  const isFavorited = currentFavoriteMatch != null;

  // Derive the active view tab (used for building the Favorite payload).
  const activeViewTab = viewType === 'namespace' ? activeNamespaceTab : activeClusterTab;

  // Build a human-readable display label for the view tab.
  const viewLabel = useMemo(() => {
    const tab = activeViewTab ?? '';
    if (viewType === 'namespace') {
      return NAMESPACE_VIEW_LABELS[tab] ?? tab;
    }
    return CLUSTER_VIEW_LABELS[tab] ?? tab;
  }, [viewType, activeViewTab]);

  /**
   * Auto-generate a friendly name for a new favorite.
   *
   * Format depends on scope:
   *   - Generic cluster view:   "{viewLabel}"
   *   - Generic namespace view: "{namespace} / {viewLabel}"
   *   - Cluster-specific cluster view:   "{contextName} / {viewLabel}"
   *   - Cluster-specific namespace view: "{contextName} / {namespace} / {viewLabel}"
   *
   * If any filters are active, " (filtered)" is appended.
   */
  const generateName = useCallback(
    (clusterSpecific: boolean): string => {
      const parts: string[] = [];

      if (clusterSpecific && selectedClusterName) {
        parts.push(selectedClusterName);
      }

      if (viewType === 'namespace' && selectedNamespace) {
        parts.push(selectedNamespace);
      }

      parts.push(viewLabel);

      return parts.join(' / ');
    },
    [selectedClusterName, viewType, selectedNamespace, viewLabel]
  );

  // Snapshot the current filter and table state for saving.
  const snapshotFilters = useCallback((): FavoriteFilters => ({
    search: state.filters.search,
    kinds: [...state.filters.kinds],
    namespaces: [...state.filters.namespaces],
    caseSensitive: state.filters.caseSensitive ?? false,
    includeMetadata: state.includeMetadata ?? false,
  }), [state.filters, state.includeMetadata]);

  const snapshotTableState = useCallback((): FavoriteTableState => ({
    sortColumn: state.sortColumn ?? '',
    sortDirection: state.sortDirection,
    columnVisibility: { ...state.columnVisibility },
  }), [state.sortColumn, state.sortDirection, state.columnVisibility]);

  const hasActiveFilters =
    state.filters.search.trim().length > 0 ||
    state.filters.kinds.length > 0 ||
    state.filters.namespaces.length > 0;

  // Build a Favorite payload for add operations.
  const buildNewFavorite = useCallback(
    (clusterSelection: string): Favorite => ({
      id: '', // Backend assigns the ID.
      name: generateName(clusterSelection !== '') + (hasActiveFilters ? ' (filtered)' : ''),
      clusterSelection,
      viewType,
      view: activeViewTab ?? '',
      namespace: viewType === 'namespace' ? (selectedNamespace ?? '') : '',
      filters: snapshotFilters(),
      tableState: snapshotTableState(),
      order: 0,
    }),
    [generateName, hasActiveFilters, viewType, activeViewTab, selectedNamespace, snapshotFilters, snapshotTableState]
  );

  const handleClose = useCallback(() => setPopoverOpen(false), []);

  // -- Add handlers (when not yet favorited) --

  const handleAddForAnyCluster = useCallback(async () => {
    setPopoverOpen(false);
    await addFavorite(buildNewFavorite(''));
  }, [addFavorite, buildNewFavorite]);

  const handleAddForThisCluster = useCallback(async () => {
    setPopoverOpen(false);
    await addFavorite(buildNewFavorite(selectedKubeconfig));
  }, [addFavorite, buildNewFavorite, selectedKubeconfig]);

  // -- Update / Remove handlers (when already favorited) --

  const handleUpdate = useCallback(async () => {
    if (!currentFavoriteMatch) return;
    setPopoverOpen(false);
    // Preserve name and cluster binding; snapshot current filters and table state.
    await updateFavorite({
      ...currentFavoriteMatch,
      filters: snapshotFilters(),
      tableState: snapshotTableState(),
    });
  }, [currentFavoriteMatch, updateFavorite, snapshotFilters, snapshotTableState]);

  const handleRemove = useCallback(async () => {
    if (!currentFavoriteMatch) return;
    setPopoverOpen(false);
    await deleteFavorite(currentFavoriteMatch.id);
  }, [currentFavoriteMatch, deleteFavorite]);

  const handleClick = useCallback(() => {
    setPopoverOpen((prev) => !prev);
  }, []);

  // Build the IconBarItem returned to the caller.
  const item = useMemo<IconBarItem>(() => {
    return {
      type: 'toggle' as const,
      id: 'favorite',
      icon: (
        <span
          ref={anchorRef as React.Ref<HTMLSpanElement>}
          style={{ position: 'relative', display: 'inline-flex' }}
        >
          {isFavorited ? <FavoriteFilledIcon /> : <FavoriteOutlineIcon />}
          {popoverOpen && (
            <FavTogglePopover anchorRef={anchorRef} onClose={handleClose}>
              {isFavorited ? (
                <>
                  <PopoverItem label="Update" onClick={handleUpdate} />
                  <PopoverItem label="Remove" onClick={handleRemove} />
                </>
              ) : (
                <>
                  <PopoverItem label="Save for any cluster" onClick={handleAddForAnyCluster} />
                  <PopoverItem
                    label="Save for this cluster"
                    onClick={handleAddForThisCluster}
                  />
                </>
              )}
            </FavTogglePopover>
          )}
        </span>
      ),
      active: isFavorited,
      onClick: handleClick,
      title: isFavorited ? 'Update or remove favorite' : 'Save as favorite',
    };
  }, [
    isFavorited,
    popoverOpen,
    handleClick,
    handleClose,
    handleUpdate,
    handleRemove,
    handleAddForAnyCluster,
    handleAddForThisCluster,
  ]);

  return item;
}
