/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/index.tsx
 *
 * Barrel exports for Overview.
 * Re-exports public APIs for the object panel feature.
 */

import React, { useMemo } from 'react';
import { useDetailsSectionContext } from '@/core/contexts/ObjectPanelDetailsSectionContext';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { overviewRegistry } from './registry';
import { ActionsMenu } from '@shared/components/kubernetes/ActionsMenu';
import type { ObjectActionData } from '@shared/hooks/useObjectActions';
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

  // Build object data for ActionsMenu
  const actionObject: ObjectActionData | null = useMemo(
    () => ({
      kind: props.kind,
      name: props.name,
      namespace: props.namespace,
      clusterId,
      clusterName,
      status: props.suspend ? 'Suspended' : props.status,
    }),
    [props.kind, props.name, props.namespace, props.suspend, props.status, clusterId, clusterName]
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
            object={actionObject}
            currentReplicas={props.desiredReplicas !== undefined ? props.desiredReplicas : 1}
            actionLoading={props.actionLoading || props.deleteLoading}
            onRestart={props.onRestart}
            onScale={props.onScale}
            onDelete={props.onDelete}
            onTrigger={props.onTrigger}
            onSuspendToggle={props.onSuspendToggle}
          />
        </div>
      </div>

      {expanded && <div className="object-panel-section-grid">{renderOverviewContent()}</div>}
    </div>
  );
};

export default Overview;
