/**
 * frontend/src/modules/cluster/components/ClusterViewApiResources.tsx
 *
 * GridTable view of every kind the cluster serves, built-in and custom: the
 * app's `kubectl api-resources`. Rows describe kinds, not objects. A custom
 * kind opens the CustomResourceDefinition that defines it; a built-in kind
 * opens the kind panel.
 */

import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import ResourceInventoryTable from '@modules/resource-grid/ResourceInventoryTable';
import { selectPayloadRows } from '@modules/resource-grid/typedResourceQueryScope';
import { useQueryBackedClusterResourceGridTable } from '@modules/resource-grid/useQueryBackedResourceGridTable';
import * as cf from '@shared/components/tables/columnFactories';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable';
import { DEFAULT_GRID_TABLE_FILTER_STATE } from '@shared/components/tables/gridTableFilterState';
import { requestGridTableFilters } from '@shared/components/tables/hooks/gridTableFilterRequest';
import type { GridTableFocusRequest } from '@shared/components/tables/hooks/gridTableFocusRequest';
import { resolveBuiltinGroupVersion } from '@shared/constants/builtinGroupVersions';
import {
  buildRequiredCanonicalObjectRowKey,
  buildRequiredObjectReference,
} from '@shared/utils/objectIdentity';
import { useCallback, useMemo } from 'react';
import { useViewState } from '@/core/contexts/ViewStateContext';
import type { ClusterAPIResourceEntry, ClusterAPIResourcesSnapshot } from '@/core/refresh/types';

type ObjectPanelOpeners = Pick<
  ReturnType<typeof useObjectPanel>,
  'openWithObject' | 'openWithApiResource'
>;

const DEFINITION_KIND = 'CustomResourceDefinition';

// Every row is keyed as the CustomResourceDefinition that defines its kind, or
// would: a definition is named `<plural>.<group>`, which also identifies the
// kind within its cluster. "Show in list" on a definition then finds the row
// by the object's own key. The key does not depend on `row.definition`, which
// is absent until the cluster's definitions have been read, so the row keeps
// its key, and a focus request finds it, before and after.
const apiResourceKey = (row: ClusterAPIResourceEntry) =>
  buildRequiredCanonicalObjectRowKey({
    clusterId: row.clusterId,
    ...resolveBuiltinGroupVersion(DEFINITION_KIND),
    kind: DEFINITION_KIND,
    name: row.group ? `${row.resource}.${row.group}` : row.resource,
  });

const buildColumns = ({
  openWithObject,
  openWithApiResource,
}: ObjectPanelOpeners): GridColumnDefinition<ClusterAPIResourceEntry>[] => {
  const links = {
    onClick: (row: ClusterAPIResourceEntry) => {
      if (row.definition) {
        openWithObject(buildRequiredObjectReference(row.definition));
        return;
      }
      openWithApiResource({
        targetType: 'api-resource',
        clusterId: row.clusterId,
        group: row.group,
        kind: row.kind,
        resource: row.resource,
      });
    },
  };
  return cf.withColumnSizing(
    [
      cf.createKindColumn<ClusterAPIResourceEntry>({ getKind: (row) => row.kind, ...links }),
      cf.createResourceNameColumn<ClusterAPIResourceEntry>((row) => row.resource, {
        sortable: true,
        ...links,
        getTitle: (row) => `Open ${row.resource}`,
        getClassName: () => 'object-panel-link',
      }),
      cf.createTextColumn<ClusterAPIResourceEntry>(
        'shortNames',
        'Short Names',
        (row) => row.shortNames?.join(', ') || '-'
      ),
      cf.createTextColumn<ClusterAPIResourceEntry>(
        'apiVersion',
        'API Version',
        (row) => row.apiVersion
      ),
      cf.createTextColumn<ClusterAPIResourceEntry>('scope', 'Scope', (row) => row.scope),
      cf.createTextColumn<ClusterAPIResourceEntry>('type', 'Type', (row) => row.type || '-'),
    ],
    {
      kind: { autoWidth: true },
      name: { autoWidth: true },
      shortNames: { autoWidth: true },
      apiVersion: { autoWidth: true },
      scope: { autoWidth: true },
      type: { autoWidth: true },
    }
  );
};

// The cluster Browse table's view id (BrowseView.tsx).
const BROWSE_VIEW_ID = 'browse';

export default function ClusterViewApiResources() {
  const { selectedClusterId } = useKubeconfig();
  const { openWithObject, openWithApiResource } = useObjectPanel();
  const { setActiveClusterView } = useViewState();
  // "Show in list" on a CustomResourceDefinition lands on the kind it defines.
  // A definition with no row defines no kind the cluster serves (it is not
  // Established), but it is still an object, and Browse lists objects. Hand the
  // request to Browse narrowed to that definition, so what Browse shows is the
  // answer: its row, or nothing when the definition really is gone.
  const showDefinitionInBrowse = useCallback(
    (request: GridTableFocusRequest) => {
      requestGridTableFilters({
        clusterId: request.clusterId,
        destinationViewId: BROWSE_VIEW_ID,
        filters: {
          ...DEFAULT_GRID_TABLE_FILTER_STATE,
          search: request.name,
          kinds: { mode: 'some', values: [request.kind] },
        },
      });
      setActiveClusterView('browse');
      return true;
    },
    [setActiveClusterView]
  );
  const columns = useMemo(
    () => buildColumns({ openWithObject, openWithApiResource }),
    [openWithObject, openWithApiResource]
  );
  const { source, gridTableProps, favModal } = useQueryBackedClusterResourceGridTable<
    ClusterAPIResourcesSnapshot,
    ClusterAPIResourceEntry
  >({
    queryTableMode: 'Query Backed Static',
    supportsCustomMetadataColumns: false,
    clusterId: selectedClusterId,
    domain: 'cluster-api-resources',
    label: 'API Resources',
    viewId: 'cluster-api-resources',
    selectRows: selectPayloadRows,
    columns,
    keyExtractor: apiResourceKey,
    // Rows are kinds; the Type and Scope filters come from the query.
    showKindDropdown: false,
    showNamespaceFilters: false,
    filterAccessors: { getKind: (row) => row.kind },
    diagnosticsLabel: 'API Resources',
    onFocusTargetNotListed: showDefinitionInBrowse,
  });
  return (
    <ResourceInventoryTable
      source={source}
      gridTableProps={gridTableProps}
      columns={columns}
      favModal={favModal}
      spinnerMessage="Loading API resources..."
      emptyMessage="No API resources found"
      diagnosticsLabel="API Resources"
    />
  );
}
