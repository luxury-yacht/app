/**
 * frontend/src/ui/favorites/FavSaveModal.tsx
 *
 * Modal for saving, updating, or deleting a favorite.
 * All fields are editable: name, cluster type, cluster, scope, view,
 * namespace, and filter settings.
 */

import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import { useNamespace } from '@modules/namespace/contexts/NamespaceContext';
import { Dropdown, type DropdownOption } from '@shared/components/dropdowns/Dropdown';
import {
  ALL_MULTISELECT_FILTER,
  filterSelectionFromDropdownValues,
  filterSelectionToDropdownValues,
  filterSelectionValues,
  type MultiSelectFilterSelection,
} from '@shared/components/dropdowns/multiSelectFilterSelection';
import { FavoriteGenericIcon } from '@shared/components/icons/FavoriteIcons';
import ConfirmationModal from '@shared/components/modals/ConfirmationModal';
import ModalHeader from '@shared/components/modals/ModalHeader';
import ModalSurface from '@shared/components/modals/ModalSurface';
import { useModalFocusTrap } from '@shared/components/modals/useModalFocusTrap';
import Tooltip from '@shared/components/Tooltip';
import type { GridTableFilterOptions } from '@shared/components/tables/GridTable.types';
import { areGridTableFilterStatesEqual } from '@shared/components/tables/gridTableFilterState';
import type React from 'react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { type FavoriteRouteScope, resolveFavoriteRoute } from '@/core/navigation/favoriteRoute';
import {
  CLUSTER_VIEW_DESCRIPTORS,
  GLOBAL_VIEW_DESCRIPTORS,
  NAMESPACE_VIEW_DESCRIPTORS,
} from '@/core/navigation/viewRegistry';
import type {
  Favorite,
  FavoriteFilters,
  FavoritePaneState,
  FavoriteTableState,
} from '@/core/persistence/favorites';
import '@shared/components/KubeconfigSelector.css';
import './FavSaveModal.css';

// ---------------------------------------------------------------------------
// View list derived from the same registry as shell navigation.
// ---------------------------------------------------------------------------

// Combined view list with scope prefix to avoid value collisions.
// The value format is "scope:view" (e.g. "cluster:nodes", "namespace:pods").
const ALL_VIEWS = [
  { value: '__global_header__', label: 'Global', group: 'header' as const },
  ...GLOBAL_VIEW_DESCRIPTORS.map(({ id, label }) => ({
    value: `global:${id}`,
    label,
  })),
  { value: '__cluster_header__', label: 'Cluster', group: 'header' as const },
  ...CLUSTER_VIEW_DESCRIPTORS.map(({ scope, id, label }) => ({
    value: `${scope}:${id}`,
    label,
  })),
  { value: '__namespace_header__', label: 'Namespaced', group: 'header' as const },
  ...NAMESPACE_VIEW_DESCRIPTORS.map(({ scope, id, label }) => ({
    value: `${scope}:${id}`,
    label,
  })),
];

/** Parse a combined view value into scope and view. */
const parseViewValue = (combined: string): { scope: FavoriteRouteScope; view: string } => {
  const [scope, view] = combined.split(':');
  return { scope: scope as FavoriteRouteScope, view };
};

/** Build a combined view value from scope and view. */
const buildViewValue = (scope: string, view: string): string => `${scope}:${view}`;

const mergeSavedOptions = (
  options: DropdownOption[],
  selection: MultiSelectFilterSelection
): DropdownOption[] => {
  const values = new Set(options.map((option) => option.value));
  return [
    ...options,
    ...filterSelectionValues(selection)
      .filter((value) => !values.has(value))
      .map((value) => ({ value, label: value })),
  ];
};

const semanticSelectionDisplayValue = (
  selection: MultiSelectFilterSelection
): string | undefined => {
  if (selection.mode === 'all') {
    return 'All';
  }
  if (selection.mode === 'none') {
    return 'None';
  }
  return `${selection.values.length} selected`;
};

interface FavoritePaneFiltersProps {
  elementIdPrefix: string;
  pane: FavoriteModalPane;
  state: FavoritePaneState;
  showPaneLabel: boolean;
  onChange: (filters: FavoriteFilters) => void;
}

const FavoritePaneFilters: React.FC<FavoritePaneFiltersProps> = ({
  elementIdPrefix,
  pane,
  state,
  showPaneLabel,
  onChange,
}) => {
  const definitions = [
    ...(pane.filterOptions.showKindDropdown
      ? [
          {
            key: 'kinds',
            label: 'Kinds',
            placeholder: 'All kinds',
            options: (pane.filterOptions.kinds ?? []).map((value) => ({ value, label: value })),
            searchable: true,
          },
        ]
      : []),
    ...(pane.filterOptions.showNamespaceDropdown
      ? [
          {
            key: 'namespaces',
            label: 'Namespaces',
            placeholder: 'All namespaces',
            options: (pane.filterOptions.namespaces ?? []).map((value) => ({
              value,
              label: value,
            })),
            searchable: pane.filterOptions.namespaceDropdownSearchable,
          },
        ]
      : []),
    ...(pane.filterOptions.showClusterDropdown
      ? [
          {
            key: 'clusters',
            label: 'Clusters',
            placeholder: 'All clusters',
            options: pane.filterOptions.clusters ?? [],
            searchable: pane.filterOptions.clusterDropdownSearchable,
          },
        ]
      : []),
    ...(pane.filterOptions.queryFacets ?? []).map((facet) => ({
      key: `query:${facet.key}`,
      label: facet.label,
      placeholder: facet.placeholder,
      options: facet.options,
      searchable: facet.searchable,
    })),
  ];

  return (
    <div className="modal-form-section">
      <h3>{showPaneLabel ? `${pane.label} Filters` : 'Filters'}</h3>
      <div className="modal-form-items">
        {definitions.map((definition) => {
          const queryKey = definition.key.startsWith('query:')
            ? definition.key.slice('query:'.length)
            : null;
          const selection = queryKey
            ? (state.filters.queryFacets?.[queryKey] ?? ALL_MULTISELECT_FILTER)
            : state.filters[definition.key as 'kinds' | 'namespaces' | 'clusters'];
          const options = mergeSavedOptions(definition.options, selection);
          return (
            <div
              className="modal-form-field modal-form-field-inline fav-save-inline-row"
              key={definition.key}
            >
              <label htmlFor={`${elementIdPrefix}-${pane.id}-${definition.key}`}>
                {definition.label}
              </label>
              <Dropdown
                id={`${elementIdPrefix}-${pane.id}-${definition.key}`}
                dropdownClassName="fav-save-dropdown-menu"
                options={options}
                value={filterSelectionToDropdownValues(selection, options)}
                displayValue={semanticSelectionDisplayValue(selection)}
                onChange={(value) => {
                  const next = filterSelectionFromDropdownValues(
                    Array.isArray(value) ? value : value ? [value] : [],
                    options
                  );
                  if (queryKey) {
                    onChange({
                      ...state.filters,
                      queryFacets: { ...state.filters.queryFacets, [queryKey]: next },
                    });
                    return;
                  }
                  onChange({ ...state.filters, [definition.key]: next });
                }}
                placeholder={definition.placeholder}
                multiple
                searchable={definition.searchable}
                showBulkActions
              />
            </div>
          );
        })}
        <div className="modal-form-field modal-form-field-inline fav-save-inline-row">
          <label htmlFor={`${elementIdPrefix}-${pane.id}-filter-text`}>Filter Text</label>
          <input
            id={`${elementIdPrefix}-${pane.id}-filter-text`}
            type="text"
            className="modal-input"
            value={state.filters.search}
            onChange={(event) => onChange({ ...state.filters, search: event.target.value })}
          />
        </div>
        <div className="modal-form-field">
          <label className="modal-checkbox-label">
            <input
              type="checkbox"
              checked={state.filters.caseSensitive}
              onChange={(event) =>
                onChange({ ...state.filters, caseSensitive: event.target.checked })
              }
            />
            Match case
          </label>
        </div>
        <div className="modal-form-field">
          <label className="modal-checkbox-label">
            <input
              type="checkbox"
              checked={state.filters.includeMetadata}
              onChange={(event) =>
                onChange({ ...state.filters, includeMetadata: event.target.checked })
              }
            />
            Include metadata
          </label>
        </div>
      </div>
    </div>
  );
};

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
  /** Named table panes. Multi-table views supply every pane in route order. */
  panes?: FavoriteModalPane[];
  /** Called to save (add or update) the favorite. */
  onSave: (fav: Favorite) => void | Promise<void>;
  /** Called to delete the favorite (only when editing an existing one). */
  onDelete: (id: string) => void;
}

export interface FavoriteModalPane extends FavoritePaneState {
  id: string;
  label: string;
  filterOptions: GridTableFilterOptions;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve view tab id from a view label (e.g. "Pods" -> "pods"). */
/** Resolve a view label (e.g. "Pods") to a view ID (e.g. "pods") for the given scope. */
const resolveViewId = (label: string, viewType: string): string => {
  const prefix = `${viewType}:`;
  const scopedViews = ALL_VIEWS.filter((v) => v.value.startsWith(prefix));
  const lower = label.toLowerCase();
  const match = scopedViews.find(
    (v) => v.label === label || v.label.toLowerCase() === lower || v.value === prefix + lower
  );
  // Return just the view part (without prefix) since buildViewValue adds it back.
  return match ? match.value.split(':')[1] : lower;
};

/** Compare current form state against an existing favorite to detect changes. */
interface FavoriteFormState {
  name: string;
  clusterSpecific: boolean;
  clusterSelection: string;
  scope: FavoriteRouteScope;
  view: string;
  namespace: string;
  panes: Record<string, FavoritePaneState>;
}

const favoritePaneMapsEqual = (
  left: Record<string, FavoritePaneState>,
  right: Record<string, FavoritePaneState>
): boolean => {
  const keys = Object.keys(left).sort();
  if (JSON.stringify(keys) !== JSON.stringify(Object.keys(right).sort())) {
    return false;
  }
  return keys.every((key) => {
    const leftPane = left[key];
    const rightPane = right[key];
    return (
      Boolean(leftPane) &&
      Boolean(rightPane) &&
      areGridTableFilterStatesEqual(leftPane.filters, rightPane.filters) &&
      leftPane.tableState.sortColumn === rightPane.tableState.sortColumn &&
      leftPane.tableState.sortDirection === rightPane.tableState.sortDirection &&
      JSON.stringify(Object.entries(leftPane.tableState.columnVisibility).sort()) ===
        JSON.stringify(Object.entries(rightPane.tableState.columnVisibility).sort())
    );
  });
};

const hasFormChanges = (
  existing: Favorite,
  { name, clusterSpecific, clusterSelection, scope, view, namespace, panes }: FavoriteFormState
): boolean => {
  if (name !== existing.name) {
    return true;
  }
  const existingRoute = resolveFavoriteRoute(existing.viewType, existing.view);
  const existingIsClusterSpecific =
    existingRoute.scope !== 'global' && existing.clusterSelection !== '';
  if (clusterSpecific !== existingIsClusterSpecific) {
    return true;
  }
  if (clusterSpecific && clusterSelection !== existing.clusterSelection) {
    return true;
  }
  if (scope !== existing.viewType) {
    return true;
  }
  if (view !== existing.view) {
    return true;
  }
  if (scope === 'namespace' && namespace !== existing.namespace) {
    return true;
  }
  if (!favoritePaneMapsEqual(panes, existing.panes)) {
    return true;
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
  panes,
  onSave,
  onDelete,
}) => {
  const elementIdPrefix = useId();
  const isEditing = Boolean(existingFavorite);
  const { kubeconfigs, getClusterMeta } = useKubeconfig();
  const { namespaces } = useNamespace();
  const modalRef = useRef<HTMLDivElement>(null);
  // Live table snapshots may change while the modal is open; only reopening starts a new draft.
  const draftOpenRef = useRef(false);

  // ----- Form state -----
  const [name, setName] = useState('');
  const [clusterSpecific, setClusterSpecific] = useState(true);
  const [clusterSelection, setClusterSelection] = useState('');
  // Combined "scope:view" value (e.g. "cluster:nodes", "namespace:pods").
  const [selectedView, setSelectedView] = useState('cluster:browse');
  const [selectedNamespace, setSelectedNamespace] = useState(ALL_NAMESPACES_SCOPE);
  const [paneStates, setPaneStates] = useState<Record<string, FavoritePaneState>>({});
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  // ----- Initialize form when modal opens -----
  useEffect(() => {
    if (!isOpen) {
      draftOpenRef.current = false;
      return;
    }
    if (draftOpenRef.current) {
      return;
    }
    draftOpenRef.current = true;
    if (existingFavorite) {
      const existingRoute = resolveFavoriteRoute(existingFavorite.viewType, existingFavorite.view);
      setName(existingFavorite.name);
      setClusterSpecific(
        existingRoute.scope !== 'global' && existingFavorite.clusterSelection !== ''
      );
      setClusterSelection(existingFavorite.clusterSelection || kubeconfigSelection);
      setSelectedView(buildViewValue(existingRoute.scope, existingRoute.view));
      setSelectedNamespace(existingFavorite.namespace || ALL_NAMESPACES_SCOPE);
      setPaneStates(existingFavorite.panes);
    } else {
      const initialRoute = resolveFavoriteRoute(viewType, resolveViewId(viewLabel, viewType));
      setName(defaultName);
      setClusterSpecific(initialRoute.scope !== 'global');
      setClusterSelection(kubeconfigSelection);
      setSelectedView(buildViewValue(initialRoute.scope, initialRoute.view));
      setSelectedNamespace(namespace || ALL_NAMESPACES_SCOPE);
      const configuredPanes = panes ?? [
        {
          id: 'main',
          label: viewLabel,
          filters: { ...filters, includeMetadata },
          tableState,
          filterOptions: {
            kinds: availableKinds,
            namespaces: availableFilterNamespaces,
            showKindDropdown: Boolean(availableKinds?.length),
            showNamespaceDropdown: Boolean(availableFilterNamespaces?.length),
          },
        },
      ];
      setPaneStates(
        Object.fromEntries(
          configuredPanes.map((pane) => [
            pane.id,
            { filters: pane.filters, tableState: pane.tableState },
          ])
        )
      );
    }
    setShowDeleteConfirm(false);
    setSaving(false);
    setSaveError('');
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
    panes,
    tableState,
    availableKinds,
    availableFilterNamespaces,
  ]);

  useModalFocusTrap({
    ref: modalRef,
    disabled: !isOpen || showDeleteConfirm,
    onEscape: () => {
      if (!isOpen || showDeleteConfirm || saving) {
        return false;
      }
      onClose();
      return true;
    },
  });

  // ----- Dropdown options -----

  // Cluster dropdown: all available kubeconfigs, formatted like KubeconfigSelector.
  const clusterOptions = useMemo(() => {
    const seen = new Set<string>();
    return kubeconfigs.map((kc) => {
      const isFirstForFile = !seen.has(kc.name);
      if (isFirstForFile) {
        seen.add(kc.name);
      }
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
      if (ns.isSynthetic) {
        return;
      }
      opts.push({ value: ns.scope || ns.name, label: ns.name });
    });
    return opts;
  }, [namespaces]);

  const modalPanes = useMemo<FavoriteModalPane[]>(
    () =>
      panes ?? [
        {
          id: 'main',
          label: viewLabel,
          filters: { ...filters, includeMetadata },
          tableState,
          filterOptions: {
            kinds: availableKinds,
            namespaces: availableFilterNamespaces,
            showKindDropdown: Boolean(availableKinds?.length),
            showNamespaceDropdown: Boolean(availableFilterNamespaces?.length),
          },
        },
      ],
    [
      availableFilterNamespaces,
      availableKinds,
      filters,
      includeMetadata,
      panes,
      tableState,
      viewLabel,
    ]
  );

  const updatePaneFilters = (
    paneId: string,
    update: (current: FavoriteFilters) => FavoriteFilters
  ) => {
    setPaneStates((current) => {
      const pane = current[paneId];
      if (!pane) {
        return current;
      }
      return { ...current, [paneId]: { ...pane, filters: update(pane.filters) } };
    });
  };

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
  const isGlobalScope = scope === 'global';

  useEffect(() => {
    if (isGlobalScope) {
      setClusterSpecific(false);
    }
  }, [isGlobalScope]);

  // Detect whether Save should be enabled when editing.
  const changesDetected =
    isEditing && existingFavorite
      ? hasFormChanges(existingFavorite, {
          name: name.trim() || defaultName,
          clusterSpecific,
          clusterSelection,
          scope,
          view: activeView,
          namespace: selectedNamespace,
          panes: paneStates,
        })
      : true;

  // ----- Handlers -----

  const handleSave = async () => {
    if (saving) {
      return;
    }
    const bindsCluster = !isGlobalScope && clusterSpecific;
    const selectedClusterMeta = bindsCluster ? getClusterMeta(clusterSelection) : null;
    const fav: Favorite = {
      id: existingFavorite?.id ?? '',
      name: name.trim() || defaultName,
      clusterSelection: bindsCluster ? clusterSelection : '',
      clusterId: bindsCluster ? (selectedClusterMeta?.id ?? '') : '',
      clusterName: bindsCluster ? (selectedClusterMeta?.name ?? '') : '',
      viewType: scope,
      view: activeView,
      namespace: scope === 'namespace' ? selectedNamespace : '',
      panes: paneStates,
      order: existingFavorite?.order ?? 0,
    };
    setSaving(true);
    setSaveError('');
    try {
      await onSave(fav);
      setSaving(false);
      onClose();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
      setSaving(false);
    }
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

  if (!isOpen) {
    return null;
  }

  return (
    <>
      <ModalSurface
        modalRef={modalRef}
        labelledBy="fav-save-modal-title"
        onClose={onClose}
        containerClassName="fav-save-modal"
      >
        <ModalHeader
          title={isEditing ? 'Edit Favorite' : 'Save Favorite'}
          titleId="fav-save-modal-title"
          icon={FavoriteGenericIcon}
          onClose={onClose}
          closeDisabled={saving}
        />

        <div className="modal-content modal-form">
          {/* Name */}
          <div className="modal-form-section">
            <h3>Name</h3>
            <div className="modal-form-items">
              <div className="modal-form-field">
                <input
                  id={`${elementIdPrefix}-fav-name`}
                  type="text"
                  className="modal-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
                      e.preventDefault();
                      (e.target as HTMLInputElement).select();
                    }
                  }}
                  data-modal-initial-focus
                />
              </div>
            </div>
          </div>

          {/* Type (cluster binding) */}
          <div className="modal-form-section">
            <h3>Scope</h3>
            <div className="modal-form-items">
              <div className="modal-form-field modal-form-field-inline fav-save-inline-row">
                <label className="modal-radio-label">
                  <input
                    type="radio"
                    name="cluster-type"
                    checked={!clusterSpecific}
                    onChange={() => handleTypeChange(false)}
                  />
                  Any
                  <Tooltip content="Can be used in any cluster. Attempts to open this view in the current active cluster." />
                </label>
              </div>
              <div className="modal-form-field modal-form-field-inline fav-save-inline-row">
                <label className="modal-radio-label">
                  <input
                    type="radio"
                    name="cluster-type"
                    checked={clusterSpecific}
                    onChange={() => handleTypeChange(true)}
                    disabled={isGlobalScope}
                  />
                  Cluster
                  <Tooltip content="Opens the saved view in a specific cluster, and will activate that cluster if needed." />
                </label>
                <Dropdown
                  options={clusterOptions}
                  dropdownClassName="fav-save-dropdown-menu"
                  value={clusterSelection}
                  onChange={(val) => setClusterSelection(val as string)}
                  placeholder="Select cluster..."
                  disabled={!clusterSpecific}
                  renderValue={(val) => {
                    if (!clusterSpecific) {
                      return 'Select cluster...';
                    }
                    const match = clusterOptions.find((o) => o.value === val);
                    return match?.metadata?.context ?? val ?? 'Select cluster...';
                  }}
                  renderOption={(option) => (
                    <div
                      className={`kubeconfig-option${!option.metadata?.isFirstForFile ? ' no-filename' : ''}${option.metadata?.isCurrentContext ? ' current-context' : ''}`}
                    >
                      {!!option.metadata?.isFirstForFile && (
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
          <div className="modal-form-section">
            <h3>View</h3>
            <div className="modal-form-items">
              <div className="modal-form-field modal-form-field-inline fav-save-inline-row">
                <label htmlFor={`${elementIdPrefix}-favorite-view`}>View</label>
                <Dropdown
                  id={`${elementIdPrefix}-favorite-view`}
                  dropdownClassName="fav-save-dropdown-menu"
                  options={ALL_VIEWS}
                  value={selectedView}
                  onChange={(val) => setSelectedView(val as string)}
                  placeholder="Select view..."
                  disabled
                />
              </div>
              {isNamespaceScope && (
                <div className="modal-form-field modal-form-field-inline fav-save-inline-row">
                  <label htmlFor={`${elementIdPrefix}-favorite-namespace`}>Namespace</label>
                  <Dropdown
                    id={`${elementIdPrefix}-favorite-namespace`}
                    dropdownClassName="fav-save-dropdown-menu"
                    options={namespaceOptions}
                    value={selectedNamespace}
                    onChange={(val) => setSelectedNamespace(val as string)}
                  />
                </div>
              )}
            </div>
          </div>

          {modalPanes.map((pane) => {
            const paneState = paneStates[pane.id];
            return paneState ? (
              <FavoritePaneFilters
                key={pane.id}
                elementIdPrefix={elementIdPrefix}
                pane={pane}
                state={paneState}
                showPaneLabel={modalPanes.length > 1}
                onChange={(next) => updatePaneFilters(pane.id, () => next)}
              />
            ) : null;
          })}
        </div>

        <div className="modal-footer">
          {isEditing && (
            <button type="button" className="button danger" onClick={handleDelete}>
              Delete
            </button>
          )}
          {saveError ? (
            <div className="fav-save-error" role="alert">
              {saveError}
            </div>
          ) : null}
          <div className="fav-save-footer-spacer" />
          <button type="button" className="button cancel" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className="button save"
            onClick={handleSave}
            disabled={saving || (isEditing && !changesDetected)}
          >
            {saving ? 'Saving…' : 'Save'}
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
