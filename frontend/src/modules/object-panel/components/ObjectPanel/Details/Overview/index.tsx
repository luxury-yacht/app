/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/index.tsx
 *
 * Chooses and renders the correct object overview component for the active
 * Kubernetes resource, including workload-specific HPA management detection.
 */

import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { ActionsMenu } from '@shared/components/kubernetes/ActionsMenu';
import { useNodeMaintenanceActions } from '@shared/hooks/useNodeMaintenanceActions';
import type { ObjectActionData } from '@shared/hooks/useObjectActions';
import { normalizeKind, SCALABLE_KINDS } from '@shared/hooks/useObjectActions';
import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { readWorkloadHPAManagedForRef, requestData } from '@/core/data-access';
import { getOverviewDescriptor } from './descriptorRegistry';
import { OverviewRenderer } from './OverviewRenderer';
import { overviewRegistry } from './registry';
import '../../shared.css';

// Generic props for resources - simplified without external type dependencies
interface GenericOverviewProps {
  kind: string;
  name: string;
  namespace?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  /** Called after a successful delete so the panel can close. */
  onAfterDelete?: () => void;
  /** Called after a successful restart/scale/trigger/suspend so the panel can refetch. */
  onAfterAction?: () => void;
  portForwardAvailable?: boolean;
  [key: string]: unknown; // Allow any additional fields for generic resources
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
  const [hpaManaged, setHpaManaged] = useState<boolean | null>(null);
  const isScalable = SCALABLE_KINDS.includes(normalizeKind(props.kind));
  useEffect(() => {
    const namespace = props.namespace;
    if (!isScalable) {
      setHpaManaged(false);
      return;
    }
    if (!clusterId || !namespace || !props.name || !objectVersion) {
      setHpaManaged(null);
      return;
    }
    let cancelled = false;
    requestData({
      resource: 'workload-hpa-managed',
      reason: 'startup',
      read: () =>
        readWorkloadHPAManagedForRef({
          clusterId,
          namespace,
          group: objectGroup,
          version: objectVersion,
          kind: props.kind,
          name: props.name,
        }),
    })
      .then((result) => {
        if (!cancelled) {
          setHpaManaged(result.status === 'executed' ? Boolean(result.data) : null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHpaManaged(null);
        }
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
    // Descriptor-migrated kinds render from the raw active DTO; the rest fall back to the legacy
    // per-kind component path.
    const descriptor = getOverviewDescriptor(props.kind);
    if (descriptor) {
      return (
        <OverviewRenderer<never>
          descriptor={descriptor}
          data={props.activeDetail as never}
          context={{
            hpaManaged: hpaManaged === true,
            drainInProgress: Boolean(activeDrainJob),
            onOpenDrain,
            clusterId,
            clusterName,
          }}
        />
      );
    }
    // Custom/unregistered kinds use the generic overview, fed the object's generic metadata from
    // the panel's objectData (the source of truth) since there is no per-kind detail to read.
    const od = objectData as Record<string, unknown> | null;
    const meta = (od?.metadata as Record<string, unknown> | undefined) ?? undefined;
    return overviewRegistry.renderComponent({
      ...props,
      group: od?.group,
      status: props.status ?? od?.status,
      labels: props.labels ?? od?.labels ?? meta?.labels,
      annotations: props.annotations ?? od?.annotations ?? meta?.annotations,
      hpaManaged: hpaManaged === true,
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

  const currentScaleReplicas =
    parseDesiredReplicaCount(props.desiredReplicas) ??
    parseDesiredReplicaCount(props.replicas) ??
    parseDesiredReplicaCount(props.ready) ??
    0;

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
      status:
        props.suspend === true
          ? 'Suspended'
          : typeof props.status === 'string'
            ? props.status
            : undefined,
      ready: props.ready !== undefined && props.ready !== null ? String(props.ready) : undefined,
      desiredReplicas: currentScaleReplicas,
      hpaManaged,
      unschedulable: typeof props.unschedulable === 'boolean' ? props.unschedulable : undefined,
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
      currentScaleReplicas,
      hpaManaged,
    ]
  );

  return (
    <div className="object-panel-section">
      <div className="object-panel-section-header">
        <div className="object-panel-section-title">Overview</div>
        <div className="object-panel-section-actions">
          <ActionsMenu
            object={actionObject}
            currentReplicas={currentScaleReplicas}
            hpaManaged={hpaManaged}
            onAfterDelete={props.onAfterDelete}
            onAfterAction={props.onAfterAction}
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
