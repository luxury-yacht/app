import { useCallback, useMemo } from 'react';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import { useNamespaceFilterOptions } from '@modules/namespace/hooks/useNamespaceFilterOptions';
import { useNamespaceGridTablePersistence } from '@modules/namespace/hooks/useNamespaceGridTablePersistence';
import type { IconBarItem } from '@shared/components/IconBar/IconBar';
import { MetadataIcon } from '@shared/components/icons/MenuIcons';
import {
  GRIDTABLE_VIRTUALIZATION_DEFAULT,
  type GridTableFilterConfig,
} from '@shared/components/tables/GridTable';
import { useKindFilterOptions } from '@shared/components/tables/hooks/useKindFilterOptions';
import { useGridTablePersistence } from '@shared/components/tables/persistence/useGridTablePersistence';
import { useFavToggle } from '@ui/favorites/FavToggle';
import { useGridTableBinding } from './useGridTableBinding';
import type {
  ClusterResourceGridTableParams,
  NamespaceResourceGridTableParams,
  ObjectPanelResourceGridTableParams,
  QueryResourceGridTableParams,
  ResourceGridCommonParams,
  ResourceGridTableResult,
  ResourceGridTableRow,
} from './resourceGridTableTypes';

export function useClusterResourceGridTable<T extends ResourceGridTableRow>({
  viewId,
  data,
  persistenceData,
  columns,
  keyExtractor,
  filterOptions,
  defaultSortKey = 'name',
  defaultSortDirection = 'asc',
  showNamespaceFilters = false,
  ...common
}: ClusterResourceGridTableParams<T>): ResourceGridTableResult<T> {
  const { selectedClusterId } = useKubeconfig();
  const persistence = useGridTablePersistence<T>({
    viewId,
    clusterIdentity: selectedClusterId,
    namespace: null,
    isNamespaceScoped: false,
    columns,
    data: persistenceData ?? data,
    keyExtractor,
    filterOptions: { ...(filterOptions ?? {}), isNamespaceScoped: false },
  });

  return useResourceGridTableCommon({
    ...common,
    data,
    columns,
    keyExtractor,
    persistence,
    defaultSortKey,
    defaultSortDirection,
    namespace: showNamespaceFilters ? ALL_NAMESPACES_SCOPE : undefined,
    showNamespaceFilters,
  });
}

export function useNamespaceResourceGridTable<T extends ResourceGridTableRow>({
  viewId,
  namespace,
  data,
  persistenceData,
  columns,
  keyExtractor,
  filterOptions,
  defaultSort = { key: 'name', direction: 'asc' },
  showNamespaceFilters = false,
  ...common
}: NamespaceResourceGridTableParams<T>): ResourceGridTableResult<T> {
  const persistence = useNamespaceGridTablePersistence<T>({
    viewId,
    namespace,
    columns,
    data: persistenceData ?? data,
    keyExtractor,
    defaultSort,
    filterOptions: {
      ...(filterOptions ?? {}),
      isNamespaceScoped: namespace !== ALL_NAMESPACES_SCOPE,
    },
  });

  return useResourceGridTableCommon({
    ...common,
    data,
    columns,
    keyExtractor,
    persistence: {
      ...persistence,
      setSortConfig: persistence.onSortChange,
    },
    defaultSortDirection: defaultSort.direction ?? 'asc',
    namespace,
    showNamespaceFilters,
  });
}

export function useObjectPanelResourceGridTable<T extends ResourceGridTableRow>({
  viewId,
  clusterIdentity,
  enabled = true,
  data,
  columns,
  keyExtractor,
  filterAccessors,
  filterOptions,
  defaultSort = { key: 'name', direction: 'asc' },
  diagnosticsLabel,
  rowIdentity,
}: ObjectPanelResourceGridTableParams<T>): ResourceGridTableResult<T> {
  const persistence = useGridTablePersistence<T>({
    viewId,
    clusterIdentity: clusterIdentity ?? '',
    enabled: enabled && Boolean(clusterIdentity),
    namespace: null,
    isNamespaceScoped: false,
    columns,
    data,
    keyExtractor,
    filterOptions: { ...(filterOptions ?? {}), isNamespaceScoped: false },
  });

  const binding = useGridTableBinding({
    data,
    columns,
    defaultSortKey: defaultSort.key,
    defaultSortDirection: defaultSort.direction ?? 'asc',
    diagnosticsLabel,
    rowIdentity,
    persistence,
  });

  const filters = useMemo<GridTableFilterConfig<T>>(
    () => ({
      enabled: true,
      value: persistence.filters,
      accessors: filterAccessors,
      onChange: persistence.setFilters,
      onReset: persistence.resetState,
      options: {},
    }),
    [filterAccessors, persistence.filters, persistence.resetState, persistence.setFilters]
  );

  const gridTableProps = useMemo(
    () => ({ ...binding.gridTableProps, filters }),
    [binding.gridTableProps, filters]
  );

  return {
    gridTableProps,
    favModal: null,
  };
}

export function useQueryResourceGridTable<T extends ResourceGridTableRow>({
  data,
  columns,
  persistence,
  defaultSortKey = 'name',
  defaultSortDirection = 'asc',
  diagnosticsLabel,
  filterAccessors,
  filterOptions,
  rowIdentity,
  virtualization = GRIDTABLE_VIRTUALIZATION_DEFAULT,
}: QueryResourceGridTableParams<T>): ResourceGridTableResult<T> {
  const binding = useGridTableBinding({
    data,
    columns,
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
        preActions: [...(filterOptions.preActions ?? []), favToggle],
      },
    }),
    [
      favToggle,
      filterAccessors,
      filterOptions,
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
  };
}

function useResourceGridTableCommon<T extends ResourceGridTableRow>({
  data,
  columns,
  availableKinds: kindOptions,
  diagnosticsLabel,
  filterAccessors,
  leadingFilterActions = [],
  kindDropdownBulkActions = false,
  kindDropdownSearchable = false,
  metadataSearch,
  rowIdentity,
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
    columns,
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
  const useMetadata = Boolean(metadataSearch);
  const includeMetadata = persistence.filters.includeMetadata;
  const setIncludeMetadata = useCallback(
    (value: boolean) => {
      persistence.setFilters({ ...persistence.filters, includeMetadata: value });
    },
    [persistence]
  );
  const metadataSearchText = useCallback(
    (row: T): string[] => {
      if (!metadataSearch) {
        return [];
      }

      const values: string[] = metadataSearch.getDefaultValues(row).filter(Boolean);
      if (includeMetadata) {
        for (const map of metadataSearch.getMetadataMaps(row)) {
          if (!map) continue;
          for (const [key, value] of Object.entries(map)) {
            values.push(key, value, `${key}: ${value}`);
          }
        }
      }
      return values;
    },
    [includeMetadata, metadataSearch]
  );
  const metadataToggle = useMemo<IconBarItem | null>(() => {
    if (!metadataSearch) {
      return null;
    }

    return {
      type: 'toggle',
      id: 'include-metadata',
      icon: <MetadataIcon width={16} height={16} />,
      active: includeMetadata,
      onClick: () => setIncludeMetadata(!includeMetadata),
      title: 'Include metadata',
    };
  }, [includeMetadata, metadataSearch, setIncludeMetadata]);
  const effectiveFilterAccessors = useMemo<GridTableFilterConfig<T>['accessors']>(
    () =>
      useMetadata
        ? {
            ...filterAccessors,
            getSearchText: metadataSearchText,
          }
        : filterAccessors,
    [filterAccessors, metadataSearchText, useMetadata]
  );

  const { item: favToggle, modal: favModal } = useFavToggle({
    filters: persistence.filters,
    includeMetadata: useMetadata ? includeMetadata : undefined,
    sortColumn: sortConfig?.key ?? null,
    sortDirection: sortConfig?.direction ?? 'asc',
    columnVisibility: persistence.columnVisibility ?? {},
    setFilters: persistence.setFilters,
    setSortConfig: persistence.setSortConfig,
    setColumnVisibility: persistence.setColumnVisibility,
    setIncludeMetadata: useMetadata ? setIncludeMetadata : undefined,
    hydrated: persistence.hydrated,
    availableKinds,
    availableFilterNamespaces: showNamespaceFilters ? availableFilterNamespaces : undefined,
  });
  const trailingFilterActions = useMemo(
    () => getTrailingFilterActions?.(sortedData) ?? [],
    [getTrailingFilterActions, sortedData]
  );
  const filterPreActions = useMemo(
    () => [
      ...(metadataToggle ? [metadataToggle] : []),
      ...leadingFilterActions,
      favToggle,
      ...trailingFilterActions,
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
      value: persistence.filters,
      accessors: effectiveFilterAccessors,
      onChange: persistence.setFilters,
      onReset: persistence.resetState,
      options: {
        kinds: availableKinds,
        namespaces: showNamespaceFilters ? availableFilterNamespaces : undefined,
        showKindDropdown,
        kindDropdownSearchable,
        kindDropdownBulkActions,
        showNamespaceDropdown: showNamespaceFilters,
        namespaceDropdownSearchable: showNamespaceFilters,
        namespaceDropdownBulkActions: showNamespaceFilters,
        preActions: filterPreActions,
      },
    }),
    [
      availableFilterNamespaces,
      availableKinds,
      effectiveFilterAccessors,
      filterPreActions,
      kindDropdownBulkActions,
      kindDropdownSearchable,
      persistence.filters,
      persistence.resetState,
      persistence.setFilters,
      showKindDropdown,
      showNamespaceFilters,
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
