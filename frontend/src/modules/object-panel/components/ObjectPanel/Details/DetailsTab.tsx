/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/DetailsTab.tsx
 */

import React, { useMemo } from 'react';
import Overview from '@modules/object-panel/components/ObjectPanel/Details/Overview';
import Utilization from '@modules/object-panel/components/ObjectPanel/Details/DetailsTabUtilization';
import Containers from '@modules/object-panel/components/ObjectPanel/Details/DetailsTabContainers';
import DataSection from '@modules/object-panel/components/ObjectPanel/Details/DetailsTabData';
import './DetailsTab.css';
import './DetailsTabData.css';

// Import from extracted modules
import type { DetailsTabProps } from './detailsTabTypes';
import { useOverviewData } from './useOverviewData';
import { useUtilizationData, useHasUtilization } from './useUtilizationData';

export type { DetailsTabProps } from './detailsTabTypes';

const DetailsTabContent: React.FC<DetailsTabProps> = ({
  objectData,
  // Workloads
  podDetails,
  deploymentDetails,
  replicaSetDetails,
  daemonSetDetails,
  statefulSetDetails,
  jobDetails,
  cronJobDetails,
  // Configuration
  configMapDetails,
  secretDetails,
  // Helm
  helmReleaseDetails,
  // Network
  serviceDetails,
  ingressDetails,
  networkPolicyDetails,
  endpointSliceDetails,
  // Storage
  pvcDetails,
  pvDetails,
  storageClassDetails,
  // RBAC
  serviceAccountDetails,
  roleDetails,
  roleBindingDetails,
  clusterRoleDetails,
  clusterRoleBindingDetails,
  // Autoscaling
  hpaDetails,
  // Policy
  pdbDetails,
  resourceQuotaDetails,
  limitRangeDetails,
  // Cluster Resources
  nodeDetails,
  namespaceDetails,
  ingressClassDetails,
  // CRDs and Webhooks
  crdDetails,
  mutatingWebhookDetails,
  validatingWebhookDetails,
  detailsLoading,
  detailsError,
  resourceDeleted = false,
  deletedResourceName = '',
  canRestart,
  canScale,
  canDelete,
  canTrigger,
  canSuspend,
  restartDisabledReason,
  scaleDisabledReason,
  deleteDisabledReason,
  actionLoading,
  actionError,
  scaleReplicas,
  showScaleInput,
  onRestartClick,
  onDeleteClick,
  onScaleClick,
  onScaleCancel,
  onScaleReplicasChange,
  onShowScaleInput,
  onTriggerClick,
  onSuspendToggle,
}) => {
  // Use extracted hooks for overview and utilization data
  const hasUtilization = useHasUtilization(objectData);

  const overviewData = useOverviewData({
    objectData,
    podDetails,
    deploymentDetails,
    replicaSetDetails,
    daemonSetDetails,
    statefulSetDetails,
    jobDetails,
    cronJobDetails,
    configMapDetails,
    secretDetails,
    helmReleaseDetails,
    serviceDetails,
    ingressDetails,
    networkPolicyDetails,
    endpointSliceDetails,
    pvcDetails,
    pvDetails,
    storageClassDetails,
    serviceAccountDetails,
    roleDetails,
    roleBindingDetails,
    clusterRoleDetails,
    clusterRoleBindingDetails,
    hpaDetails,
    pdbDetails,
    resourceQuotaDetails,
    limitRangeDetails,
    nodeDetails,
    namespaceDetails,
    ingressClassDetails,
    crdDetails,
    mutatingWebhookDetails,
    validatingWebhookDetails,
  });

  // Extract data section (for ConfigMaps and Secrets)
  const dataInfo = useMemo(() => {
    if (!objectData) return null;

    const objectKind = objectData.kind?.toLowerCase();

    // Use configmap details if available
    if (configMapDetails && objectKind === 'configmap') {
      return {
        data: configMapDetails.data,
        binaryData: configMapDetails.binaryData,
        isSecret: false,
      };
    }

    // Use secret details if available
    if (secretDetails && objectKind === 'secret') {
      return {
        data: secretDetails.data,
        binaryData: undefined,
        isSecret: true,
      };
    }

    return null;
  }, [objectData, configMapDetails, secretDetails]);

  const utilizationData = useUtilizationData({
    objectData,
    podDetails,
    deploymentDetails,
    daemonSetDetails,
    statefulSetDetails,
    replicaSetDetails,
    nodeDetails,
  });

  return (
    <div className="object-panel-tab-content">
      {/* Deleted Resource Warning */}
      {resourceDeleted && (
        <div className="resource-deleted-warning">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span>
            {deletedResourceName || 'Resource'} no longer exists. Please select another resource.
          </span>
        </div>
      )}

      {/* Error Display */}
      {actionError && <div className="action-error">Error: {actionError}</div>}

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

        {overviewData && (
          <Overview
            {...(overviewData as { kind: string; name: string })}
            canDelete={canDelete}
            onDelete={onDeleteClick}
            deleteLoading={actionLoading}
            canRestart={canRestart}
            canScale={canScale}
            canTrigger={canTrigger}
            canSuspend={canSuspend}
            deleteDisabledReason={deleteDisabledReason}
            restartDisabledReason={restartDisabledReason}
            scaleDisabledReason={scaleDisabledReason}
            onRestart={onRestartClick}
            onScale={(replicas: number) => onScaleClick(replicas)}
            onScaleCancel={onScaleCancel}
            onScaleReplicasChange={onScaleReplicasChange}
            onShowScaleInput={onShowScaleInput}
            scaleReplicas={scaleReplicas}
            showScaleInput={showScaleInput}
            actionLoading={actionLoading}
            objectKind={objectData?.kind}
            onTrigger={onTriggerClick}
            onSuspendToggle={onSuspendToggle}
          />
        )}

        {(hasUtilization || objectData?.kind?.toLowerCase() === 'node') && utilizationData && (
          <div className="details-section-spaced">
            <Utilization
              cpu={utilizationData.cpu}
              memory={utilizationData.memory}
              pods={utilizationData.pods}
              mode={utilizationData.mode}
            />
          </div>
        )}

        {/* Containers Section - Only for Pods and core Workloads (not Jobs/CronJobs) */}
        {(() => {
          const kind = objectData?.kind?.toLowerCase();
          const shouldShowContainers =
            kind === 'pod' ||
            kind === 'deployment' ||
            kind === 'daemonset' ||
            kind === 'statefulset' ||
            kind === 'replicaset';

          if (!shouldShowContainers) return null;

          const hasContainers =
            (podDetails &&
              (podDetails.containers?.length > 0 ||
                (podDetails.initContainers?.length ?? 0) > 0)) ||
            (deploymentDetails?.containers?.length ?? 0) > 0 ||
            (daemonSetDetails?.containers?.length ?? 0) > 0 ||
            (statefulSetDetails?.containers?.length ?? 0) > 0 ||
            (replicaSetDetails?.containers?.length ?? 0) > 0;

          if (!hasContainers) return null;

          return (
            <div className="details-section-spaced">
              <Containers
                containers={
                  podDetails?.containers ||
                  deploymentDetails?.containers ||
                  daemonSetDetails?.containers ||
                  statefulSetDetails?.containers ||
                  replicaSetDetails?.containers
                }
                initContainers={podDetails?.initContainers}
              />
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
