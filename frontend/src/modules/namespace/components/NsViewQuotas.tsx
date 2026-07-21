/**
 * frontend/src/modules/namespace/components/NsViewQuotas.tsx
 *
 * UI component for NsViewQuotas.
 * Handles rendering and interactions for the namespace feature.
 */

import {
  type AggregatedResourceGridViewSpec,
  NamespaceAggregatedResourceGridView,
} from '@modules/resource-grid/AggregatedResourceGridView';
import * as cf from '@shared/components/tables/columnFactories';
import React from 'react';
import type { NamespaceQuotasSnapshotPayload } from '@/core/refresh/types';
import { getDisplayKind } from '@/utils/kindAliasMap';

// Data interface for quota resources (ResourceQuotas, LimitRanges, PodDisruptionBudgets)
export interface QuotaData {
  kind: string;
  kindAlias?: string;
  name: string;
  namespace: string;
  clusterId: string;
  clusterName?: string;
  details?: string;
  hard?: Record<string, string | number>;
  used?: Record<string, string | number>;
  limits?: unknown;
  // PDB values can be absolute numbers or percentage strings.
  minAvailable?: string | number;
  maxUnavailable?: string | number;
  currentHealthy?: number;
  desiredHealthy?: number;
  status?: {
    disruptionsAllowed?: number;
    currentHealthy?: number;
    desiredHealthy?: number;
  };
  scopes?: string[];
  age?: string;
}

interface QuotasViewProps {
  namespace: string;
  showNamespaceColumn?: boolean;
}

const quotasSpec: AggregatedResourceGridViewSpec<QuotaData> = {
  domain: 'namespace-quotas',
  viewId: 'namespace-quotas',
  labels: {
    namespace: 'Namespace Quotas',
    allNamespaces: 'All Namespaces Quotas',
  },
  emptyMessage: (scopeSuffix) => `No quota objects found ${scopeSuffix}`,
  spinnerMessage: 'Loading quotas...',
  tableClassName: 'ns-quotas-table',
  defaultSort: { key: 'name', direction: 'asc' },
  showKindDropdown: true,
  namespaceLinkTab: 'quotas',
  getIdentity: (resource) => ({
    kind: resource.kind || resource.kindAlias,
    name: resource.name,
    namespace: resource.namespace,
    clusterId: resource.clusterId,
    clusterName: resource.clusterName ?? undefined,
  }),
  // Keep the quotas table focused on core identity fields.
  buildColumns: ({ identity, useShortResourceNames }) => [
    cf.createKindColumn<QuotaData>({
      key: 'kind',
      getKind: (resource) => resource.kind,
      getAlias: (resource) => resource.kindAlias,
      getDisplayText: (resource) => getDisplayKind(resource.kind, useShortResourceNames),
      onClick: identity.open,
      onAltClick: identity.navigate,
    }),
    cf.createTextColumn<QuotaData>('name', 'Name', {
      onClick: identity.open,
      onAltClick: identity.navigate,
      getClassName: () => 'object-panel-link',
    }),
    cf.createAgeColumn(),
  ],
};

/**
 * GridTable component for namespace quota resources
 * Aggregates ResourceQuotas, LimitRanges, and PodDisruptionBudgets
 */
const QuotasViewGrid: React.FC<QuotasViewProps> = React.memo(
  ({ namespace, showNamespaceColumn = false }) => (
    <NamespaceAggregatedResourceGridView<NamespaceQuotasSnapshotPayload, QuotaData>
      spec={quotasSpec}
      namespace={namespace}
      showNamespaceColumn={showNamespaceColumn}
    />
  )
);

QuotasViewGrid.displayName = 'NsViewQuotas';

export default QuotasViewGrid;
