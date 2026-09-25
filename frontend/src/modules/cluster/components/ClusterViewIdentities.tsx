import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import ResourceInventoryTable from '@modules/resource-grid/ResourceInventoryTable';
import { selectPayloadRows } from '@modules/resource-grid/typedResourceQueryScope';
import { useQueryBackedClusterResourceGridTable } from '@modules/resource-grid/useQueryBackedResourceGridTable';
import { ObjectPanelLink } from '@shared/components/ObjectPanelLink';
import Tooltip from '@shared/components/Tooltip';
import * as cf from '@shared/components/tables/columnFactories';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable';
import { useObjectLink } from '@shared/hooks/useObjectLink';
import { buildRequiredObjectReference } from '@shared/utils/objectIdentity';
import { useMemo } from 'react';
import type { ClusterIdentitiesSnapshot, ClusterIdentity } from '@/core/refresh/types';
import './ClusterViewIdentities.css';

const identityKey = (row: ClusterIdentity) =>
  JSON.stringify([row.clusterId, row.kind, row.namespace, row.name]);

function IdentityBindings({ row }: Readonly<{ row: ClusterIdentity }>) {
  const bindings = row.bindings ?? [];
  if (bindings.length === 0) {
    return <span>0</span>;
  }
  return (
    <Tooltip
      trigger="click"
      interactive
      triggerLabel={`Bindings for ${row.name}`}
      closeSignal={row.clusterId}
      content={
        <div className="identity-binding-links">
          {bindings.map((binding) => (
            <ObjectPanelLink
              key={JSON.stringify([
                binding.clusterId,
                binding.kind,
                binding.namespace,
                binding.name,
              ])}
              objectRef={buildRequiredObjectReference(binding)}
            >
              {binding.kind}: {binding.namespace ? `${binding.namespace}/` : ''}
              {binding.name}
            </ObjectPanelLink>
          ))}
        </div>
      }
    >
      <span className="object-panel-link">{bindings.length}</span>
    </Tooltip>
  );
}

const buildColumns = (
  objectLink: ReturnType<typeof useObjectLink>
): GridColumnDefinition<ClusterIdentity>[] =>
  cf.withColumnSizing(
    [
      cf.createKindColumn<ClusterIdentity>({
        getKind: (row) => row.kind,
        ...objectLink<ClusterIdentity>((row) =>
          row.serviceAccount ? buildRequiredObjectReference(row.serviceAccount) : undefined
        ),
        isInteractive: (row) => Boolean(row.serviceAccount),
      }),
      {
        ...cf.createTextColumn<ClusterIdentity>('name', 'Name', (row) => row.name),
        render: (row: ClusterIdentity) =>
          row.serviceAccount ? (
            <ObjectPanelLink objectRef={buildRequiredObjectReference(row.serviceAccount)}>
              {row.name}
            </ObjectPanelLink>
          ) : (
            row.name
          ),
      },
      cf.createTextColumn<ClusterIdentity>('namespace', 'Namespace', (row) => row.namespace || '—'),
      {
        ...cf.createTextColumn<ClusterIdentity>(
          'bindings',
          'Bindings',
          (row) => row.bindings?.length ?? 0
        ),
        render: (row: ClusterIdentity) => <IdentityBindings row={row} />,
      },
      cf.createTextColumn<ClusterIdentity>(
        'grantScopes',
        'Grant scopes',
        (row) => row.grantScopes?.join(', ') || '—'
      ),
    ],
    {
      kind: { autoWidth: true },
      name: { width: 300 },
      namespace: { width: 180 },
      bindings: { autoWidth: true },
      grantScopes: { width: 300 },
    }
  );

const filterOptionOverrides = {
  searchPlaceholder: 'Search identities and bindings...',
  customActions: (
    <Tooltip
      trigger="click"
      triggerLabel="About identities"
      content="Users and groups are derived from visible RBAC bindings, not a complete account directory. Service accounts come from visible Kubernetes objects. Binding counts show direct references; group membership and effective access are not inferred."
    />
  ),
};

export default function ClusterViewIdentities() {
  const { selectedClusterId } = useKubeconfig();
  const objectLink = useObjectLink();
  const columns = useMemo(() => buildColumns(objectLink), [objectLink]);
  const { source, gridTableProps, favModal } = useQueryBackedClusterResourceGridTable<
    ClusterIdentitiesSnapshot,
    ClusterIdentity
  >({
    queryTableMode: 'Query Backed Static',
    supportsCustomMetadataColumns: false,
    clusterId: selectedClusterId,
    domain: 'cluster-identities',
    label: 'Cluster Identities',
    viewId: 'cluster-identities',
    selectRows: selectPayloadRows,
    columns,
    keyExtractor: identityKey,
    showKindDropdown: true,
    showNamespaceFilters: false,
    filterAccessors: { getKind: (row) => row.kind },
    filterOptionOverrides,
    diagnosticsLabel: 'Cluster Identities',
  });
  return (
    <ResourceInventoryTable
      source={source}
      gridTableProps={gridTableProps}
      columns={columns}
      favModal={favModal}
      spinnerMessage="Loading identities..."
      emptyMessage="No identities found in visible bindings or service accounts"
      diagnosticsLabel="Cluster Identities"
    />
  );
}
