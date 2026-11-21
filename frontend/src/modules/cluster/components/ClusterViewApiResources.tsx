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
import { buildClusterScopedKey } from '@shared/components/tables/GridTable.utils';
import { buildRequiredObjectReference } from '@shared/utils/objectIdentity';
import { useMemo } from 'react';
import type { ClusterAPIResourceEntry, ClusterAPIResourcesSnapshot } from '@/core/refresh/types';

type ObjectPanelOpeners = Pick<
  ReturnType<typeof useObjectPanel>,
  'openWithObject' | 'openWithApiResource'
>;

// Group and plural identify a kind within a cluster.
const apiResourceKey = (row: ClusterAPIResourceEntry) =>
  buildClusterScopedKey(row, JSON.stringify([row.group, row.resource]));

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
        version: row.version,
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

export default function ClusterViewApiResources() {
  const { selectedClusterId } = useKubeconfig();
  const { openWithObject, openWithApiResource } = useObjectPanel();
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
