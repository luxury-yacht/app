/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/index.tsx
 *
 * Barrel exports for Overview.
 * Re-exports public APIs for the object panel feature.
 */

import React, { useMemo } from 'react';
import { useDetailsSectionContext } from '@/core/contexts/ObjectPanelDetailsSectionContext';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { overviewRegistry, getResourceCapabilities } from './registry';
import { ActionsMenu } from '@shared/components/kubernetes/ActionsMenu';
import '../../shared.css';

// Generic props for resources - simplified without external type dependencies
interface GenericOverviewProps {
  kind: string;
  name: string;
  namespace?: string;
  age?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  canRestart?: boolean;
  canScale?: boolean;
  canDelete?: boolean;
  canTrigger?: boolean;
  canSuspend?: boolean;
  restartDisabledReason?: string;
  scaleDisabledReason?: string;
  deleteDisabledReason?: string;
  onRestart?: () => void;
  onScale?: (replicas: number) => void;
  onDelete?: () => void;
  onTrigger?: () => void;
  onSuspendToggle?: () => void;
  [key: string]: any; // Allow any additional fields for generic resources
}

// Union type using generic props for all resources
type OverviewProps = GenericOverviewProps;

const Overview: React.FC<OverviewProps> = (props) => {
  const { sectionStates, setSectionExpanded } = useDetailsSectionContext();
  const { objectData } = useObjectPanel();
  const expanded = sectionStates.overview;

  // Get cluster info from objectData (the source of truth for the current object)
  const clusterId = objectData?.clusterId || '';
  const clusterName = objectData?.clusterName || '';

  // Use the factory pattern to render the appropriate component
  const renderOverviewContent = () => {
    return overviewRegistry.renderComponent(props);
  };

  // Get capabilities for this resource type
  const capabilities = getResourceCapabilities(props.kind);
  const canRestart = props.canRestart ?? capabilities?.restart;
  const canScale = props.canScale ?? capabilities?.scale;
  const canDelete = props.canDelete ?? capabilities?.delete;
  const canTrigger = props.canTrigger ?? capabilities?.trigger;
  const canSuspend = props.canSuspend ?? capabilities?.suspend;

  // Determine if port forwarding is available for this resource type
  const portForwardableKinds = ['Pod', 'Deployment', 'StatefulSet', 'DaemonSet', 'Service'];
  const canPortForward = portForwardableKinds.includes(props.kind);

  // Memoize portForwardTarget to prevent re-fetching ports on every render
  const portForwardTarget = useMemo(
    () =>
      canPortForward
        ? {
            kind: props.kind,
            name: props.name,
            namespace: props.namespace || '',
            clusterId,
            clusterName,
            ports: [],
          }
        : undefined,
    [canPortForward, props.kind, props.name, props.namespace, clusterId, clusterName]
  );

  return (
    <div className="object-panel-section">
      <div className="object-panel-section-header">
        <div
          className={`object-panel-section-title collapsible${!expanded ? ' collapsed' : ''}`}
          onClick={() => setSectionExpanded('overview', !expanded)}
        >
          <span className="collapse-icon">{expanded ? '▼' : '▶'}</span>
          Overview
        </div>
        <div className="object-panel-section-actions">
          <ActionsMenu
            kind={props.kind}
            name={props.name}
            objectKind={props.objectKind}
            canRestart={!!canRestart}
            canScale={!!canScale}
            canDelete={!!canDelete}
            canTrigger={!!canTrigger}
            canSuspend={!!canSuspend}
            canPortForward={canPortForward}
            portForwardTarget={portForwardTarget}
            isSuspended={props.suspend}
            restartDisabledReason={!canRestart ? props.restartDisabledReason : undefined}
            scaleDisabledReason={!canScale ? props.scaleDisabledReason : undefined}
            deleteDisabledReason={!canDelete ? props.deleteDisabledReason : undefined}
            currentReplicas={props.desiredReplicas !== undefined ? props.desiredReplicas : 1}
            actionLoading={props.actionLoading}
            deleteLoading={props.deleteLoading}
            onRestart={props.onRestart}
            onScale={props.onScale}
            onDelete={props.onDelete}
            onTrigger={props.onTrigger}
            onSuspendToggle={props.onSuspendToggle}
            onPortForward={() => {}}
          />
        </div>
      </div>

      {expanded && <div className="object-panel-section-grid">{renderOverviewContent()}</div>}
    </div>
  );
};

export default Overview;
