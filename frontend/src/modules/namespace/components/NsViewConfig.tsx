/**
 * frontend/src/modules/namespace/components/NsViewConfig.tsx
 *
 * UI component for NsViewConfig.
 * Handles rendering and interactions for the namespace feature.
 */

import {
  type AggregatedResourceGridViewSpec,
  createAggregatedIdentityColumns,
  NamespaceAggregatedResourceGridView,
} from '@modules/resource-grid/AggregatedResourceGridView';
import * as cf from '@shared/components/tables/columnFactories';
import React from 'react';
import type { NamespaceConfigSnapshotPayload, NamespaceConfigSummary } from '@/core/refresh/types';

export type ConfigData = NamespaceConfigSummary & { kindAlias?: string };

interface ConfigViewProps {
  namespace: string;
  showNamespaceColumn?: boolean;
}

const configSpec: AggregatedResourceGridViewSpec<ConfigData> = {
  domain: 'namespace-config',
  viewId: 'namespace-config',
  supportsCustomMetadataColumns: true,
  labels: {
    namespace: 'Namespace Configuration',
    allNamespaces: 'All Namespaces Configuration',
  },
  emptyMessage: (scopeSuffix) => `No config objects found ${scopeSuffix}`,
  spinnerMessage: 'Loading configuration resources...',
  tableClassName: 'ns-config-table',
  defaultSort: { key: 'name', direction: 'asc' },
  showKindDropdown: true,
  namespaceLinkTab: 'config',
  buildColumns: ({ identity, useShortResourceNames }) => [
    ...createAggregatedIdentityColumns<ConfigData>({ identity, useShortResourceNames }),
    cf.createTextColumn<ConfigData>(
      'data',
      'Data Items',
      (resource) => {
        const count = resource.data || 0;
        return `${count} ${count === 1 ? 'item' : 'items'}`;
      },
      {
        getClassName: () => 'data-count',
      }
    ),
    cf.createAgeColumn(),
  ],
};

/**
 * GridTable component for namespace configuration resources
 * Aggregates ConfigMaps and Secrets
 */
const ConfigViewGrid: React.FC<ConfigViewProps> = React.memo(
  ({ namespace, showNamespaceColumn = false }) => (
    <NamespaceAggregatedResourceGridView<NamespaceConfigSnapshotPayload, ConfigData>
      spec={configSpec}
      namespace={namespace}
      showNamespaceColumn={showNamespaceColumn}
    />
  )
);

ConfigViewGrid.displayName = 'NsViewConfig';

export default ConfigViewGrid;
