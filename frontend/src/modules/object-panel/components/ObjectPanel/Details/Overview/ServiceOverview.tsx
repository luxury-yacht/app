/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/ServiceOverview.tsx
 */

import React from 'react';
import { types } from '@wailsjs/go/models';
import { OverviewItem } from '@modules/object-panel/components/ObjectPanel/Details/Overview/shared/OverviewItem';
import { ResourceHeader } from '@shared/components/kubernetes/ResourceHeader';
import { ResourceMetadata } from '@shared/components/kubernetes/ResourceMetadata';
import { StatusChip, type StatusChipVariant } from '@shared/components/StatusChip';
import './shared/OverviewBlocks.css';

interface ServiceOverviewProps {
  serviceDetails: types.ServiceDetails | null;
}

const healthVariant = (status: string): StatusChipVariant => {
  if (status === 'Healthy') return 'healthy';
  if (status === 'No endpoints') return 'unhealthy';
  if (status === 'External') return 'info';
  return 'warning';
};

const lbStatusVariant = (status: string): StatusChipVariant =>
  status === 'Ready' ? 'healthy' : 'warning';

// Above this count, render a count instead of the full IP list.
const ENDPOINT_LIST_LIMIT = 20;

export const ServiceOverview: React.FC<ServiceOverviewProps> = ({ serviceDetails }) => {
  if (!serviceDetails) return null;

  const isLoadBalancer = serviceDetails.serviceType === 'LoadBalancer';
  const isExternalName = serviceDetails.serviceType === 'ExternalName';

  const clusterIPs = serviceDetails.clusterIPs ?? [];
  const hasMultipleClusterIPs = clusterIPs.length > 1;
  // "IP address" rather than "Cluster IP" — the latter collides with the
  // Kubernetes `ClusterIP` service type and is confusing to read alongside
  // the Type field.
  const clusterIPLabel = hasMultipleClusterIPs ? 'IP addresses' : 'IP address';
  const clusterIPValue = hasMultipleClusterIPs
    ? clusterIPs.join(', ')
    : (clusterIPs[0] ?? serviceDetails.clusterIP);

  const externalIPs = serviceDetails.externalIPs ?? [];
  const hasExternalIPs = externalIPs.length > 0;

  const sessionAffinity = serviceDetails.sessionAffinity;
  const showSessionAffinity = Boolean(sessionAffinity) && sessionAffinity !== 'None';
  const sessionTimeout = serviceDetails.sessionAffinityTimeout;

  const ports = serviceDetails.ports ?? [];

  const endpoints = serviceDetails.endpoints ?? [];
  const endpointCount = serviceDetails.endpointCount;
  const renderEndpoints = (() => {
    if (endpointCount === 0) {
      return <StatusChip variant="unhealthy">No endpoints</StatusChip>;
    }
    if (endpoints.length > 0 && endpoints.length <= ENDPOINT_LIST_LIMIT) {
      return (
        <div className="overview-ref-list">
          {endpoints.map((ep, index) => (
            <div key={`${ep}-${index}`} className="overview-ref-item">
              {ep}
            </div>
          ))}
        </div>
      );
    }
    return `${endpointCount} ${endpointCount === 1 ? 'endpoint' : 'endpoints'}`;
  })();
  const endpointsFullWidth = endpoints.length > 0 && endpoints.length <= ENDPOINT_LIST_LIMIT;

  return (
    <>
      <ResourceHeader
        kind="Service"
        name={serviceDetails.name}
        namespace={serviceDetails.namespace}
        age={serviceDetails.age}
      />

      <OverviewItem label="Type" value={serviceDetails.serviceType} />
      <OverviewItem
        label="Health"
        value={
          <StatusChip variant={healthVariant(serviceDetails.healthStatus)}>
            {serviceDetails.healthStatus}
          </StatusChip>
        }
        hidden={!serviceDetails.healthStatus}
      />

      <OverviewItem
        label={clusterIPLabel}
        value={<span className="overview-value-mono">{clusterIPValue}</span>}
        fullWidth={hasMultipleClusterIPs}
      />

      <OverviewItem
        label="External IPs"
        value={externalIPs.join(', ')}
        fullWidth={externalIPs.length > 2}
        hidden={!hasExternalIPs}
      />

      {isLoadBalancer && serviceDetails.loadBalancerIP && (
        <OverviewItem label="Load Balancer IP" value={serviceDetails.loadBalancerIP} />
      )}
      {isLoadBalancer && serviceDetails.loadBalancerStatus && (
        <OverviewItem
          label="LB Status"
          value={
            <StatusChip variant={lbStatusVariant(serviceDetails.loadBalancerStatus)}>
              {serviceDetails.loadBalancerStatus}
            </StatusChip>
          }
        />
      )}

      {isExternalName && serviceDetails.externalName && (
        <OverviewItem label="External Name" value={serviceDetails.externalName} />
      )}

      {ports.length > 0 && (
        <OverviewItem
          label="Ports"
          value={
            <div className="overview-row-list">
              {ports.map((port, index) => (
                <div
                  key={`${port.port}-${port.targetPort ?? 'target'}-${index}`}
                  className="overview-row"
                >
                  <span className="overview-row-label">{port.name || `port ${port.port}`}</span>
                  <span className="overview-row-value">
                    {port.port}/{port.protocol}
                    {port.targetPort && ` → ${port.targetPort}`}
                    {port.nodePort && port.nodePort > 0 && ` (NodePort: ${port.nodePort})`}
                  </span>
                </div>
              ))}
            </div>
          }
          fullWidth
        />
      )}

      <OverviewItem label="Endpoints" value={renderEndpoints} fullWidth={endpointsFullWidth} />

      {showSessionAffinity && <OverviewItem label="Session Affinity" value={sessionAffinity} />}
      {sessionTimeout && sessionTimeout > 0 && (
        <OverviewItem label="Session Timeout" value={`${sessionTimeout} seconds`} />
      )}

      <ResourceMetadata
        labels={serviceDetails.labels}
        annotations={serviceDetails.annotations}
        selector={serviceDetails.selector}
        showSelector={true}
      />
    </>
  );
};
