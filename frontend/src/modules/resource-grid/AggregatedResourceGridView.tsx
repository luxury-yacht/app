/**
 * frontend/src/modules/resource-grid/AggregatedResourceGridView.tsx
 *
 * Shared skeleton for the aggregated multi-kind resource grid views (the
 * cluster/namespace Config, RBAC, Storage, CRDs, Network, Quotas, and
 * Autoscaling tabs). Every one of those views wires the same machinery —
 * object identity, the query-backed grid hook, object actions with a context
 * menu, empty state, and ResourceInventoryTable — around a per-view row type
 * and column set. Each view declares an AggregatedResourceGridViewSpec and
 * renders the scope component below; only its columns, labels, and identity
 * mapping remain per-view.
 */

import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useNamespaceColumnLink } from '@modules/namespace/components/useNamespaceColumnLink';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import ResourceInventoryTable from '@modules/resource-grid/ResourceInventoryTable';
import {
  selectPayloadRows,
  type TypedQueryPayload,
} from '@modules/resource-grid/typedResourceQueryScope';
import {
  useQueryBackedClusterResourceGridTable,
  useQueryBackedNamespaceResourceGridTable,
} from '@modules/resource-grid/useQueryBackedResourceGridTable';
import {
  type ResourceGridObjectIdentityAdapter,
  type ResourceGridObjectIdentityInput,
  useResourceGridObjectIdentity,
} from '@modules/resource-grid/useResourceGridObjectIdentity';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import * as cf from '@shared/components/tables/columnFactories';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable';
import { useNavigateToView } from '@shared/hooks/useNavigateToView';
import { useObjectActionController } from '@shared/hooks/useObjectActionController';
import { buildRequiredObjectReference } from '@shared/utils/objectIdentity';
import { useCallback, useMemo } from 'react';
import type { RefreshDomain } from '@/core/refresh/types';
import { useShortNames } from '@/hooks/useShortNames';
import type { NamespaceViewType } from '@/types/navigation/views';
import type { KubernetesObjectReference } from '@/types/view-state';
import { resolveEmptyStateMessage } from '@/utils/emptyState';

/** The row fields the shared skeleton itself reads. */
export interface AggregatedRowBase {
  name: string;
  namespace?: string;
  clusterId?: string;
  clusterName?: string;
}

/** Helpers handed to a view's column builder. */
export interface AggregatedColumnHelpers<D> {
  /** The row's own identity: open/navigate/ref/key handlers for lead columns. */
  identity: ResourceGridObjectIdentityAdapter<D>;
  /** Open another object (a cross-object link column, e.g. a PV's claim). */
  openObject: (input: ResourceGridObjectIdentityInput) => void;
  /** Alt-navigate to another object. */
  navigateObject: (input: ResourceGridObjectIdentityInput) => void;
  /** Open an already-built reference (views with bespoke reference builders). */
  openReference: (ref: KubernetesObjectReference) => void;
  /** Alt-navigate to an already-built reference. */
  navigateReference: (ref: KubernetesObjectReference) => void;
  /** The selected cluster id, for bespoke reference builders. */
  fallbackClusterId: string | null | undefined;
  useShortResourceNames: boolean;
}

export interface AggregatedResourceGridViewSpec<D extends AggregatedRowBase> {
  domain: RefreshDomain;
  viewId: string;
  /**
   * Diagnostics/table label. Cluster views use `cluster`; namespace views pick
   * `allNamespaces` or `namespace` from the active scope.
   */
  labels: { cluster?: string; namespace?: string; allNamespaces?: string };
  /**
   * Default empty message. Namespace views receive the scope suffix the views
   * always rendered ("in any namespaces" / "in this namespace"); cluster views
   * receive an empty suffix.
   */
  emptyMessage: (scopeSuffix: string) => string;
  spinnerMessage: string;
  tableClassName: string;
  defaultSort?: { key: string; direction: 'asc' | 'desc' };
  showKindDropdown?: boolean;
  /** The namespace-column link target tab. Required for namespace-scoped views. */
  namespaceLinkTab?: NamespaceViewType;
  /** Overrides the default rows-passthrough payload mapping. */
  selectRows?: (payload: TypedQueryPayload) => D[];
  /** Extra filter options for the namespace grid hook. */
  filterOptions?: (ctx: { allNamespaces: boolean }) => { isNamespaceScoped: boolean };
  /** Diagnostics mode override for ResourceInventoryTable. */
  diagnosticsMode?: 'live';
  /** Maps a row to its object identity (kind fallbacks live here). */
  getIdentity: (row: D) => ResourceGridObjectIdentityInput;
  /** Builds the full column list (lead kind/name, middle, age). */
  buildColumns: (helpers: AggregatedColumnHelpers<D>) => GridColumnDefinition<D>[];
}

/**
 * useAggregatedGridCore wires the scope-independent machinery: row identity,
 * cross-object link helpers, the built (and auto-sized) columns, object
 * actions, and the context menu.
 */
function useAggregatedGridCore<D extends AggregatedRowBase>(
  spec: AggregatedResourceGridViewSpec<D>
) {
  const { openWithObject } = useObjectPanel();
  const { navigateToView } = useNavigateToView();
  const { selectedClusterId } = useKubeconfig();
  const useShortResourceNames = useShortNames();

  const identity = useResourceGridObjectIdentity<D>({
    fallbackClusterId: selectedClusterId,
    getObject: spec.getIdentity,
    openWithObject,
    navigateToView,
  });

  const openObject = useCallback(
    (input: ResourceGridObjectIdentityInput) =>
      openWithObject(buildRequiredObjectReference(input, { fallbackClusterId: selectedClusterId })),
    [openWithObject, selectedClusterId]
  );
  const navigateObject = useCallback(
    (input: ResourceGridObjectIdentityInput) =>
      navigateToView(buildRequiredObjectReference(input, { fallbackClusterId: selectedClusterId })),
    [navigateToView, selectedClusterId]
  );

  const openReference = useCallback(
    (ref: KubernetesObjectReference) => openWithObject(ref),
    [openWithObject]
  );
  const navigateReference = useCallback(
    (ref: KubernetesObjectReference) => navigateToView(ref),
    [navigateToView]
  );

  const { buildColumns } = spec;
  const columns: GridColumnDefinition<D>[] = useMemo(() => {
    const built = buildColumns({
      identity,
      openObject,
      navigateObject,
      openReference,
      navigateReference,
      fallbackClusterId: selectedClusterId,
      useShortResourceNames,
    });
    const sizing: cf.ColumnSizingMap = {};
    for (const column of built) {
      sizing[column.key] = { autoWidth: true };
    }
    cf.applyColumnSizing(built, sizing);
    return built;
  }, [
    buildColumns,
    identity,
    navigateObject,
    navigateReference,
    openObject,
    openReference,
    selectedClusterId,
    useShortResourceNames,
  ]);

  const objectActions = useObjectActionController({
    context: 'gridtable',
    onOpen: (object) => openWithObject(object),
    onOpenObjectMap: (object) => openWithObject(object, { initialTab: 'map' }),
  });

  const { ref: rowRef } = identity;
  const getContextMenuItems = useCallback(
    (row: D): ContextMenuItem[] => objectActions.getMenuItems(rowRef(row)),
    [objectActions, rowRef]
  );

  return {
    selectedClusterId,
    useShortResourceNames,
    identity,
    columns,
    objectActions,
    getContextMenuItems,
  };
}

export function ClusterAggregatedResourceGridView<
  P extends TypedQueryPayload,
  D extends AggregatedRowBase,
>({ spec, error }: { spec: AggregatedResourceGridViewSpec<D>; error?: string | null }) {
  const core = useAggregatedGridCore(spec);
  const diagnosticsLabel = spec.labels.cluster ?? '';

  const { gridTableProps, favModal, source } = useQueryBackedClusterResourceGridTable<P, D>({
    queryTableMode: 'Query Backed Static',
    clusterId: core.selectedClusterId,
    domain: spec.domain,
    label: diagnosticsLabel,
    selectRows: (payload: P) =>
      spec.selectRows
        ? spec.selectRows(payload)
        : selectPayloadRows<D>(payload as { rows?: D[] | null }),
    viewId: spec.viewId,
    columns: core.columns,
    objectIdentity: core.identity,
    showKindDropdown: spec.showKindDropdown,
    diagnosticsLabel,
    ...(spec.defaultSort
      ? { defaultSortKey: spec.defaultSort.key, defaultSortDirection: spec.defaultSort.direction }
      : {}),
    ...(spec.filterOptions ? { filterOptions: spec.filterOptions({ allNamespaces: false }) } : {}),
  });

  const { emptyMessage: buildEmptyMessage } = spec;
  const emptyMessage = useMemo(
    () => resolveEmptyStateMessage(error, buildEmptyMessage('')),
    [buildEmptyMessage, error]
  );

  return (
    <>
      <ResourceInventoryTable
        source={source}
        gridTableProps={gridTableProps}
        spinnerMessage={spec.spinnerMessage}
        favModal={favModal}
        columns={core.columns}
        diagnosticsLabel={diagnosticsLabel}
        diagnosticsMode={spec.diagnosticsMode}
        onRowClick={core.identity.open}
        tableClassName={spec.tableClassName}
        enableContextMenu={true}
        getCustomContextMenuItems={core.getContextMenuItems}
        useShortNames={core.useShortResourceNames}
        emptyMessage={emptyMessage}
      />

      {core.objectActions.modals}
    </>
  );
}

export function NamespaceAggregatedResourceGridView<
  P extends TypedQueryPayload,
  D extends AggregatedRowBase,
>({
  spec,
  namespace,
  showNamespaceColumn = false,
}: {
  spec: AggregatedResourceGridViewSpec<D>;
  namespace: string;
  showNamespaceColumn?: boolean;
}) {
  const core = useAggregatedGridCore(spec);
  const namespaceColumnLink = useNamespaceColumnLink<D>(spec.namespaceLinkTab ?? 'config');

  const allNamespaces = namespace === ALL_NAMESPACES_SCOPE;
  const diagnosticsLabel =
    (allNamespaces ? spec.labels.allNamespaces : spec.labels.namespace) ?? '';

  const columns = useMemo(() => {
    if (!showNamespaceColumn) {
      return core.columns;
    }
    const withNamespace = [...core.columns];
    cf.upsertNamespaceColumn(withNamespace, {
      accessor: (row: D) => row.namespace ?? '',
      sortValue: (row: D) => (row.namespace || '').toLowerCase(),
      ...namespaceColumnLink,
    });
    return withNamespace;
  }, [core.columns, namespaceColumnLink, showNamespaceColumn]);

  const { gridTableProps, favModal, source } = useQueryBackedNamespaceResourceGridTable<P, D>({
    queryTableMode: 'Query Backed Static',
    clusterId: core.selectedClusterId,
    domain: spec.domain,
    label: diagnosticsLabel,
    selectRows: (payload: P) =>
      spec.selectRows
        ? spec.selectRows(payload)
        : selectPayloadRows<D>(payload as { rows?: D[] | null }),
    viewId: spec.viewId,
    namespace,
    columns,
    objectIdentity: core.identity,
    showKindDropdown: spec.showKindDropdown,
    showNamespaceFilters: allNamespaces,
    diagnosticsLabel,
    ...(spec.defaultSort ? { defaultSort: spec.defaultSort } : {}),
    ...(spec.filterOptions ? { filterOptions: spec.filterOptions({ allNamespaces }) } : {}),
  });

  const { emptyMessage: buildEmptyMessage } = spec;
  const emptyMessage = useMemo(
    () =>
      resolveEmptyStateMessage(
        undefined,
        buildEmptyMessage(allNamespaces ? 'in any namespaces' : 'in this namespace')
      ),
    [allNamespaces, buildEmptyMessage]
  );

  return (
    <>
      <ResourceInventoryTable
        source={source}
        gridTableProps={gridTableProps}
        spinnerMessage={spec.spinnerMessage}
        favModal={favModal}
        columns={columns}
        diagnosticsLabel={diagnosticsLabel}
        diagnosticsMode={spec.diagnosticsMode}
        onRowClick={core.identity.open}
        tableClassName={spec.tableClassName}
        enableContextMenu={true}
        getCustomContextMenuItems={core.getContextMenuItems}
        useShortNames={core.useShortResourceNames}
        emptyMessage={emptyMessage}
      />

      {core.objectActions.modals}
    </>
  );
}
