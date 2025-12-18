import React from 'react';
import { useDetailsSectionContext } from '@contexts/DetailsSectionContext';
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
  restartDisabledReason?: string;
  scaleDisabledReason?: string;
  deleteDisabledReason?: string;
  onRestart?: () => void;
  onScale?: (replicas: number) => void;
  onDelete?: () => void;
  [key: string]: any; // Allow any additional fields for generic resources
}

// Union type using generic props for all resources
type OverviewProps = GenericOverviewProps;

const Overview: React.FC<OverviewProps> = (props) => {
  const { sectionStates, setSectionExpanded } = useDetailsSectionContext();
  const expanded = sectionStates.overview;

  // Use the factory pattern to render the appropriate component
  const renderOverviewContent = () => {
    return overviewRegistry.renderComponent(props);
  };

  // Get capabilities for this resource type
  const capabilities = getResourceCapabilities(props.kind);
  const canRestart = props.canRestart ?? capabilities?.restart;
  const canScale = props.canScale ?? capabilities?.scale;
  const canDelete = props.canDelete ?? capabilities?.delete;

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
            objectKind={props.objectKind}
            canRestart={!!canRestart}
            canScale={!!canScale}
            canDelete={!!canDelete}
            restartDisabledReason={!canRestart ? props.restartDisabledReason : undefined}
            scaleDisabledReason={!canScale ? props.scaleDisabledReason : undefined}
            deleteDisabledReason={!canDelete ? props.deleteDisabledReason : undefined}
            currentReplicas={props.desiredReplicas !== undefined ? props.desiredReplicas : 1}
            actionLoading={props.actionLoading}
            deleteLoading={props.deleteLoading}
            onRestart={props.onRestart}
            onScale={props.onScale}
            onDelete={props.onDelete}
          />
        </div>
      </div>

      {expanded && <div className="object-panel-section-grid">{renderOverviewContent()}</div>}
    </div>
  );
};

export default Overview;
