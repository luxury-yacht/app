/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/descriptors/service.tsx
 *
 * Service Overview descriptor (X1 P2). Presentation ported verbatim from ServiceOverview.tsx.
 */

import type { service } from '@core/backend-api/models';
import { StatusChip } from '@shared/components/StatusChip';
import { withStableListKeys } from '@shared/utils/stableListKeys';
import type React from 'react';
import type { OverviewDescriptor } from '../schema';
import {
  FlowArrow,
  FlowEndpoint,
  FlowEndpoints,
  FlowEntries,
  FlowEntry,
  FlowScope,
  FlowSubject,
  FlowTerm,
  FlowTermLines,
  TrafficFlow,
  TrafficFlowCard,
  TrafficFlowSection,
} from '../shared/TrafficFlow';
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
  // Null counts mean the EndpointSlices could not be listed, which is not the same as none.
  if (d.readyEndpointCount === null) {
    return 'Unknown';
  }
  if (d.endpointCount === 0) {
    return <StatusChip variant="unhealthy">No endpoints</StatusChip>;
  }
  if (endpoints.length > 0 && endpoints.length <= ENDPOINT_LIST_LIMIT) {
    return (
      <div className="overview-ref-list">
        {withStableListKeys(endpoints, (endpoint) => endpoint).map(({ key, value: ep }) => (
          <div key={key} className="overview-ref-item">
            {ep}
          </div>
        ))}
      </div>
    );
  }
  return `${d.endpointCount} ${d.endpointCount === 1 ? 'endpoint' : 'endpoints'}`;
};

type ServicePort = service.ServicePortDetails;

// A headless Service (clusterIP None) has no virtual IP; its DNS name returns the pods' IPs.
const isHeadless = (d: ServiceDetails) => d.clusterIP === 'None';

const renderDnsName = (d: ServiceDetails): React.ReactNode => {
  const dnsName = <span className="overview-value-mono">{`${d.name}.${d.namespace}.svc`}</span>;
  return isHeadless(d) ? <>{dnsName} (headless: returns pod IPs)</> : dnsName;
};

const readinessLabel = (d: ServiceDetails): string => {
  if (d.readyEndpointCount === null) {
    return 'readiness unknown';
  }
  const parts = [`${d.readyEndpointCount} ready`];
  if ((d.notReadyEndpointCount ?? 0) > 0) {
    parts.push(`${d.notReadyEndpointCount} not ready`);
  }
  return parts.join(', ');
};

// Without a selector, Kubernetes does not manage the Service's endpoints.
const SelectedPods: React.FC<{ d: ServiceDetails }> = ({ d }) => {
  const terms = Object.entries(d.selector ?? {}).map(([key, value]) => `${key}=${value}`);
  return (
    <FlowEndpoints label="Backend">
      <FlowEndpoint target>
        {terms.length > 0 ? (
          <>
            <FlowSubject>Pods matching</FlowSubject>
            <FlowTermLines terms={terms} />
            <FlowScope>
              in namespace <FlowTerm>{d.namespace}</FlowTerm>
            </FlowScope>
          </>
        ) : (
          <FlowSubject>Manually managed endpoints</FlowSubject>
        )}
        <FlowScope>{readinessLabel(d)}</FlowScope>
      </FlowEndpoint>
    </FlowEndpoints>
  );
};

// An ExternalName Service is only a DNS alias: clients connect to the external host directly.
const ExternalNameTarget: React.FC<{ d: ServiceDetails }> = ({ d }) => (
  <FlowEndpoints label="Backend">
    <FlowEndpoint target>
      <FlowSubject>External name</FlowSubject>
      <FlowTermLines terms={[d.externalName ?? '']} />
      <FlowScope>no proxying; clients connect directly</FlowScope>
    </FlowEndpoint>
  </FlowEndpoints>
);

// Each port: its name above "TCP 80:8080" (protocol, Service port : target port), with its node port
// when it has one. An unset target port is the API default (the Service port itself); a named
// target port has no single number because each pod resolves it, so its name stands in.
const PortEntry: React.FC<{ port: ServicePort }> = ({ port }) => (
  <FlowEntry title={port.name}>
    {`${port.protocol || 'TCP'} ${port.port}:${port.targetPort || port.port}`}
    {!!port.nodePort && (
      <span className="traffic-flow-muted">
        {' · '}
        <span className="traffic-flow-nowrap">node port {port.nodePort}</span>
      </span>
    )}
  </FlowEntry>
);

// Every port leads to the same pods, so one tile lists the ports on one side of a single flow.
const renderPortsSection = (d: ServiceDetails): React.ReactNode => {
  const ports = d.ports ?? [];
  if (ports.length === 0) {
    return null;
  }
  const externalName = isExternalName(d);
  return (
    <TrafficFlowSection label="Ports" tone="inbound">
      <TrafficFlowCard>
        <TrafficFlow
          from={
            <FlowEndpoints label="Requests" fit>
              <FlowEndpoint>
                <FlowEntries label="Ports">
                  {withStableListKeys(ports, (port) => JSON.stringify(port)).map(
                    ({ key, value: port }) => (
                      <PortEntry key={key} port={port} />
                    )
                  )}
                </FlowEntries>
              </FlowEndpoint>
            </FlowEndpoints>
          }
          middle={externalName ? <FlowArrow label="Via" items={['DNS alias']} /> : <FlowArrow />}
          to={externalName ? <ExternalNameTarget d={d} /> : <SelectedPods d={d} />}
        />
      </TrafficFlowCard>
    </TrafficFlowSection>
  );
};

export const serviceDescriptor: OverviewDescriptor<ServiceDetails> = {
  displayKind: 'Service',
  dtoName: 'ServiceDetails',
  schema: {
    showSelector: true,
    items: [
      { field: 'serviceType', label: 'Type' },
      // Only shown when the Service needs attention (pending load balancer, no ready endpoints,
      // no endpoints, terminating); otherwise it would repeat the Type row and the Ports flow.
      { kind: 'status', hidden: (d) => d.statusPresentation === 'ready' },
      {
        // "IP address" rather than "Cluster IP" — the latter collides with the ClusterIP service
        // type and reads confusingly alongside the Type field.
        field: 'clusterIPs',
        derivedFrom: ['clusterIP'],
        label: (d) => (hasMultipleClusterIPs(d) ? 'IP addresses' : 'IP address'),
        // An ExternalName Service is a DNS alias with no cluster IP.
        hidden: isExternalName,
        mono: true,
        fullWidth: (d) => hasMultipleClusterIPs(d),
        render: (d) => {
          const ips = clusterIPList(d);
          return hasMultipleClusterIPs(d) ? ips.join(', ') : (ips[0] ?? d.clusterIP);
        },
      },
      {
        // In-cluster DNS name; the short `.svc` form resolves whatever the cluster domain is.
        label: 'DNS Name',
        derivedFrom: ['clusterIP'],
        render: renderDnsName,
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
        // A hostname, shown in the same mono font as the DNS Name and IP address rows.
        mono: true,
        hidden: (d) => !(isExternalName(d) && d.externalName),
      },
      {
        field: 'endpoints',
        derivedFrom: ['endpointCount'],
        label: 'Endpoints',
        // ExternalName Services never have endpoints; a "No endpoints" warning would read as a fault.
        hidden: isExternalName,
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
      {
        kind: 'widget',
        consumes: [
          'ports',
          'serviceType',
          'externalName',
          'selector',
          'readyEndpointCount',
          'notReadyEndpointCount',
        ],
        render: renderPortsSection,
      },
    ],
  },
  // Not surfaced in the Overview: `details` (table-summary string) and `healthStatus`.
  coveredElsewhere: ['details', 'healthStatus'],
};
