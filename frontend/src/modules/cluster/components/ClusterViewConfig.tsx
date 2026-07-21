/**
 * frontend/src/modules/cluster/components/ClusterViewConfig.tsx
 *
 * GridTable view for cluster configuration resources such as Storage Classes,
 * Ingress Classes, and Admission Control resources.
 */

import {
  type AggregatedResourceGridViewSpec,
  ClusterAggregatedResourceGridView,
} from '@modules/resource-grid/AggregatedResourceGridView';
import * as cf from '@shared/components/tables/columnFactories';
import React from 'react';
import type { ClusterConfigEntry, ClusterConfigSnapshotPayload } from '@/core/refresh/types';
import { getDisplayKind } from '@/utils/kindAliasMap';

type ConfigData = ClusterConfigEntry & { kindAlias?: string };

// Define props for ConfigViewGrid component
interface ConfigViewProps {
  error?: string | null;
}

const configSpec: AggregatedResourceGridViewSpec<ConfigData> = {
  domain: 'cluster-config',
  viewId: 'cluster-config',
  labels: { cluster: 'Cluster Configuration' },
  emptyMessage: () => 'No cluster-scoped config objects found',
  spinnerMessage: 'Loading configuration resources...',
  tableClassName: 'gridtable-config',
  showKindDropdown: true,
  buildColumns: ({ identity, useShortResourceNames }) => [
    cf.createKindColumn<ConfigData>({
      key: 'kind',
      getKind: (resource) => resource.kind,
      getAlias: (resource) => resource.kindAlias,
      getDisplayText: (resource) => getDisplayKind(resource.kind, useShortResourceNames),
      onClick: identity.open,
      onAltClick: identity.navigate,
    }),
    cf.createTextColumn<ConfigData>('name', 'Name', (resource) => resource.name, {
      sortable: true,
      onClick: identity.open,
      onAltClick: identity.navigate,
      getClassName: () => 'object-panel-link',
    }),
    cf.createAgeColumn(),
  ],
};

/**
 * GridTable component for cluster configuration resources
 * Displays Storage Classes, Ingress Classes, and Admission Control resources
 */
const ConfigViewGrid: React.FC<ConfigViewProps> = React.memo(({ error }) => (
  <ClusterAggregatedResourceGridView<ClusterConfigSnapshotPayload, ConfigData>
    spec={configSpec}
    error={error}
  />
));

ConfigViewGrid.displayName = 'ClusterViewConfig';

export default ConfigViewGrid;
