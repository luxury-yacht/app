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
import { createDetailSegmentsColumn } from '@shared/components/tables/detailSegmentsColumn';
import React from 'react';
import type {
  NamespaceNetworkSnapshotPayload,
  NamespaceNetworkSummary,
} from '@/core/refresh/types';
import { getDisplayKind } from '@/utils/kindAliasMap';

export type NetworkData = NamespaceNetworkSummary & { kindAlias?: string };

interface NetworkViewProps {
  namespace: string;
  showNamespaceColumn?: boolean;
}

const networkSpec: AggregatedResourceGridViewSpec<NetworkData> = {
  domain: 'namespace-network',
  viewId: 'namespace-network',
  supportsCustomMetadataColumns: true,
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
  buildColumns: ({
    identity,
    openReference,
    navigateReference,
    fallbackClusterName,
    useShortResourceNames,
  }) => [
    cf.createKindColumn<NetworkData>({
      key: 'kind',
      getKind: (resource) => resource.ref.kind,
      getAlias: (resource) => resource.kindAlias,
      getDisplayText: (resource) => getDisplayKind(resource.ref.kind, useShortResourceNames),
      onClick: identity.open,
      onAltClick: identity.navigate,
    }),
    cf.createResourceNameColumn<NetworkData>((resource) => resource.ref.name, {
      onClick: identity.open,
      onAltClick: identity.navigate,
      getClassName: () => 'object-panel-link',
    }),
    // Stable concepts keep the mixed-kind table scannable. Each row's segment
    // label supplies the kind-specific meaning (Class, Parent, Type, Ports...).
    createDetailSegmentsColumn<NetworkData>({
      key: 'context',
      header: 'Context',
      slot: 'reference',
      variant: 'text',
      sortable: true,
      getSegments: (resource) => resource.details,
      openReference,
      navigateReference,
      clusterName: fallbackClusterName,
      autoSizeMaxWidth: 260,
    }),
    createDetailSegmentsColumn<NetworkData>({
      key: 'network',
      header: 'Network',
      slot: 'address',
      variant: 'text',
      sortable: true,
      getSegments: (resource) => resource.details,
      autoSizeMaxWidth: 320,
    }),
    createDetailSegmentsColumn<NetworkData>({
      key: 'summary',
      header: 'Summary',
      slot: 'counts',
      variant: 'text',
      getSegments: (resource) => resource.details,
      autoSizeMaxWidth: 280,
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
