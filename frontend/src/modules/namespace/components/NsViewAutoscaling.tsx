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

// Data interface for autoscaling resources
export interface AutoscalingData {
  kind: string;
  kindAlias?: string;
  name: string;
  namespace: string;
  // Multi-cluster metadata used for per-tab actions and stable row keys.
  clusterId: string;
  clusterName?: string;
  // HorizontalPodAutoscaler-specific fields
  scaleTargetRef?: {
    kind: string;
    name: string;
    /**
     * Wire-form apiVersion of the scale target. Threaded from the
     * backend via NamespaceAutoscalingSummary.targetApiVersion so the
     * panel can open CRD scale targets correctly.
     */
    apiVersion?: string;
  };
  target?: string;
  min?: number;
  max?: number;
  current?: number;
  targetCPUUtilizationPercentage?: number;
  metrics?: Array<{
    type: string;
    target: string;
  }>;
  minReplicas?: number;
  maxReplicas?: number;
  currentReplicas?: number;
  // VerticalPodAutoscaler-specific fields
  updatePolicy?: {
    updateMode?: string;
  };
  status?: string;
  age?: string;
  ageTimestamp?: number;
  [key: string]: unknown; // Allow additional fields
}

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
          kind: item.kind,
          kindAlias: item.kind,
          name: item.name,
          namespace: item.namespace,
          clusterId: item.clusterId,
          clusterName: item.clusterName,
          scaleTargetRef,
          target: item.target,
          min: item.min,
          max: item.max,
          current: item.current,
          minReplicas: item.min,
          maxReplicas: item.max,
          currentReplicas: item.current,
          age: item.age,
          ageTimestamp: item.ageTimestamp,
        };
      }
    ),
  getIdentity: (resource) => ({
    kind: resource.kind || resource.kindAlias,
    name: resource.name,
    namespace: resource.namespace,
    clusterId: resource.clusterId,
    clusterName: resource.clusterName ?? undefined,
  }),
  buildColumns: ({
    identity,
    openReference,
    navigateReference,
    fallbackClusterId,
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
            namespace: resource.namespace,
            apiVersion: resource.scaleTargetRef.apiVersion,
            clusterId: resource.clusterId,
            clusterName: resource.clusterName ?? undefined,
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
        getKind: (resource) => resource.kind,
        getAlias: (resource) => resource.kindAlias,
        getDisplayText: (resource) =>
          getDisplayKind(
            resource.kind || resource.kindAlias || 'Autoscaler',
            useShortResourceNames
          ),
        onClick: identity.open,
        onAltClick: identity.navigate,
      }),
      cf.createTextColumn<AutoscalingData>('name', 'Name', {
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
          if (resource.kind === 'HorizontalPodAutoscaler') {
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
            resource.kind === 'HorizontalPodAutoscaler' ? 'replica-range' : undefined,
        }
      ),
      cf.createTextColumn<AutoscalingData>(
        'current',
        'Current',
        (resource) => {
          if (resource.kind === 'HorizontalPodAutoscaler') {
            const current = resource.currentReplicas ?? resource.current;
            return `${current !== undefined && current !== null ? current : 0}`;
          }
          if (resource.kind === 'VerticalPodAutoscaler') {
            return resource.status || 'Unknown';
          }
          return '-';
        },
        {
          alignHeader: 'center',
          alignData: 'center',
          getClassName: (resource) => {
            if (resource.kind === 'HorizontalPodAutoscaler') {
              return 'current-replicas';
            }
            if (resource.kind === 'VerticalPodAutoscaler') {
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
