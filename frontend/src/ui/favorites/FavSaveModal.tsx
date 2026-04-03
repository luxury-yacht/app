/**
 * frontend/src/ui/favorites/FavSaveModal.tsx
 *
 * Modal for saving, updating, or deleting a favorite.
 * All fields are editable: name, cluster type, cluster, scope, view,
 * namespace, and filter settings.
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useShortcut, useKeyboardContext } from '@ui/shortcuts';
import { useModalFocusTrap } from '@shared/components/modals/useModalFocusTrap';
import { KeyboardContextPriority, KeyboardScopePriority } from '@ui/shortcuts/priorities';
import { CloseIcon } from '@shared/components/icons/MenuIcons';
import { Dropdown } from '@shared/components/dropdowns/Dropdown';
import ConfirmationModal from '@shared/components/modals/ConfirmationModal';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useNamespace } from '@modules/namespace/contexts/NamespaceContext';
import type { Favorite, FavoriteFilters, FavoriteTableState } from '@/core/persistence/favorites';
import '@ui/modals/modals.css';
import '@shared/components/KubeconfigSelector.css';
import './FavSaveModal.css';

// ---------------------------------------------------------------------------
// View lists — mirrors the Sidebar navigation tabs.
// ---------------------------------------------------------------------------

const CLUSTER_VIEWS = [
  { value: 'browse', label: 'Browse' },
  { value: 'nodes', label: 'Nodes' },
  { value: 'config', label: 'Config' },
  { value: 'crds', label: 'CRDs' },
  { value: 'custom', label: 'Custom' },
  { value: 'events', label: 'Events' },
  { value: 'rbac', label: 'RBAC' },
  { value: 'storage', label: 'Storage' },
];

const NAMESPACE_VIEWS = [
  { value: 'browse', label: 'Browse' },
  { value: 'workloads', label: 'Workloads' },
  { value: 'pods', label: 'Pods' },
  { value: 'autoscaling', label: 'Autoscaling' },
  { value: 'config', label: 'Config' },
  { value: 'custom', label: 'Custom' },
  { value: 'events', label: 'Events' },
  { value: 'helm', label: 'Helm' },
  { value: 'network', label: 'Network' },
  { value: 'quotas', label: 'Quotas' },
  { value: 'rbac', label: 'RBAC' },
  { value: 'storage', label: 'Storage' },
];

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
  /** Current cluster context name. */
  clusterName: string;
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
  /** Called to save (add or update) the favorite. */
  onSave: (fav: Favorite) => void;
  /** Called to delete the favorite (only when editing an existing one). */
  onDelete: (id: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve view tab id from a view label (e.g. "Pods" -> "pods"). */
const resolveViewId = (label: string, viewType: string): string => {
  const views = viewType === 'namespace' ? NAMESPACE_VIEWS : CLUSTER_VIEWS;
  // Try exact label match first.
  const match = views.find((v) => v.label === label);
  if (match) return match.value;
  // Fall back to lowercase comparison.
  const lower = label.toLowerCase();
  const fallback = views.find((v) => v.value === lower || v.label.toLowerCase() === lower);
  return fallback?.value ?? views[0].value;
};

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
  clusterName,
  kubeconfigSelection,
  viewType,
  viewLabel,
  namespace,
  filters,
  tableState,
  includeMetadata,
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
  const [scope, setScope] = useState<'cluster' | 'namespace'>('cluster');
  const [clusterView, setClusterView] = useState('browse');
  const [namespaceView, setNamespaceView] = useState('browse');
  const [selectedNamespace, setSelectedNamespace] = useState('');
  const [filterText, setFilterText] = useState('');
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
      setScope(existingFavorite.viewType as 'cluster' | 'namespace');
      if (existingFavorite.viewType === 'cluster') {
        setClusterView(existingFavorite.view);
      } else {
        setNamespaceView(existingFavorite.view);
      }
      setSelectedNamespace(existingFavorite.namespace || '');
      setFilterText(existingFavorite.filters?.search ?? '');
      setCaseSensitive(existingFavorite.filters?.caseSensitive ?? false);
      setIncludeMetadataState(existingFavorite.filters?.includeMetadata ?? false);
    } else {
      setName(defaultName);
      setClusterSpecific(true);
      setClusterSelection(kubeconfigSelection);
      setScope(viewType as 'cluster' | 'namespace');
      const resolvedView = resolveViewId(viewLabel, viewType);
      if (viewType === 'cluster') {
        setClusterView(resolvedView);
      } else {
        setNamespaceView(resolvedView);
      }
      setSelectedNamespace(namespace);
      setFilterText(filters.search);
      setCaseSensitive(filters.caseSensitive);
      setIncludeMetadataState(includeMetadata);
    }
    setShowDeleteConfirm(false);
  }, [isOpen, existingFavorite, defaultName, kubeconfigSelection, viewType, viewLabel, namespace, filters, includeMetadata]);

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
    focusableSelector: '[data-fav-modal-focusable="true"]',
    priority: KeyboardScopePriority.SETTINGS_MODAL,
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
    const opts = [{ value: 'All Namespaces', label: 'All Namespaces' }];
    namespaces.forEach((ns) => {
      // Skip the synthetic "All Namespaces" item already added above.
      if (ns.isSynthetic) return;
      opts.push({ value: ns.scope || ns.name, label: ns.name });
    });
    return opts;
  }, [namespaces]);

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

  const handleScopeChange = (newScope: 'cluster' | 'namespace') => {
    setScope(newScope);
  };

  // The active view depends on the selected scope.
  const activeView = scope === 'cluster' ? clusterView : namespaceView;

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
        kinds: existingFavorite?.filters?.kinds ?? filters.kinds ?? [],
        namespaces: existingFavorite?.filters?.namespaces ?? filters.namespaces ?? [],
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

  return createPortal(
    <>
      <div className="modal-overlay" onClick={onClose}>
        <div
          className="modal-container fav-save-modal"
          onClick={(e) => e.stopPropagation()}
          ref={modalRef}
        >
          <div className="modal-header">
            <h2>{isEditing ? 'Edit Favorite' : 'Save Favorite'}</h2>
            <button
              className="modal-close"
              onClick={onClose}
              aria-label="Close"
              data-fav-modal-focusable="true"
            >
              <CloseIcon />
            </button>
          </div>

          <div className="modal-content">
            {/* Name */}
            <div className="fav-save-field">
              <label className="fav-save-label" htmlFor="fav-name">Name</label>
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

            {/* Type (cluster binding) */}
            <div className="fav-save-field">
              <span className="fav-save-label">Type</span>
              <div className="fav-save-radios">
                <label className="fav-save-radio">
                  <input
                    type="radio"
                    name="cluster-type"
                    checked={!clusterSpecific}
                    onChange={() => handleTypeChange(false)}
                    data-fav-modal-focusable="true"
                  />
                  <span>Any Cluster</span>
                </label>
                <label className="fav-save-radio">
                  <input
                    type="radio"
                    name="cluster-type"
                    checked={clusterSpecific}
                    onChange={() => handleTypeChange(true)}
                    data-fav-modal-focusable="true"
                  />
                  <span>Cluster-specific</span>
                </label>
                <Dropdown
                  options={clusterOptions}
                  value={clusterSelection}
                  onChange={(val) => setClusterSelection(val as string)}
                  placeholder="Select cluster..."
                  disabled={!clusterSpecific}
                  renderValue={(val) => {
                    const match = clusterOptions.find((o) => o.value === val);
                    return match?.metadata?.context ?? val;
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

            {/* Scope */}
            <div className="fav-save-field">
              <span className="fav-save-label">Scope</span>
              <div className="fav-save-radios">
                <label className="fav-save-radio">
                  <input
                    type="radio"
                    name="scope"
                    checked={scope === 'cluster'}
                    onChange={() => handleScopeChange('cluster')}
                    data-fav-modal-focusable="true"
                  />
                  <span>Cluster</span>
                </label>
                <Dropdown
                  options={CLUSTER_VIEWS}
                  value={clusterView}
                  onChange={(val) => setClusterView(val as string)}
                  placeholder="Select view..."
                  disabled={scope !== 'cluster'}
                />
                <label className="fav-save-radio">
                  <input
                    type="radio"
                    name="scope"
                    checked={scope === 'namespace'}
                    onChange={() => handleScopeChange('namespace')}
                    data-fav-modal-focusable="true"
                  />
                  <span>Namespaced</span>
                </label>
                <Dropdown
                  options={NAMESPACE_VIEWS}
                  value={namespaceView}
                  onChange={(val) => setNamespaceView(val as string)}
                  placeholder="Select view..."
                  disabled={scope !== 'namespace'}
                />
                <Dropdown
                  options={namespaceOptions}
                  value={selectedNamespace}
                  onChange={(val) => setSelectedNamespace(val as string)}
                  placeholder="Select namespace..."
                  disabled={scope !== 'namespace'}
                />
              </div>
            </div>

            {/* Filters */}
            <div className="fav-save-field">
              <span className="fav-save-label">Filters</span>
              <div className="fav-save-filters">
                <div className="fav-save-filter-row">
                  <label className="fav-save-filter-label" htmlFor="fav-filter-text">
                    Filter Text
                  </label>
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
                <div className="fav-save-filter-row">
                  <label className="fav-save-filter-checkbox">
                    <input
                      type="checkbox"
                      checked={caseSensitive}
                      onChange={(e) => setCaseSensitive(e.target.checked)}
                      className="fav-save-checkbox"
                      data-fav-modal-focusable="true"
                    />
                    <span>Case-Sensitive</span>
                  </label>
                </div>
                <div className="fav-save-filter-row">
                  <label className="fav-save-filter-checkbox">
                    <input
                      type="checkbox"
                      checked={includeMetadataState}
                      onChange={(e) => setIncludeMetadataState(e.target.checked)}
                      className="fav-save-checkbox"
                      data-fav-modal-focusable="true"
                    />
                    <span>Include Metadata</span>
                  </label>
                </div>
              </div>
            </div>
          </div>

          <div className="modal-footer">
            {isEditing && (
              <button
                className="modal-btn modal-btn-danger"
                onClick={handleDelete}
                data-fav-modal-focusable="true"
              >
                Delete
              </button>
            )}
            <div className="fav-save-footer-spacer" />
            <button
              className="modal-btn modal-btn-secondary"
              onClick={onClose}
              data-fav-modal-focusable="true"
            >
              Cancel
            </button>
            <button
              className="modal-btn modal-btn-primary"
              onClick={handleSave}
              disabled={isEditing && !changesDetected}
              data-fav-modal-focusable="true"
            >
              Save
            </button>
          </div>
        </div>
      </div>

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
    </>,
    document.body
  );
};

export default FavSaveModal;
