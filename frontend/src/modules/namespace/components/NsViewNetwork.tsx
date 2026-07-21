/**
 * frontend/src/modules/namespace/components/NsViewNetwork.tsx
 *
 * UI component for NsViewNetwork.
 * Handles rendering and interactions for the namespace feature.
 */

import {
  type AggregatedResourceGridViewSpec,
  NamespaceAggregatedResourceGridView,
} from '@modules/resource-grid/AggregatedResourceGridView';
import * as cf from '@shared/components/tables/columnFactories';
import React from 'react';
import type { NamespaceNetworkSnapshotPayload } from '@/core/refresh/types';
import { getDisplayKind } from '@/utils/kindAliasMap';

// Data interface for network resources
export interface NetworkData {
  kind: string;
  kindAlias?: string;
  name: string;
  namespace: string;
  clusterId: string;
  clusterName?: string;
  details: string; // Pre-formatted details from backend
  age?: string;
}

interface NetworkViewProps {
  namespace: string;
  showNamespaceColumn?: boolean;
}

const networkSpec: AggregatedResourceGridViewSpec<NetworkData> = {
  domain: 'namespace-network',
  viewId: 'namespace-network',
  labels: {
    namespace: 'Namespace Network',
    allNamespaces: 'All Namespaces Network',
  },
  emptyMessage: (scopeSuffix) => `No network objects found ${scopeSuffix}`,
  spinnerMessage: 'Loading network resources...',
  tableClassName: 'ns-network-table',
  defaultSort: { key: 'name', direction: 'asc' },
  showKindDropdown: true,
  namespaceLinkTab: 'network',
  getIdentity: (resource) => ({
    kind: resource.kind || resource.kindAlias,
    name: resource.name,
    namespace: resource.namespace,
    clusterId: resource.clusterId,
    clusterName: resource.clusterName ?? undefined,
  }),
  buildColumns: ({ identity, useShortResourceNames }) => [
    cf.createKindColumn<NetworkData>({
      key: 'kind',
      getKind: (resource) => resource.kind,
      getAlias: (resource) => resource.kindAlias,
      getDisplayText: (resource) => getDisplayKind(resource.kind, useShortResourceNames),
      onClick: identity.open,
      onAltClick: identity.navigate,
    }),
    cf.createTextColumn<NetworkData>('name', 'Name', {
      onClick: identity.open,
      onAltClick: identity.navigate,
      getClassName: () => 'object-panel-link',
    }),
    cf.createTextColumn<NetworkData>('details', 'Details', (resource) => resource.details || '-', {
      getClassName: (resource) => (resource.details ? 'network-details' : undefined),
      sortable: false,
    }),
    cf.createAgeColumn(),
  ],
};

/**
 * GridTable component for namespace network configuration resources
 * Aggregates Services, Ingresses, NetworkPolicies, etc.
 */
const NetworkViewGrid: React.FC<NetworkViewProps> = React.memo(
  ({ namespace, showNamespaceColumn = false }) => (
    <NamespaceAggregatedResourceGridView<NamespaceNetworkSnapshotPayload, NetworkData>
      spec={networkSpec}
      namespace={namespace}
      showNamespaceColumn={showNamespaceColumn}
    />
  )
);

NetworkViewGrid.displayName = 'NsViewNetwork';

export default NetworkViewGrid;
