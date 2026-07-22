/**
 * frontend/src/modules/namespace/components/NsViewAutoscaling.tsx
 *
 * UI component for NsViewAutoscaling.
 * Handles rendering and interactions for the namespace feature.
 */

import {
  type AggregatedResourceGridViewSpec,
  NamespaceAggregatedResourceGridView,
} from '@modules/resource-grid/AggregatedResourceGridView';
import * as cf from '@shared/components/tables/columnFactories';
import { parseAutoscalingTarget } from '@shared/resources/resourceDescriptorSelectors';
import { buildRequiredRelatedObjectReference } from '@shared/utils/objectIdentity';
import React from 'react';
import type {
  NamespaceAutoscalingSnapshotPayload,
  NamespaceAutoscalingSummary,
} from '@/core/refresh/types';
import { getDisplayKind } from '@/utils/kindAliasMap';

export type AutoscalingData = NamespaceAutoscalingSummary & {
  kindAlias?: string;
  scaleTargetRef?: {
    kind: string;
    name: string;
    apiVersion?: string;
  };
  minReplicas?: number;
  maxReplicas?: number;
  currentReplicas?: number;
  status?: string;
};

interface AutoscalingViewProps {
  namespace: string;
  showNamespaceColumn?: boolean;
}

const autoscalingSpec: AggregatedResourceGridViewSpec<AutoscalingData> = {
  domain: 'namespace-autoscaling',
  viewId: 'namespace-autoscaling',
  labels: {
    namespace: 'Namespace Autoscaling',
    allNamespaces: 'All Namespaces Autoscaling',
  },
  emptyMessage: (scopeSuffix) => `No autoscaling objects found ${scopeSuffix}`,
  spinnerMessage: 'Loading autoscaling resources...',
  tableClassName: 'ns-autoscaling-table',
  defaultSort: { key: 'name', direction: 'asc' },
  showKindDropdown: true,
  namespaceLinkTab: 'autoscaling',
  diagnosticsMode: 'live',
  filterOptions: ({ allNamespaces }) => ({ isNamespaceScoped: !allNamespaces }),
  selectRows: (payload) =>
    ((payload as NamespaceAutoscalingSnapshotPayload).rows ?? []).map(
      (item: NamespaceAutoscalingSummary) => {
        const scaleTargetRef = parseAutoscalingTarget(item.target, item.targetApiVersion);
        return {
          ...item,
          kindAlias: item.ref.kind,
          scaleTargetRef,
          minReplicas: item.min,
          maxReplicas: item.max,
          currentReplicas: item.current,
        };
      }
    ),
  buildColumns: ({
    identity,
    openReference,
    navigateReference,
    fallbackClusterId,
    fallbackClusterName,
    useShortResourceNames,
  }) => {
    const buildScaleTargetReference = (resource: AutoscalingData) => {
      if (!resource.scaleTargetRef) {
        return null;
      }
      try {
        return buildRequiredRelatedObjectReference(
          {
            kind: resource.scaleTargetRef.kind,
            name: resource.scaleTargetRef.name,
            namespace: resource.ref.namespace,
            apiVersion: resource.scaleTargetRef.apiVersion,
            clusterId: resource.ref.clusterId,
            clusterName: fallbackClusterName || undefined,
          },
          { fallbackClusterId }
        );
      } catch {
        return null;
      }
    };

    return [
      cf.createKindColumn<AutoscalingData>({
        key: 'kind',
        getKind: (resource) => resource.ref.kind,
        getAlias: (resource) => resource.kindAlias,
        getDisplayText: (resource) =>
          getDisplayKind(
            resource.ref.kind || resource.kindAlias || 'Autoscaler',
            useShortResourceNames
          ),
        onClick: identity.open,
        onAltClick: identity.navigate,
      }),
      cf.createTextColumn<AutoscalingData>('name', 'Name', (resource) => resource.ref.name, {
        onClick: identity.open,
        onAltClick: identity.navigate,
        getClassName: () => 'object-panel-link',
      }),
      cf.createTextColumn<AutoscalingData>(
        'scaleTarget',
        'Scale Target',
        (resource) => {
          if (resource.scaleTargetRef) {
            const ref = resource.scaleTargetRef;
            return `${ref.kind}/${ref.name}`;
          }
          if (resource.target) {
            return resource.target;
          }
          return '-';
        },
        {
          onClick: (resource) => {
            const targetRef = buildScaleTargetReference(resource);
            if (targetRef) {
              openReference(targetRef);
            }
          },
          onAltClick: (resource) => {
            const targetRef = buildScaleTargetReference(resource);
            if (targetRef) {
              navigateReference(targetRef);
            }
          },
          isInteractive: (resource) => Boolean(resource.scaleTargetRef),
          getClassName: (resource) =>
            ['scale-reference', resource.scaleTargetRef ? 'object-panel-link' : undefined]
              .filter(Boolean)
              .join(' '),
        }
      ),
      cf.createTextColumn<AutoscalingData>(
        'replicas',
        'Min/Max',
        (resource) => {
          if (resource.ref.kind === 'HorizontalPodAutoscaler') {
            const minValue = resource.minReplicas ?? resource.min;
            const min = minValue !== undefined && minValue !== null ? minValue : 1;
            const maxValue = resource.maxReplicas ?? resource.max;
            return `${min}/${maxValue !== undefined && maxValue !== null ? maxValue : '-'}`;
          }
          return '-';
        },
        {
          alignHeader: 'center',
          alignData: 'center',
          getClassName: (resource) =>
            resource.ref.kind === 'HorizontalPodAutoscaler' ? 'replica-range' : undefined,
        }
      ),
      cf.createTextColumn<AutoscalingData>(
        'current',
        'Current',
        (resource) => {
          if (resource.ref.kind === 'HorizontalPodAutoscaler') {
            const current = resource.currentReplicas ?? resource.current;
            return `${current !== undefined && current !== null ? current : 0}`;
          }
          if (resource.ref.kind === 'VerticalPodAutoscaler') {
            return resource.status || 'Unknown';
          }
          return '-';
        },
        {
          alignHeader: 'center',
          alignData: 'center',
          getClassName: (resource) => {
            if (resource.ref.kind === 'HorizontalPodAutoscaler') {
              return 'current-replicas';
            }
            if (resource.ref.kind === 'VerticalPodAutoscaler') {
              const status = resource.status || 'Unknown';
              return `vpa-status ${status.toLowerCase()}`;
            }
            return undefined;
          },
        }
      ),
      cf.createAgeColumn(),
    ];
  },
};

/**
 * GridTable component for namespace autoscaling resources
 * Aggregates HorizontalPodAutoscalers and VerticalPodAutoscalers
 */
const AutoscalingViewGrid: React.FC<AutoscalingViewProps> = React.memo(
  ({ namespace, showNamespaceColumn = false }) => (
    <NamespaceAggregatedResourceGridView<NamespaceAutoscalingSnapshotPayload, AutoscalingData>
      spec={autoscalingSpec}
      namespace={namespace}
      showNamespaceColumn={showNamespaceColumn}
    />
  )
);

AutoscalingViewGrid.displayName = 'NsViewAutoscaling';

export default AutoscalingViewGrid;
