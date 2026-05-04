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
  portForwardAvailable?: boolean;
  [key: string]: any; // Allow any additional fields for generic resources
}

// Union type using generic props for all resources
type OverviewProps = GenericOverviewProps;

const Overview: React.FC<OverviewProps> = (props) => {
  const { objectData } = useObjectPanel();

  // Get cluster info from objectData (the source of truth for the current object)
  const clusterId = objectData?.clusterId || '';
  const clusterName = objectData?.clusterName || '';

  // Check whether a HPA manages this workload (only for scalable kinds).
  const [hpaManaged, setHpaManaged] = useState(false);
  const isScalable = SCALABLE_KINDS.includes(normalizeKind(props.kind));
  useEffect(() => {
    if (!isScalable || !clusterId || !props.namespace || !props.name) {
      setHpaManaged(false);
      return;
    }
    let cancelled = false;
    requestData({
      resource: 'workload-hpa-managed',
      reason: 'startup',
      read: () => readWorkloadHPAManaged(clusterId, props.namespace!, props.kind, props.name),
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
  }, [clusterId, props.namespace, props.kind, props.name, isScalable]);

  // Use the factory pattern to render the appropriate component.
  // Thread `hpaManaged` through so workload overviews can surface that
  // scaling is autonomous (e.g. in the Pods caption).
  const renderOverviewContent = () => {
    return overviewRegistry.renderComponent({ ...props, hpaManaged });
  };

  // Build object data for ActionsMenu. Group/version come from the panel's
  // objectData (the source of truth) so CRD permission lookups in
  // the shared action controller key off the same GVK as the spec-emit side;
  // without them the Delete action silently disappears for CRDs.
  const objectGroup = objectData?.group ?? undefined;
  const objectVersion = objectData?.version ?? undefined;
  const actionObject: ObjectActionData | null = useMemo(
    () => ({
      kind: props.kind,
      name: props.name,
      namespace: props.namespace,
      clusterId,
      clusterName,
      group: objectGroup ?? undefined,
      version: objectVersion ?? undefined,
      status: props.suspend ? 'Suspended' : props.status,
      portForwardAvailable: props.portForwardAvailable,
    }),
    [
      props.kind,
      props.name,
      props.namespace,
      props.portForwardAvailable,
      props.suspend,
      props.status,
      clusterId,
      clusterName,
      objectGroup,
      objectVersion,
    ]
  );

  return (
    <div className="object-panel-section">
      <div className="object-panel-section-header">
        <div className="object-panel-section-title">Overview</div>
        <div className="object-panel-section-actions">
          <ActionsMenu
            object={actionObject}
            currentReplicas={props.desiredReplicas !== undefined ? props.desiredReplicas : 1}
            actionLoading={props.actionLoading || props.deleteLoading}
            hpaManaged={hpaManaged}
            onRestart={props.onRestart}
            onRollback={props.onRollback}
            onScale={props.onScale}
            onDelete={props.onDelete}
            onTrigger={props.onTrigger}
            onSuspendToggle={props.onSuspendToggle}
          />
        </div>
      </div>

      <div className="object-panel-section-grid">{renderOverviewContent()}</div>
    </div>
  );
};

export default Overview;
