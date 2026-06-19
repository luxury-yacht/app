/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/DetailsTab.tsx
 */

import React from 'react';
import Overview from '@modules/object-panel/components/ObjectPanel/Details/Overview';
import Utilization from '@modules/object-panel/components/ObjectPanel/Details/DetailsTabUtilization';
import Containers from '@modules/object-panel/components/ObjectPanel/Details/DetailsTabContainers';
import RBACRules from '@modules/object-panel/components/ObjectPanel/Details/DetailsTabRBACRules';
import DataSection from '@modules/object-panel/components/ObjectPanel/Details/DetailsTabData';
import { WarningOutlineIcon } from '@shared/components/icons/SharedIcons';
import './DetailsTab.css';
import './DetailsTabData.css';

// Import from extracted modules
import type { DetailsTabProps } from './detailsTabTypes';
import { useUtilizationData, useHasUtilization } from './useUtilizationData';

// Action-relevant fields read off the active detail DTO for the Overview/ActionsMenu.
interface ActionDetail {
  status?: string;
  ready?: string | number;
  replicas?: string | number;
  unschedulable?: boolean;
}

export type { DetailsTabProps } from './detailsTabTypes';

const DetailsTabContent: React.FC<DetailsTabProps> = ({
  objectData,
  detailModel,
  detailsLoading,
  detailsError,
  resourceDeleted = false,
  deletedResourceName = '',
  onAfterDelete,
  onAfterAction,
}) => {
  const model = detailModel;
  const hasUtilization = useHasUtilization(objectData);

  const dataInfo = model.dataSection;

  const utilizationData = useUtilizationData({
    objectData,
    detail: model.activeDetail,
  });

  const portForwardAvailable = model.portForwardAvailable;
  // Action-relevant fields come from the active DTO + the derived model (no per-kind flattening).
  const detail = (model.activeDetail ?? undefined) as ActionDetail | undefined;

  return (
    <div className="object-panel-tab-content">
      {/* Deleted Resource Warning */}
      {resourceDeleted && (
        <div className="resource-deleted-warning">
          <WarningOutlineIcon />
          <span>
            {deletedResourceName || 'Resource'} no longer exists. Please select another resource.
          </span>
        </div>
      )}

      {/* Details Content */}
      <div className="details-content">
        {/* Loading Overlay - only show on initial load */}
        {detailsLoading && (
          <div className="loading-overlay">
            <div className="loading-spinner-wrapper">
              <div className="spinner"></div>
              <div className="loading-message">
                Loading {objectData?.kind?.toLowerCase()} details...
              </div>
            </div>
          </div>
        )}

        {detailsError && <div className="error-message">Error loading details: {detailsError}</div>}

        {objectData && (
          <Overview
            kind={objectData.kind ?? ''}
            name={objectData.name ?? ''}
            namespace={objectData.namespace ?? undefined}
            activeDetail={model.activeDetail}
            status={detail?.status}
            ready={detail?.ready}
            replicas={detail?.replicas}
            unschedulable={detail?.unschedulable}
            suspend={model.cronJobSuspended}
            desiredReplicas={model.desiredScaleReplicas}
            objectKind={objectData?.kind}
            portForwardAvailable={portForwardAvailable}
            onAfterDelete={onAfterDelete}
            onAfterAction={onAfterAction}
          />
        )}

        {(hasUtilization || objectData?.kind?.toLowerCase() === 'node') && utilizationData && (
          <div className="details-section-spaced">
            <Utilization
              cpu={utilizationData.cpu}
              memory={utilizationData.memory}
              pods={utilizationData.pods}
              mode={utilizationData.mode}
              podCount={utilizationData.podCount}
              readyPodCount={utilizationData.readyPodCount}
            />
          </div>
        )}

        {/* Containers Section - Only for Pods and core Workloads (not Jobs/CronJobs) */}
        {(() => {
          if (!model.containerSection) return null;

          return (
            <div className="details-section-spaced">
              <Containers
                containers={model.containerSection.containers}
                initContainers={model.containerSection.initContainers}
              />
            </div>
          );
        })()}

        {/* Rules Section - For Roles and ClusterRoles. Sibling to Overview;
            rules are the primary content of the resource. */}
        {(() => {
          const rules = model.roleRules;
          if (!rules || rules.length === 0) return null;
          return (
            <div className="details-section-spaced">
              <RBACRules policyRules={rules} />
            </div>
          );
        })()}

        {dataInfo && (
          <div className="details-section-spaced">
            <DataSection
              data={dataInfo.data}
              binaryData={dataInfo.binaryData}
              isSecret={dataInfo.isSecret}
            />
          </div>
        )}
      </div>
    </div>
  );
};

const DetailsTab: React.FC<DetailsTabProps> = (props) => {
  return <DetailsTabContent {...props} />;
};

export default DetailsTab;
