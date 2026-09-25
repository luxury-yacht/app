import { boundedRowsSource } from '@modules/resource-grid/boundedRowsSource';
import ResourceInventoryTable from '@modules/resource-grid/ResourceInventoryTable';
import { useObjectPanelResourceGridTable } from '@modules/resource-grid/useResourceGridTable';
import { ErrorSurface } from '@shared/components/errors/ErrorSurface';
import * as cf from '@shared/components/tables/columnFactories';
import { useObjectLink } from '@shared/hooks/useObjectLink';
import {
  buildRequiredCanonicalObjectRowKey,
  buildRequiredObjectReference,
} from '@shared/utils/objectIdentity';
import { useMemo } from 'react';
import { useClusterNameResolver } from '@/core/cluster-workspace/useClusterWorkspace';
import type { ClusterIdentityBinding } from '@/core/refresh/types';
import { OverviewItem } from '../components/ObjectPanel/Details/Overview/shared/OverviewItem';
import type { IdentityPanelRef } from '../panelTarget';
import { useIdentityDetails } from './useIdentityDetails';

const noBindings: ClusterIdentityBinding[] = [];

export function IdentityDetails({
  identity,
  enabled,
}: Readonly<{ identity: IdentityPanelRef; enabled: boolean }>) {
  const query = useIdentityDetails(identity, enabled);
  const subject = query.rows[0];
  const bindings = subject?.bindings ?? noBindings;
  const partial = query.payload?.completeness === 'partial';
  const objectLink = useObjectLink();
  const resolveClusterName = useClusterNameResolver();
  const columns = useMemo(
    () => [
      cf.createKindColumn<ClusterIdentityBinding>({
        getKind: (row) => row.kind,
        ...objectLink<ClusterIdentityBinding>((row) => buildRequiredObjectReference(row)),
      }),
      cf.createTextColumn<ClusterIdentityBinding>('name', 'Name', (row) => row.name, {
        ...objectLink<ClusterIdentityBinding>((row) => buildRequiredObjectReference(row)),
        getClassName: () => 'object-panel-link',
      }),
      cf.createTextColumn<ClusterIdentityBinding>(
        'namespace',
        'Scope',
        (row) => row.namespace || 'Cluster-wide'
      ),
      cf.createTextColumn<ClusterIdentityBinding>(
        'role',
        'Role',
        (row) => (row.role ? `${row.role.kind}: ${row.role.name}` : '—'),
        {
          ...objectLink<ClusterIdentityBinding>((row) =>
            row.role ? buildRequiredObjectReference(row.role) : undefined
          ),
          isInteractive: (row) => Boolean(row.role),
          getClassName: (row) => (row.role ? 'object-panel-link' : ''),
        }
      ),
    ],
    [objectLink]
  );
  const { gridTableProps } = useObjectPanelResourceGridTable<ClusterIdentityBinding>({
    viewId: 'object-panel-identity-bindings',
    clusterIdentity: identity.clusterId,
    enabled,
    tableMode: partial ? 'Local Partial' : 'Local Complete',
    supportsCustomMetadataColumns: false,
    data: bindings,
    columns,
    keyExtractor: (row) => buildRequiredCanonicalObjectRowKey(row),
    filterAccessors: { getKind: (row) => row.kind, getNamespace: (row) => row.namespace },
    diagnosticsLabel: 'Identity bindings',
  });
  return (
    <div className="details-content">
      <div className="object-panel-section">
        <div className="object-panel-section-grid">
          <OverviewItem
            label="Cluster"
            value={resolveClusterName(identity.clusterId) ?? identity.clusterId}
          />
          <OverviewItem
            label="Direct bindings"
            value={query.loaded && !query.error ? bindings.length : '—'}
          />
          <OverviewItem
            label="Grant scopes"
            value={subject?.grantScopes?.join(', ') || '—'}
            fullWidth
          />
        </div>
      </div>
      {partial && (
        <p role="status">
          {query.filterOptions.partialDataLabel ||
            'Some binding sources are unavailable. Only visible bindings are shown.'}
        </p>
      )}
      {!!query.error && (
        <p role="alert">
          <ErrorSurface kind="reported" message={query.error} />
        </p>
      )}
      <div className="object-panel-section">
        <h3 className="object-panel-section-title">Direct bindings</h3>
        <ResourceInventoryTable
          embedded
          source={boundedRowsSource({
            rows: bindings,
            loading: query.loading,
            loaded: query.loaded,
            error: query.error,
            mode: partial ? 'Local Partial' : 'Local Complete',
            partialLabel: query.filterOptions.partialDataLabel,
            cacheKey: JSON.stringify([identity.clusterId, identity.kind, identity.name]),
          })}
          gridTableProps={gridTableProps}
          columns={columns}
          spinnerMessage="Loading identity bindings..."
          emptyMessage="No direct bindings found in visible resources"
          diagnosticsLabel="Identity bindings"
        />
      </div>
    </div>
  );
}
