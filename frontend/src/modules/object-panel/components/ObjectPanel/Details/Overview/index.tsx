/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/index.tsx
 *
 * Re-exports public APIs for the object panel feature.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { readWorkloadHPAManaged, requestData } from '@/core/data-access';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { overviewRegistry } from './registry';
import { ActionsMenu } from '@shared/components/kubernetes/ActionsMenu';
import type { ObjectActionData } from '@shared/hooks/useObjectActions';
import { SCALABLE_KINDS, normalizeKind } from '@shared/hooks/useObjectActions';
import { useNodeMaintenanceActions } from '@shared/hooks/useNodeMaintenanceActions';
import '../../shared.css';

// Generic props for resources - simplified without external type dependencies
interface GenericOverviewProps {
  kind: string;
  name: string;
  namespace?: string;
  age?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  onRestart?: () => void;
  onRollback?: () => void;
  onScale?: (replicas: number) => void;
  onDelete?: () => void;
  onTrigger?: () => void;
  onSuspendToggle?: () => void;
  onCordon?: () => void;
  onDrain?: () => void;
  portForwardAvailable?: boolean;
  [key: string]: any; // Allow any additional fields for generic resources
}

// Union type using generic props for all resources
type OverviewProps = GenericOverviewProps;

const clampReplicas = (value: number): number => Math.max(0, Math.min(9999, value));

const parseDesiredReplicaCount = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return clampReplicas(value);
  }
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const segments = trimmed.split('/');
  const candidate = Number.parseInt(segments[segments.length - 1]?.trim() ?? '', 10);
  return Number.isFinite(candidate) ? clampReplicas(candidate) : null;
};

const Overview: React.FC<OverviewProps> = (props) => {
  const { objectData } = useObjectPanel();

  // Get cluster info from objectData (the source of truth for the current object)
  const clusterId = objectData?.clusterId || '';
  const clusterName = objectData?.clusterName || '';
  const objectGroup = objectData?.group ?? '';
  const objectVersion = objectData?.version ?? '';

  // Check whether a HPA manages this workload (only for scalable kinds).
  const [hpaManaged, setHpaManaged] = useState(false);
  const isScalable = SCALABLE_KINDS.includes(normalizeKind(props.kind));
  useEffect(() => {
    if (!isScalable || !clusterId || !props.namespace || !props.name || !objectVersion) {
      setHpaManaged(false);
      return;
    }
    let cancelled = false;
    requestData({
      resource: 'workload-hpa-managed',
      reason: 'startup',
      read: () =>
        readWorkloadHPAManaged(
          clusterId,
          props.namespace!,
          objectGroup,
          objectVersion,
          props.kind,
          props.name
        ),
    })
      .then((result) => {
        if (!cancelled) {
          setHpaManaged(result.status === 'executed' ? Boolean(result.data) : false);
        }
      })
      .catch(() => {
        if (!cancelled) setHpaManaged(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clusterId, props.namespace, props.kind, props.name, objectGroup, objectVersion, isScalable]);

  const isNode = normalizeKind(props.kind) === 'Node';
  const watchClusterIds = useMemo(
    () => (isNode && clusterId ? [clusterId] : undefined),
    [isNode, clusterId]
  );
  const nodeMaintenance = useNodeMaintenanceActions({ watchClusterIds });
  const activeDrainJob = isNode ? nodeMaintenance.activeDrainFor(clusterId, props.name) : null;
  const onOpenDrain =
    isNode && clusterId && props.name
      ? () =>
          nodeMaintenance.openDrainFor({
            clusterId,
            clusterName,
            name: props.name,
            unschedulable: Boolean(props.unschedulable),
          })
      : undefined;

  // Use the factory pattern to render the appropriate component.
  // Thread `hpaManaged` through so workload overviews can surface that
  // scaling is autonomous (e.g. in the Pods caption). Node overviews also
  // get the drain-in-progress signal so they can render the inline icon.
  const renderOverviewContent = () => {
    return overviewRegistry.renderComponent({
      ...props,
      hpaManaged,
      drainInProgress: Boolean(activeDrainJob),
      onOpenDrain,
    });
  };

  const handleCordon = isNode
    ? () =>
        nodeMaintenance.openCordonFor({
          clusterId,
          clusterName,
          name: props.name,
          unschedulable: Boolean(props.unschedulable),
        })
    : undefined;

  // Build object data for ActionsMenu. Group/version come from the panel's
  // objectData (the source of truth) so CRD permission lookups in
  // the shared action controller key off the same GVK as the spec-emit side;
  // without them the Delete action silently disappears for CRDs.
  const actionObject: ObjectActionData | null = useMemo(
    () => ({
      kind: props.kind,
      name: props.name,
      namespace: props.namespace,
      clusterId,
      clusterName,
      group: objectGroup || undefined,
      version: objectVersion || undefined,
      status: props.suspend ? 'Suspended' : props.status,
      ready: props.ready !== undefined && props.ready !== null ? String(props.ready) : undefined,
      unschedulable: props.unschedulable,
      portForwardAvailable: props.portForwardAvailable,
    }),
    [
      props.kind,
      props.name,
      props.namespace,
      props.portForwardAvailable,
      props.ready,
      props.suspend,
      props.status,
      props.unschedulable,
      clusterId,
      clusterName,
      objectGroup,
      objectVersion,
    ]
  );

  const currentScaleReplicas =
    parseDesiredReplicaCount(props.desiredReplicas) ??
    parseDesiredReplicaCount(props.replicas) ??
    parseDesiredReplicaCount(props.ready) ??
    0;

  return (
    <div className="object-panel-section">
      <div className="object-panel-section-header">
        <div className="object-panel-section-title">Overview</div>
        <div className="object-panel-section-actions">
          <ActionsMenu
            object={actionObject}
            currentReplicas={currentScaleReplicas}
            actionLoading={props.actionLoading || props.deleteLoading}
            hpaManaged={hpaManaged}
            onRestart={props.onRestart}
            onRollback={props.onRollback}
            onScale={props.onScale}
            onDelete={props.onDelete}
            onTrigger={props.onTrigger}
            onSuspendToggle={props.onSuspendToggle}
            onCordon={handleCordon}
            onDrain={onOpenDrain}
          />
        </div>
      </div>

      <div className="object-panel-section-grid">{renderOverviewContent()}</div>
      {isNode && nodeMaintenance.modals}
    </div>
  );
};

export default Overview;
