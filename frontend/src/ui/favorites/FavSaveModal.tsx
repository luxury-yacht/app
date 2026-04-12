/**
 * frontend/src/ui/favorites/FavSaveModal.tsx
 *
 * Modal for saving, updating, or deleting a favorite.
 * All fields are editable: name, cluster type, cluster, scope, view,
 * namespace, and filter settings.
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useShortcut, useKeyboardContext } from '@ui/shortcuts';
import { useModalFocusTrap } from '@shared/components/modals/useModalFocusTrap';
import { KeyboardContextPriority } from '@ui/shortcuts/priorities';
import { CloseIcon } from '@shared/components/icons/MenuIcons';
import { Dropdown } from '@shared/components/dropdowns/Dropdown';
import Tooltip from '@shared/components/Tooltip';
import ConfirmationModal from '@shared/components/modals/ConfirmationModal';
import ModalSurface from '@shared/components/modals/ModalSurface';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useNamespace } from '@modules/namespace/contexts/NamespaceContext';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import type { Favorite, FavoriteFilters, FavoriteTableState } from '@/core/persistence/favorites';
import '@ui/modals/modals.css';
import '@ui/settings/Settings.css';
import '@shared/components/KubeconfigSelector.css';
import './FavSaveModal.css';

// ---------------------------------------------------------------------------
// View lists — mirrors the Sidebar navigation tabs.
// ---------------------------------------------------------------------------

// Combined view list with scope prefix to avoid value collisions.
// The value format is "scope:view" (e.g. "cluster:nodes", "namespace:pods").
const ALL_VIEWS = [
  { value: '__cluster_header__', label: 'Cluster', group: 'header' as const },
  { value: 'cluster:browse', label: 'Browse' },
  { value: 'cluster:nodes', label: 'Nodes' },
  { value: 'cluster:config', label: 'Config' },
  { value: 'cluster:crds', label: 'CRDs' },
  { value: 'cluster:custom', label: 'Custom' },
  { value: 'cluster:events', label: 'Events' },
  { value: 'cluster:rbac', label: 'RBAC' },
  { value: 'cluster:storage', label: 'Storage' },
  { value: '__namespace_header__', label: 'Namespaced', group: 'header' as const },
  { value: 'namespace:browse', label: 'Browse' },
  { value: 'namespace:workloads', label: 'Workloads' },
  { value: 'namespace:pods', label: 'Pods' },
  { value: 'namespace:autoscaling', label: 'Autoscaling' },
  { value: 'namespace:config', label: 'Config' },
  { value: 'namespace:custom', label: 'Custom' },
  { value: 'namespace:events', label: 'Events' },
  { value: 'namespace:helm', label: 'Helm' },
  { value: 'namespace:network', label: 'Network' },
  { value: 'namespace:quotas', label: 'Quotas' },
  { value: 'namespace:rbac', label: 'RBAC' },
  { value: 'namespace:storage', label: 'Storage' },
];

/** Parse a combined view value into scope and view. */
const parseViewValue = (combined: string): { scope: 'cluster' | 'namespace'; view: string } => {
  const [scope, view] = combined.split(':');
  return { scope: scope as 'cluster' | 'namespace', view };
};

/** Build a combined view value from scope and view. */
const buildViewValue = (scope: string, view: string): string => `${scope}:${view}`;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface FavSaveModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** The existing favorite being edited, or null when creating a new one. */
  existingFavorite: Favorite | null;
  /** Auto-generated default name for a new favorite. */
  defaultName: string;
  /** Current kubeconfig selection string (used as clusterSelection for cluster-specific). */
  kubeconfigSelection: string;
  /** "cluster" or "namespace". */
  viewType: string;
  /** The active view tab label (e.g. "Pods", "Nodes"). */
  viewLabel: string;
  /** Current namespace (empty for cluster views). */
  namespace: string;
  /** Snapshot of current filter state. */
  filters: FavoriteFilters;
  /** Snapshot of current table state. */
  tableState: FavoriteTableState;
  /** Whether the include-metadata toggle is active. */
  includeMetadata: boolean;
  /** Available kind values for the kind filter dropdown. */
  availableKinds?: string[];
  /** Available namespace values for the namespace filter dropdown. */
  availableFilterNamespaces?: string[];
  /** Called to save (add or update) the favorite. */
  onSave: (fav: Favorite) => void;
  /** Called to delete the favorite (only when editing an existing one). */
  onDelete: (id: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve view tab id from a view label (e.g. "Pods" -> "pods"). */
/** Resolve a view label (e.g. "Pods") to a view ID (e.g. "pods") for the given scope. */
const resolveViewId = (label: string, viewType: string): string => {
  const prefix = viewType + ':';
  const scopedViews = ALL_VIEWS.filter((v) => v.value.startsWith(prefix));
  const lower = label.toLowerCase();
  const match = scopedViews.find(
    (v) => v.label === label || v.label.toLowerCase() === lower || v.value === prefix + lower
  );
  // Return just the view part (without prefix) since buildViewValue adds it back.
  return match ? match.value.split(':')[1] : lower;
};

/** Compare current form state against an existing favorite to detect changes. */
const arraysEqual = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/** Compare current form state against an existing favorite to detect changes. */
const hasFormChanges = (
  existing: Favorite,
  name: string,
  clusterSpecific: boolean,
  clusterSelection: string,
  scope: 'cluster' | 'namespace',
  view: string,
  namespace: string,
  filterText: string,
  filterKinds: string[],
  filterNamespaces: string[],
  caseSensitive: boolean,
  includeMetadata: boolean
): boolean => {
  if (name !== existing.name) return true;
  const existingIsClusterSpecific = existing.clusterSelection !== '';
  if (clusterSpecific !== existingIsClusterSpecific) return true;
  if (clusterSpecific && clusterSelection !== existing.clusterSelection) return true;
  if (scope !== existing.viewType) return true;
  if (view !== existing.view) return true;
  if (scope === 'namespace' && namespace !== existing.namespace) return true;
  if (existing.filters) {
    if (filterText !== (existing.filters.search ?? '')) return true;
    if (!arraysEqual(filterKinds, existing.filters.kinds ?? [])) return true;
    if (!arraysEqual(filterNamespaces, existing.filters.namespaces ?? [])) return true;
    if (caseSensitive !== (existing.filters.caseSensitive ?? false)) return true;
    if (includeMetadata !== (existing.filters.includeMetadata ?? false)) return true;
  }
  return false;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const FavSaveModal: React.FC<FavSaveModalProps> = ({
  isOpen,
  onClose,
  existingFavorite,
  defaultName,
  kubeconfigSelection,
  viewType,
  viewLabel,
  namespace,
  filters,
  tableState,
  includeMetadata,
  availableKinds,
  availableFilterNamespaces,
  onSave,
  onDelete,
}) => {
  const isEditing = existingFavorite != null;
  const { kubeconfigs } = useKubeconfig();
  const { namespaces } = useNamespace();
  const { pushContext, popContext } = useKeyboardContext();
  const contextPushedRef = useRef(false);
  const modalRef = useRef<HTMLDivElement>(null);

  // ----- Form state -----
  const [name, setName] = useState('');
  const [clusterSpecific, setClusterSpecific] = useState(true);
  const [clusterSelection, setClusterSelection] = useState('');
  // Combined "scope:view" value (e.g. "cluster:nodes", "namespace:pods").
  const [selectedView, setSelectedView] = useState('cluster:browse');
  const [selectedNamespace, setSelectedNamespace] = useState(ALL_NAMESPACES_SCOPE);
  const [filterText, setFilterText] = useState('');
  const [filterKinds, setFilterKinds] = useState<string[]>([]);
  const [filterNamespaces, setFilterNamespaces] = useState<string[]>([]);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [includeMetadataState, setIncludeMetadataState] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // ----- Initialize form when modal opens -----
  useEffect(() => {
    if (!isOpen) return;
    if (existingFavorite) {
      setName(existingFavorite.name);
      setClusterSpecific(existingFavorite.clusterSelection !== '');
      setClusterSelection(existingFavorite.clusterSelection || kubeconfigSelection);
      setSelectedView(buildViewValue(existingFavorite.viewType, existingFavorite.view));
      setSelectedNamespace(existingFavorite.namespace || ALL_NAMESPACES_SCOPE);
      setFilterText(existingFavorite.filters?.search ?? '');
      setFilterKinds(existingFavorite.filters?.kinds ?? []);
      setFilterNamespaces(existingFavorite.filters?.namespaces ?? []);
      setCaseSensitive(existingFavorite.filters?.caseSensitive ?? false);
      setIncludeMetadataState(existingFavorite.filters?.includeMetadata ?? false);
    } else {
      setName(defaultName);
      setClusterSpecific(true);
      setClusterSelection(kubeconfigSelection);
      setSelectedView(buildViewValue(viewType, resolveViewId(viewLabel, viewType)));
      setSelectedNamespace(namespace || ALL_NAMESPACES_SCOPE);
      setFilterText(filters.search);
      setFilterKinds(filters.kinds ?? []);
      setFilterNamespaces(filters.namespaces ?? []);
      setCaseSensitive(filters.caseSensitive);
      setIncludeMetadataState(includeMetadata);
    }
    setShowDeleteConfirm(false);
  }, [
    isOpen,
    existingFavorite,
    defaultName,
    kubeconfigSelection,
    viewType,
    viewLabel,
    namespace,
    filters,
    includeMetadata,
  ]);

  // ----- Keyboard context management -----
  useEffect(() => {
    if (!isOpen) {
      if (contextPushedRef.current) {
        popContext();
        contextPushedRef.current = false;
      }
      return;
    }
    pushContext({ priority: KeyboardContextPriority.SETTINGS_MODAL });
    contextPushedRef.current = true;
    return () => {
      if (contextPushedRef.current) {
        popContext();
        contextPushedRef.current = false;
      }
    };
  }, [isOpen, popContext, pushContext]);

  useShortcut({
    key: 'Escape',
    handler: () => {
      if (!isOpen) return false;
      onClose();
      return true;
    },
    description: 'Close favorite modal',
    category: 'Modals',
    enabled: isOpen && !showDeleteConfirm,
    view: 'global',
    priority: KeyboardContextPriority.SETTINGS_MODAL,
  });

  useModalFocusTrap({
    ref: modalRef,
    disabled: !isOpen || showDeleteConfirm,
  });

  // ----- Dropdown options -----

  // Cluster dropdown: all available kubeconfigs, formatted like KubeconfigSelector.
  const clusterOptions = useMemo(() => {
    const seen = new Set<string>();
    return kubeconfigs.map((kc) => {
      const isFirstForFile = !seen.has(kc.name);
      if (isFirstForFile) seen.add(kc.name);
      return {
        value: `${kc.path}:${kc.context}`,
        label: `${kc.name} [${kc.context}]`,
        metadata: {
          isFirstForFile,
          filename: kc.name,
          context: kc.context,
          isCurrentContext: kc.isCurrentContext,
        },
      };
    });
  }, [kubeconfigs]);

  // View dropdown: depends on scope.
  // Namespace dropdown: "All Namespaces" at top, then actual namespaces.
  const namespaceOptions = useMemo(() => {
    const opts = [{ value: ALL_NAMESPACES_SCOPE, label: 'All Namespaces' }];
    namespaces.forEach((ns) => {
      // Skip the synthetic "All Namespaces" item already added above.
      if (ns.isSynthetic) return;
      opts.push({ value: ns.scope || ns.name, label: ns.name });
    });
    return opts;
  }, [namespaces]);

  // Kind filter dropdown: merge available kinds with any saved kinds not in the list.
  const kindDropdownOptions = useMemo(() => {
    const all = new Set(availableKinds ?? []);
    filterKinds.forEach((k) => all.add(k));
    return Array.from(all)
      .sort()
      .map((k) => ({ value: k, label: k }));
  }, [availableKinds, filterKinds]);

  // Namespace filter dropdown: merge available filter namespaces with saved ones.
  const nsFilterDropdownOptions = useMemo(() => {
    const all = new Set(availableFilterNamespaces ?? []);
    filterNamespaces.forEach((ns) => all.add(ns));
    return Array.from(all)
      .sort()
      .map((ns) => ({ value: ns, label: ns }));
  }, [availableFilterNamespaces, filterNamespaces]);

  // ----- Derived state -----

  // When Type changes to "Any Cluster", clear cluster selection.
  const handleTypeChange = (isClusterSpecific: boolean) => {
    setClusterSpecific(isClusterSpecific);
    if (!isClusterSpecific) {
      setClusterSelection('');
    } else if (!clusterSelection) {
      // Restore the current kubeconfig selection when switching back.
      setClusterSelection(kubeconfigSelection);
    }
  };

  // Derive scope and view from the combined selectedView value.
  const { scope, view: activeView } = parseViewValue(selectedView);
  const isNamespaceScope = scope === 'namespace';

  // Detect whether Save should be enabled when editing.
  const changesDetected = isEditing
    ? hasFormChanges(
        existingFavorite!,
        name.trim() || defaultName,
        clusterSpecific,
        clusterSelection,
        scope,
        activeView,
        selectedNamespace,
        filterText,
        filterKinds,
        filterNamespaces,
        caseSensitive,
        includeMetadataState
      )
    : true;

  // ----- Handlers -----

  const handleSave = () => {
    const fav: Favorite = {
      id: existingFavorite?.id ?? '',
      name: name.trim() || defaultName,
      clusterSelection: clusterSpecific ? clusterSelection : '',
      viewType: scope,
      view: activeView,
      namespace: scope === 'namespace' ? selectedNamespace : '',
      filters: {
        search: filterText,
        kinds: filterKinds,
        namespaces: filterNamespaces,
        caseSensitive,
        includeMetadata: includeMetadataState,
      },
      tableState: existingFavorite?.tableState ?? tableState,
      order: existingFavorite?.order ?? 0,
    };
    onSave(fav);
    onClose();
  };

  const handleDelete = () => {
    setShowDeleteConfirm(true);
  };

  const confirmDelete = () => {
    if (existingFavorite) {
      onDelete(existingFavorite.id);
    }
    setShowDeleteConfirm(false);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <>
      <ModalSurface
        modalRef={modalRef}
        labelledBy="fav-save-modal-title"
        onClose={onClose}
        containerClassName="fav-save-modal"
      >
        <div className="modal-header">
          <h2 id="fav-save-modal-title">{isEditing ? 'Edit Favorite' : 'Save Favorite'}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>

        <div className="modal-content">
          {/* Name */}
          <div className="settings-section">
            <h3>Name</h3>
            <div className="settings-items">
              <div className="setting-item">
                <input
                  id="fav-name"
                  type="text"
                  className="fav-save-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
                      e.preventDefault();
                      (e.target as HTMLInputElement).select();
                    }
                  }}
                  autoFocus
                  data-fav-modal-focusable="true"
                />
              </div>
            </div>
          </div>

          {/* Type (cluster binding) */}
          <div className="settings-section">
            <h3>Scope</h3>
            <div className="settings-items">
              <div className="setting-item fav-inline-row">
                <label>
                  <input
                    type="radio"
                    name="cluster-type"
                    checked={!clusterSpecific}
                    onChange={() => handleTypeChange(false)}
                    data-fav-modal-focusable="true"
                  />
                  Any
                  <Tooltip content="Can be used in any cluster. Attempts to open this view in the current active cluster." />
                </label>
              </div>
              <div className="setting-item fav-inline-row">
                <label>
                  <input
                    type="radio"
                    name="cluster-type"
                    checked={clusterSpecific}
                    onChange={() => handleTypeChange(true)}
                    data-fav-modal-focusable="true"
                  />
                  Cluster
                  <Tooltip content="Opens the saved view in a specific cluster, and will activate that cluster if needed." />
                </label>
                <Dropdown
                  options={clusterOptions}
                  value={clusterSelection}
                  onChange={(val) => setClusterSelection(val as string)}
                  placeholder="Select cluster..."
                  disabled={!clusterSpecific}
                  renderValue={(val) => {
                    if (!clusterSpecific) return 'Select cluster...';
                    const match = clusterOptions.find((o) => o.value === val);
                    return match?.metadata?.context ?? val ?? 'Select cluster...';
                  }}
                  renderOption={(option) => (
                    <div
                      className={`kubeconfig-option${!option.metadata?.isFirstForFile ? ' no-filename' : ''}${option.metadata?.isCurrentContext ? ' current-context' : ''}`}
                    >
                      {option.metadata?.isFirstForFile && (
                        <div className="kubeconfig-filename">{option.metadata.filename}</div>
                      )}
                      <div className="kubeconfig-context">
                        <span className="kubeconfig-context-label">{option.metadata?.context}</span>
                      </div>
                    </div>
                  )}
                />
              </div>
            </div>
          </div>

          {/* View */}
          <div className="settings-section">
            <h3>View</h3>
            <div className="settings-items">
              <div className="setting-item fav-inline-row">
                <label>View</label>
                <Dropdown
                  options={ALL_VIEWS}
                  value={selectedView}
                  onChange={(val) => setSelectedView(val as string)}
                  placeholder="Select view..."
                />
              </div>
              {isNamespaceScope && (
                <div className="setting-item fav-inline-row">
                  <label>Namespace</label>
                  <Dropdown
                    options={namespaceOptions}
                    value={selectedNamespace}
                    onChange={(val) => setSelectedNamespace(val as string)}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Filters */}
          <div className="settings-section">
            <h3>Filters</h3>
            <div className="settings-items">
              {kindDropdownOptions.length > 0 && (
                <div className="setting-item fav-inline-row">
                  <label>Kinds</label>
                  <Dropdown
                    options={kindDropdownOptions}
                    value={filterKinds}
                    onChange={(val) => setFilterKinds(Array.isArray(val) ? val : val ? [val] : [])}
                    placeholder="All kinds"
                    multiple
                    renderValue={(val) => {
                      const count = Array.isArray(val) ? val.length : val ? 1 : 0;
                      if (count === 0) return 'All kinds';
                      if (count === 1) return Array.isArray(val) ? val[0] : val;
                      return `${count} selected`;
                    }}
                  />
                </div>
              )}
              {nsFilterDropdownOptions.length > 0 && (
                <div className="setting-item fav-inline-row">
                  <label>Namespaces</label>
                  <Dropdown
                    options={nsFilterDropdownOptions}
                    value={filterNamespaces}
                    onChange={(val) =>
                      setFilterNamespaces(Array.isArray(val) ? val : val ? [val] : [])
                    }
                    placeholder="All namespaces"
                    multiple
                    renderValue={(val) => {
                      const count = Array.isArray(val) ? val.length : val ? 1 : 0;
                      if (count === 0) return 'All namespaces';
                      if (count === 1) return Array.isArray(val) ? val[0] : val;
                      return `${count} selected`;
                    }}
                  />
                </div>
              )}
              <div className="setting-item fav-inline-row">
                <label htmlFor="fav-filter-text">Filter Text</label>
                <input
                  id="fav-filter-text"
                  type="text"
                  className="fav-save-input"
                  value={filterText}
                  onChange={(e) => setFilterText(e.target.value)}
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
                      e.preventDefault();
                      (e.target as HTMLInputElement).select();
                    }
                  }}
                  data-fav-modal-focusable="true"
                />
              </div>
              <div className="setting-item">
                <label>
                  <input
                    type="checkbox"
                    checked={caseSensitive}
                    onChange={(e) => setCaseSensitive(e.target.checked)}
                    data-fav-modal-focusable="true"
                  />
                  Match case
                </label>
              </div>
              <div className="setting-item">
                <label>
                  <input
                    type="checkbox"
                    checked={includeMetadataState}
                    onChange={(e) => setIncludeMetadataState(e.target.checked)}
                    data-fav-modal-focusable="true"
                  />
                  Include metadata
                </label>
              </div>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          {isEditing && (
            <button className="button danger" onClick={handleDelete}>
              Delete
            </button>
          )}
          <div className="fav-save-footer-spacer" />
          <button className="button cancel" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button save"
            onClick={handleSave}
            disabled={isEditing && !changesDetected}
          >
            Save
          </button>
        </div>
      </ModalSurface>

      <ConfirmationModal
        isOpen={showDeleteConfirm}
        title="Delete Favorite"
        message={`Delete "${name}"? This cannot be undone.`}
        confirmText="Delete"
        cancelText="Cancel"
        confirmButtonClass="danger"
        onConfirm={confirmDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </>
  );
};

export default FavSaveModal;
