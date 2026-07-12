/**
 * frontend/src/modules/resource-grid/useResourceGridTable.tsx
 *
 * Coordinates shared resource-grid table state, identity, and context menus.
 */

import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import { useNamespaceFilterOptions } from '@modules/namespace/hooks/useNamespaceFilterOptions';
import {
  GRIDTABLE_VIRTUALIZATION_DEFAULT,
  type GridTableFilterConfig,
  type GridTableFilterState,
} from '@shared/components/tables/GridTable';
import { useKindFilterOptions } from '@shared/components/tables/hooks/useKindFilterOptions';
import { useMetadataSearch } from '@shared/components/tables/hooks/useMetadataSearch';
import { useGridTablePersistence } from '@shared/components/tables/persistence/useGridTablePersistence';

import { buildRequiredCanonicalObjectRowKey } from '@shared/utils/objectIdentity';
import { useFavToggle } from '@ui/favorites/FavToggle';
import { useCallback, useEffect, useMemo } from 'react';
import {
  normalizeQueryBackedNamespaceQueryFilters,
  queryBackedFacetFilterOptions,
  removeQueryBackedNamespaceFilterSentinels,
} from './queryBackedTableState';
import type {
  ClusterResourceGridTableParams,
  NamespaceResourceGridTableParams,
  ObjectPanelResourceGridTableParams,
  QueryResourceGridTableParams,
  ResourceGridCommonParams,
  ResourceGridTableMode,
  ResourceGridTableResult,
  ResourceGridTableRow,
} from './resourceGridTableTypes';
import { isQueryBackedResourceGridTableMode } from './resourceGridTableTypes';
import { useGridTableBinding } from './useGridTableBinding';

const resourceGridPartialDataLabel = (tableMode: ResourceGridTableMode) =>
  tableMode === 'Local Partial'
    ? 'This table is showing a bounded or recent local window. Search, filters, sort, export, and selection apply only to the visible dataset.'
    : undefined;

const useDefaultResourceGridKey = <T extends ResourceGridTableRow>(
  fallbackClusterId?: string | null
) =>
  useCallback(
    (item: T) => buildRequiredCanonicalObjectRowKey(item, { fallbackClusterId }),
    [fallbackClusterId]
  );

export function useClusterResourceGridTable<T extends ResourceGridTableRow>({
  tableMode,
  data,
  columns,
  keyExtractor,
  persistenceOverride: persistence,
  defaultSortKey = 'name',
  defaultSortDirection = 'asc',
  showNamespaceFilters = false,
  ...common
}: ClusterResourceGridTableParams<T>): ResourceGridTableResult<T> {
  const table = useResourceGridTableCommon({
    ...common,
    tableMode,
    data,
    columns,
    keyExtractor,
    rowIdentity: common.rowIdentity ?? common.objectIdentity?.rowIdentity,
    persistence,
    defaultSortKey,
    defaultSortDirection,
    namespace: showNamespaceFilters ? ALL_NAMESPACES_SCOPE : undefined,
    showNamespaceFilters,
  });
  return { ...table, persistence };
}

export function useNamespaceResourceGridTable<T extends ResourceGridTableRow>({
  tableMode,
  namespace,
  data,
  columns,
  keyExtractor,
  persistenceOverride: persistence,
  defaultSort = { key: 'name', direction: 'asc' },
  showNamespaceFilters = false,
  ...common
}: NamespaceResourceGridTableParams<T>): ResourceGridTableResult<T> {
  const table = useResourceGridTableCommon({
    ...common,
    tableMode,
    data,
    columns,
    keyExtractor,
    rowIdentity: common.rowIdentity ?? common.objectIdentity?.rowIdentity,
    persistence,
    defaultSortKey: defaultSort.key,
    defaultSortDirection: defaultSort.direction ?? 'asc',
    namespace,
    showNamespaceFilters,
  });
  return { ...table, persistence };
}

export function useObjectPanelResourceGridTable<T extends ResourceGridTableRow>({
  viewId,
  tableMode,
  clusterIdentity,
  enabled = true,
  data,
  columns,
  keyExtractor,
  filterAccessors,
  filterOptions,
  pageSizeOptions,
  defaultSort = { key: 'name', direction: 'asc' },
  diagnosticsLabel,
  rowIdentity,
  objectIdentity,
}: ObjectPanelResourceGridTableParams<T>): ResourceGridTableResult<T> {
  const defaultKeyExtractor = useDefaultResourceGridKey<T>(clusterIdentity);
  const resolvedKeyExtractor = keyExtractor ?? objectIdentity?.key ?? defaultKeyExtractor;
  const persistence = useGridTablePersistence<T>({
    viewId,
    clusterIdentity: clusterIdentity ?? '',
    enabled: enabled && Boolean(clusterIdentity),
    namespace: null,
    isNamespaceScoped: false,
    columns,
    data,
    keyExtractor: resolvedKeyExtractor,
    filterOptions: { ...(filterOptions ?? {}), isNamespaceScoped: false },
    pageSizeOptions,
  });

  const binding = useGridTableBinding({
    data,
    tableMode,
    columns,
    keyExtractor: resolvedKeyExtractor,
    defaultSortKey: defaultSort.key,
    defaultSortDirection: defaultSort.direction ?? 'asc',
    diagnosticsLabel,
    rowIdentity: rowIdentity ?? objectIdentity?.rowIdentity,
    persistence,
  });

  const filters = useMemo<GridTableFilterConfig<T>>(
    () => ({
      enabled: true,
      value: persistence.filters,
      accessors: filterAccessors,
      onChange: persistence.setFilters,
      onReset: persistence.resetState,
      options: {
        partialDataLabel: resourceGridPartialDataLabel(tableMode),
      },
    }),
    [
      filterAccessors,
      persistence.filters,
      persistence.resetState,
      persistence.setFilters,
      tableMode,
    ]
  );

  const gridTableProps = useMemo(
    () => ({ ...binding.gridTableProps, filters }),
    [binding.gridTableProps, filters]
  );

  return {
    gridTableProps,
    favModal: null,
    persistence,
  };
}

export function useQueryResourceGridTable<T extends ResourceGridTableRow>({
  tableMode,
  data,
  columns,
  persistence,
  defaultSortKey = 'name',
  defaultSortDirection = 'asc',
  diagnosticsLabel,
  filterAccessors,
  filterOptions,
  keyExtractor,
  rowIdentity,
  virtualization = GRIDTABLE_VIRTUALIZATION_DEFAULT,
}: QueryResourceGridTableParams<T>): ResourceGridTableResult<T> {
  const defaultKeyExtractor = useDefaultResourceGridKey<T>();
  const resolvedKeyExtractor = keyExtractor ?? defaultKeyExtractor;
  const binding = useGridTableBinding({
    data,
    tableMode,
    columns,
    keyExtractor: resolvedKeyExtractor,
    defaultSortKey,
    defaultSortDirection,
    diagnosticsLabel,
    rowIdentity,
    persistence,
    virtualization,
  });

  const { item: favToggle, modal: favModal } = useFavToggle({
    filters: persistence.filters,
    sortColumn: binding.sortConfig?.key ?? null,
    sortDirection: binding.sortConfig?.direction ?? 'asc',
    columnVisibility: persistence.columnVisibility ?? {},
    setFilters: persistence.setFilters,
    setSortConfig: persistence.setSortConfig,
    setColumnVisibility: persistence.setColumnVisibility,
    hydrated: persistence.hydrated,
    availableKinds: filterOptions.kinds,
    availableFilterNamespaces: filterOptions.namespaces,
  });

  const filters = useMemo<GridTableFilterConfig<T>>(
    () => ({
      enabled: true,
      value: persistence.filters,
      accessors: filterAccessors,
      onChange: persistence.setFilters,
      onReset: persistence.resetState,
      options: {
        ...filterOptions,
        searchBehavior: isQueryBackedResourceGridTableMode(tableMode)
          ? 'query'
          : (filterOptions.searchBehavior ?? 'local'),
        partialDataLabel: filterOptions.partialDataLabel ?? resourceGridPartialDataLabel(tableMode),
        preActions: [...(filterOptions.preActions ?? []), favToggle],
      },
    }),
    [
      favToggle,
      filterAccessors,
      filterOptions,
      tableMode,
      persistence.filters,
      persistence.resetState,
      persistence.setFilters,
    ]
  );

  const gridTableProps = useMemo(
    () => ({ ...binding.gridTableProps, filters }),
    [binding.gridTableProps, filters]
  );

  return {
    gridTableProps,
    favModal,
    persistence,
  };
}

function useResourceGridTableCommon<T extends ResourceGridTableRow>({
  data,
  tableMode,
  columns,
  availableKinds: kindOptions,
  diagnosticsLabel,
  filterAccessors,
  leadingFilterActions = [],
  filterOptionOverrides,
  kindDropdownBulkActions = false,
  kindDropdownSearchable = false,
  metadataSearch,
  onTableStateChange,
  rowIdentity,
  keyExtractor,
  persistence,
  defaultSortKey,
  defaultSortDirection = 'asc',
  namespace = '',
  showNamespaceFilters = false,
  showKindDropdown = false,
  getTrailingFilterActions,
  transformSortedData,
}: ResourceGridCommonParams<T>): ResourceGridTableResult<T> {
  const binding = useGridTableBinding({
    data,
    tableMode,
    columns,
    keyExtractor,
    defaultSortKey,
    defaultSortDirection,
    diagnosticsLabel,
    rowIdentity,
    persistence,
  });
  const { sortedData, sortConfig } = binding;

  const fallbackKinds = useKindFilterOptions(data);
  const availableKinds = kindOptions && kindOptions.length > 0 ? kindOptions : fallbackKinds;
  const fallbackNamespaces = useMemo(
    () => [...new Set(data.map((row) => row.namespace?.trim() ?? '').filter(Boolean))].sort(),
    [data]
  );
  const availableFilterNamespaces = useNamespaceFilterOptions(namespace, fallbackNamespaces);
  const persistenceFilters = persistence.filters;
  const setPersistenceFilters = persistence.setFilters;
  const namespaceFilterOptions = queryBackedFacetFilterOptions(
    availableFilterNamespaces,
    filterOptionOverrides?.namespaces,
    fallbackNamespaces
  );
  // The static per-view kind vocabulary (the prop, when supplied) must survive
  // collapsed post-filter facets the same way namespace metadata does.
  const kindFilterOptions = queryBackedFacetFilterOptions(
    kindOptions,
    filterOptionOverrides?.kinds,
    fallbackKinds
  );
  const normalizeTableFilters = useCallback(
    (next: GridTableFilterState) =>
      isQueryBackedResourceGridTableMode(tableMode) && showNamespaceFilters
        ? removeQueryBackedNamespaceFilterSentinels(next)
        : next,
    [showNamespaceFilters, tableMode]
  );
  const normalizeQueryFilters = useCallback(
    (next: GridTableFilterState) =>
      isQueryBackedResourceGridTableMode(tableMode) && showNamespaceFilters
        ? normalizeQueryBackedNamespaceQueryFilters(next, availableFilterNamespaces)
        : next,
    [availableFilterNamespaces, showNamespaceFilters, tableMode]
  );
  const filterValue = useMemo(
    () => normalizeTableFilters(persistenceFilters),
    [normalizeTableFilters, persistenceFilters]
  );
  const handleFiltersChange = useCallback(
    (next: GridTableFilterState) => {
      setPersistenceFilters(normalizeTableFilters(next));
    },
    [normalizeTableFilters, setPersistenceFilters]
  );

  const persistenceHydrated = persistence.hydrated;
  useEffect(() => {
    void persistenceHydrated;
    const filters = normalizeTableFilters(persistenceFilters);
    if (filters !== persistenceFilters) {
      setPersistenceFilters(filters);
    }
    onTableStateChange?.({
      filters: normalizeQueryFilters(filters),
      sortConfig: sortConfig ?? null,
    });
    // persistenceHydrated is a deliberate dependency: hydration may commit
    // WITHOUT changing the filters object identity, and the query lifecycle
    // only arms itself on a post-hydration publish. Re-publishing the same
    // value is safe (consumers dedupe by value).
  }, [
    normalizeTableFilters,
    normalizeQueryFilters,
    onTableStateChange,
    persistenceFilters,
    setPersistenceFilters,
    sortConfig,
    persistenceHydrated,
  ]);

  const useMetadata = Boolean(metadataSearch);
  const getDefaultMetadataSearchValues = useCallback(
    (row: T) => metadataSearch?.getDefaultValues(row) ?? [],
    [metadataSearch]
  );
  const getMetadataSearchMaps = useCallback(
    (row: T) => metadataSearch?.getMetadataMaps(row) ?? [],
    [metadataSearch]
  );
  const metadata = useMetadataSearch<T>({
    enabled: useMetadata,
    getDefaultValues: getDefaultMetadataSearchValues,
    getMetadataMaps: getMetadataSearchMaps,
    filters: persistence.filters,
    onFiltersChange: persistence.setFilters,
  });
  const metadataToggle = useMetadata ? metadata.metadataToggle : null;
  const effectiveFilterAccessors = useMemo<GridTableFilterConfig<T>['accessors']>(
    () =>
      useMetadata
        ? {
            ...filterAccessors,
            getSearchText: metadata.getSearchText,
          }
        : filterAccessors,
    [filterAccessors, metadata.getSearchText, useMetadata]
  );

  const { item: favToggle, modal: favModal } = useFavToggle({
    filters: persistence.filters,
    includeMetadata: useMetadata ? metadata.includeMetadata : undefined,
    sortColumn: sortConfig?.key ?? null,
    sortDirection: sortConfig?.direction ?? 'asc',
    columnVisibility: persistence.columnVisibility ?? {},
    setFilters: persistence.setFilters,
    setSortConfig: persistence.setSortConfig,
    setColumnVisibility: persistence.setColumnVisibility,
    setIncludeMetadata: useMetadata ? metadata.setIncludeMetadata : undefined,
    hydrated: persistence.hydrated,
    availableKinds,
    availableFilterNamespaces: showNamespaceFilters ? availableFilterNamespaces : undefined,
  });
  const trailingFilterActions = useMemo(
    () => getTrailingFilterActions?.(sortedData) ?? [],
    [getTrailingFilterActions, sortedData]
  );
  // Filter-related actions and the favorite (save) toggle all live on the left, separate
  // from the right-side copy/export cluster (the scope toggle + Copy + Export).
  const filterPreActions = useMemo(
    () => [
      ...(metadataToggle ? [metadataToggle] : []),
      ...leadingFilterActions,
      ...trailingFilterActions,
      favToggle,
    ],
    [favToggle, leadingFilterActions, metadataToggle, trailingFilterActions]
  );
  const displayData = useMemo(
    () => (transformSortedData ? transformSortedData(sortedData) : sortedData),
    [sortedData, transformSortedData]
  );

  const filters = useMemo<GridTableFilterConfig<T>>(
    () => ({
      enabled: true,
      value: filterValue,
      accessors: effectiveFilterAccessors,
      onChange: handleFiltersChange,
      onReset: persistence.resetState,
      options: {
        ...filterOptionOverrides,
        kinds: kindFilterOptions ?? availableKinds,
        namespaces: showNamespaceFilters ? namespaceFilterOptions : undefined,
        searchBehavior: isQueryBackedResourceGridTableMode(tableMode) ? 'query' : 'local',
        showKindDropdown,
        kindDropdownSearchable,
        kindDropdownBulkActions,
        showNamespaceDropdown: showNamespaceFilters,
        namespaceDropdownSearchable: showNamespaceFilters,
        namespaceDropdownBulkActions: showNamespaceFilters,
        partialDataLabel:
          filterOptionOverrides?.partialDataLabel ?? resourceGridPartialDataLabel(tableMode),
        preActions: filterPreActions,
      },
    }),
    [
      availableKinds,
      effectiveFilterAccessors,
      filterValue,
      handleFiltersChange,
      filterOptionOverrides,
      filterPreActions,
      kindDropdownBulkActions,
      kindDropdownSearchable,
      kindFilterOptions,
      persistence.resetState,
      showKindDropdown,
      showNamespaceFilters,
      namespaceFilterOptions,
      tableMode,
    ]
  );

  const gridTableProps = useMemo(
    () => ({ ...binding.gridTableProps, data: displayData, filters }),
    [binding.gridTableProps, displayData, filters]
  );

  return {
    gridTableProps,
    favModal,
  };
}
