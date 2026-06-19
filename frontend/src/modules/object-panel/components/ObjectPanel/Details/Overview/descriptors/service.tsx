/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/descriptors/service.tsx
 *
 * Service Overview descriptor (X1 P2). Presentation ported verbatim from ServiceOverview.tsx.
 */

import React from 'react';
import { service } from '@wailsjs/go/models';
import { StatusChip } from '@shared/components/StatusChip';
import type { OverviewDescriptor } from '../schema';
import '../shared/OverviewBlocks.css';

type ServiceDetails = service.ServiceDetails;

// Above this count, render a count instead of the full IP list.
const ENDPOINT_LIST_LIMIT = 20;

const isLoadBalancer = (d: ServiceDetails) => d.serviceType === 'LoadBalancer';
const isExternalName = (d: ServiceDetails) => d.serviceType === 'ExternalName';
const clusterIPList = (d: ServiceDetails) => d.clusterIPs ?? [];
const hasMultipleClusterIPs = (d: ServiceDetails) => clusterIPList(d).length > 1;
const externalIPList = (d: ServiceDetails) => d.externalIPs ?? [];

const renderEndpoints = (d: ServiceDetails): React.ReactNode => {
  const endpoints = d.endpoints ?? [];
  if (d.endpointCount === 0) {
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
  return `${d.endpointCount} ${d.endpointCount === 1 ? 'endpoint' : 'endpoints'}`;
};

export const serviceDescriptor: OverviewDescriptor<ServiceDetails> = {
  displayKind: 'Service',
  dtoClass: service.ServiceDetails,
  schema: {
    showSelector: true,
    items: [
      { field: 'serviceType', label: 'Type' },
      { kind: 'status' },
      {
        // "IP address" rather than "Cluster IP" — the latter collides with the ClusterIP service
        // type and reads confusingly alongside the Type field.
        field: 'clusterIPs',
        derivedFrom: ['clusterIP'],
        label: (d) => (hasMultipleClusterIPs(d) ? 'IP addresses' : 'IP address'),
        mono: true,
        fullWidth: (d) => hasMultipleClusterIPs(d),
        render: (d) => {
          const ips = clusterIPList(d);
          return hasMultipleClusterIPs(d) ? ips.join(', ') : (ips[0] ?? d.clusterIP);
        },
      },
      {
        field: 'externalIPs',
        label: 'External IPs',
        render: (d) => externalIPList(d).join(', '),
        hidden: (d) => externalIPList(d).length === 0,
        fullWidth: (d) => externalIPList(d).length > 2,
      },
      {
        field: 'loadBalancerIP',
        label: 'Load Balancer IP',
        hidden: (d) => !(isLoadBalancer(d) && d.loadBalancerIP),
      },
      {
        field: 'loadBalancerStatus',
        label: 'LB Status',
        hidden: (d) => !(isLoadBalancer(d) && d.loadBalancerStatus),
      },
      {
        field: 'externalName',
        label: 'External Name',
        hidden: (d) => !(isExternalName(d) && d.externalName),
      },
      {
        field: 'ports',
        label: 'Ports',
        fullWidth: true,
        hidden: (d) => (d.ports ?? []).length === 0,
        render: (d) => (
          <div className="overview-row-list">
            {(d.ports ?? []).map((port, index) => (
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
        ),
      },
      {
        field: 'endpoints',
        derivedFrom: ['endpointCount'],
        label: 'Endpoints',
        render: renderEndpoints,
        fullWidth: (d) => {
          const endpoints = d.endpoints ?? [];
          return endpoints.length > 0 && endpoints.length <= ENDPOINT_LIST_LIMIT;
        },
      },
      {
        field: 'sessionAffinity',
        label: 'Session Affinity',
        hidden: (d) => !(d.sessionAffinity && d.sessionAffinity !== 'None'),
      },
      {
        field: 'sessionAffinityTimeout',
        label: 'Session Timeout',
        render: (d) => `${d.sessionAffinityTimeout} seconds`,
        hidden: (d) => !(d.sessionAffinityTimeout && d.sessionAffinityTimeout > 0),
      },
    ],
  },
  // Not surfaced in the Overview: `details` (table-summary string) and `healthStatus`.
  coveredElsewhere: ['details', 'healthStatus'],
};
