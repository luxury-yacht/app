/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/ServiceOverview.tsx
 *
 * Module source for ServiceOverview.
 */
import React from 'react';
import { types } from '@wailsjs/go/models';
import { OverviewItem } from '@modules/object-panel/components/ObjectPanel/Details/Overview/shared/OverviewItem';
import { ResourceHeader } from '@shared/components/kubernetes/ResourceHeader';
import { ResourceMetadata } from '@shared/components/kubernetes/ResourceMetadata';
import './NetworkOverview.css';

interface ServiceOverviewProps {
  serviceDetails: types.ServiceDetails | null;
}

export const ServiceOverview: React.FC<ServiceOverviewProps> = ({ serviceDetails }) => {
  if (!serviceDetails) return null;

  return (
    <>
      {/* Use composed component for header */}
      <ResourceHeader
        kind="Service"
        name={serviceDetails.name}
        namespace={serviceDetails.namespace}
        age={serviceDetails.age}
      />
      <OverviewItem label="Type" value={serviceDetails.serviceType} />

      {/* Cluster IPs */}
      <OverviewItem label="Cluster IP" value={serviceDetails.clusterIP} />
      {serviceDetails.clusterIPs && serviceDetails.clusterIPs.length > 1 && (
        <OverviewItem
          label="Cluster IPs"
          value={serviceDetails.clusterIPs.join(', ')}
          fullWidth={serviceDetails.clusterIPs.length > 2}
        />
      )}

      {/* External IPs */}
      {serviceDetails.externalIPs && serviceDetails.externalIPs.length > 0 && (
        <OverviewItem
          label="External IPs"
          value={serviceDetails.externalIPs.join(', ')}
          fullWidth={serviceDetails.externalIPs.length > 2}
        />
      )}

      {/* LoadBalancer specific */}
      {serviceDetails.serviceType === 'LoadBalancer' && (
        <>
          {serviceDetails.loadBalancerIP && (
            <OverviewItem label="Load Balancer IP" value={serviceDetails.loadBalancerIP} />
          )}
          {serviceDetails.loadBalancerStatus && (
            <OverviewItem label="LB Status" value={serviceDetails.loadBalancerStatus} />
          )}
        </>
      )}

      {/* ExternalName specific */}
      {serviceDetails.serviceType === 'ExternalName' && serviceDetails.externalName && (
        <OverviewItem label="External Name" value={serviceDetails.externalName} />
      )}

      {/* Session Affinity */}
      <OverviewItem label="Session Affinity" value={serviceDetails.sessionAffinity} />
      {serviceDetails.sessionAffinityTimeout && serviceDetails.sessionAffinityTimeout > 0 && (
        <OverviewItem
          label="Session Timeout"
          value={`${serviceDetails.sessionAffinityTimeout} seconds`}
        />
      )}

      {/* Health Status */}
      <OverviewItem label="Health Status" value={serviceDetails.healthStatus} />

      {/* Endpoints */}
      <OverviewItem label="Endpoints" value={`${serviceDetails.endpointCount} endpoint(s)`} />
      {serviceDetails.endpoints &&
        serviceDetails.endpoints.length > 0 &&
        serviceDetails.endpoints.length <= 5 && (
          <OverviewItem
            label="Endpoint IPs"
            value={
              <div className="endpoint-list">
                {serviceDetails.endpoints.map((ep: string, index: number) => (
                  <div key={`${ep}-${index}`} className="endpoint-item">
                    {ep}
                  </div>
                ))}
              </div>
            }
            fullWidth
          />
        )}

      {/* Ports */}
      {serviceDetails.ports && serviceDetails.ports.length > 0 && (
        <OverviewItem
          label="Ports"
          value={
            <div className="ports-list">
              {serviceDetails.ports.map((port: types.ServicePortDetails, index: number) => (
                <div
                  key={`${port.port}-${port.targetPort ?? 'target'}-${index}`}
                  className="port-item"
                >
                  {port.name && <span className="port-name">{port.name}: </span>}
                  <span className="port-details">
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

      {/* Use composed component for metadata */}
      <ResourceMetadata
        labels={serviceDetails.labels}
        annotations={serviceDetails.annotations}
        selector={serviceDetails.selector}
        showSelector={true}
      />
    </>
  );
};
