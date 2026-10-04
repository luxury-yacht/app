/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/descriptors/endpointslice.tsx
 *
 * EndpointSlice Overview descriptor (X1 P3). Presentation ported verbatim from EndpointsOverview.tsx.
 * Target links retain the model's ResourceLink identity. Node links use the slice's cluster
 * from OverviewContext; ObjectPanelLink owns navigation.
 */

import type { endpointslice } from '@core/backend-api/models';
import { ObjectPanelLink } from '@shared/components/ObjectPanelLink';
import { StatusChip } from '@shared/components/StatusChip';
import { useResourceLinkReference } from '@shared/hooks/useResourceLinkReference';
import { buildRequiredObjectReference } from '@shared/utils/objectIdentity';
import { withStableListKeys } from '@shared/utils/stableListKeys';
import type React from 'react';
import type { OverviewContext, OverviewDescriptor } from '../schema';
import {
  FlowArrow,
  FlowEndpoint,
  FlowEndpoints,
  FlowEntries,
  FlowEntry,
  FlowScope,
  FlowSubject,
  TrafficFlow,
  TrafficFlowCard,
  TrafficFlowSection,
} from '../shared/TrafficFlow';
import '../shared/OverviewBlocks.css';
import '../EndpointsOverview.css';

type EndpointSliceDetails = endpointslice.EndpointSliceDetails;

/** Cluster identity used to build object references for target pods/nodes. */
interface ClusterMeta {
  clusterId?: string;
  clusterName?: string;
}

const TargetRefLink: React.FC<{
  targetRef: endpointslice.EndpointSliceAddress['targetRef'];
  clusterName?: string;
}> = ({ targetRef, clusterName }) => {
  const objectRef = useResourceLinkReference(targetRef, clusterName);
  const target = targetRef?.ref ?? targetRef?.display;
  if (!target) {
    return null;
  }
  const label = `${target.kind}/${target.name}`;
  return objectRef ? (
    <ObjectPanelLink className="address-target" objectRef={objectRef}>
      {label}
    </ObjectPanelLink>
  ) : (
    <span className="address-target">{label}</span>
  );
};

// One endpoint: its target (usually a Pod) above its address and the node it runs on.
const AddressEntry: React.FC<{
  address: endpointslice.EndpointSliceAddress;
  clusterMeta: ClusterMeta;
}> = ({ address, clusterMeta }) => (
  <FlowEntry
    title={
      address.targetRef ? (
        <TargetRefLink targetRef={address.targetRef} clusterName={clusterMeta.clusterName} />
      ) : undefined
    }
  >
    {address.ip}
    {!!address.nodeName && (
      <span className="traffic-flow-muted">
        {' on '}
        <ObjectPanelLink
          objectRef={buildRequiredObjectReference({
            kind: 'Node',
            name: address.nodeName,
            ...clusterMeta,
          })}
        >
          {address.nodeName}
        </ObjectPanelLink>
      </span>
    )}
  </FlowEntry>
);

// Ready endpoints take traffic (outlined); not-ready ones do not (dashed red). Long lists are capped.
const AddressBox: React.FC<{
  label: 'Ready' | 'Not ready';
  addresses: endpointslice.EndpointSliceAddress[];
  limit: number;
  clusterMeta: ClusterMeta;
}> = ({ label, addresses, limit, clusterMeta }) => (
  <FlowEndpoint target={label === 'Ready'} warning={label === 'Not ready'}>
    <FlowSubject>{label}</FlowSubject>
    <FlowEntries label={label}>
      {withStableListKeys(addresses.slice(0, limit), (address) => address.ip).map(
        ({ key, value }) => (
          <AddressEntry key={key} address={value} clusterMeta={clusterMeta} />
        )
      )}
    </FlowEntries>
    {addresses.length > limit && <FlowScope>… and {addresses.length - limit} more</FlowScope>}
  </FlowEndpoint>
);

// A port with no number covers every port; the app protocol (e.g. http) follows when set.
const PortEntry: React.FC<{ port: endpointslice.EndpointSlicePort }> = ({ port }) => (
  <FlowEntry title={port.name}>
    {`${port.protocol || 'TCP'} ${port.port || 'all ports'}`}
    {!!port.appProtocol && <span className="traffic-flow-muted"> · {port.appProtocol}</span>}
  </FlowEntry>
);

const clusterMetaFromContext = (context: OverviewContext): ClusterMeta => ({
  clusterId: context.clusterId,
  clusterName: context.clusterName,
});

const readyList = (d: EndpointSliceDetails) => d.readyAddresses ?? [];
const notReadyList = (d: EndpointSliceDetails) => d.notReadyAddresses ?? [];

const renderStatus = (d: EndpointSliceDetails): React.ReactNode => {
  const readyCount = readyList(d).length;
  const notReadyCount = notReadyList(d).length;
  if (readyCount + notReadyCount === 0) {
    return <StatusChip variant="warning">No endpoints</StatusChip>;
  }
  return (
    <span className="endpoint-status-chips">
      {readyCount > 0 && <StatusChip variant="healthy">{readyCount} ready</StatusChip>}
      {notReadyCount > 0 && <StatusChip variant="unhealthy">{notReadyCount} not ready</StatusChip>}
    </span>
  );
};

// The kube-controller-manager labels every slice it manages with its Service's name.
const SERVICE_NAME_LABEL = 'kubernetes.io/service-name';

const renderServiceLink = (d: EndpointSliceDetails, context: OverviewContext): React.ReactNode => {
  const name = d.labels?.[SERVICE_NAME_LABEL];
  return (
    <ObjectPanelLink
      objectRef={buildRequiredObjectReference({
        kind: 'service',
        name,
        namespace: d.namespace,
        ...clusterMetaFromContext(context),
      })}
    >
      {name}
    </ObjectPanelLink>
  );
};

// The slice's ports lead to its endpoints: ready ones take traffic, not-ready ones do not.
const renderEndpointsSection = (
  d: EndpointSliceDetails,
  context: OverviewContext
): React.ReactNode => {
  const clusterMeta = clusterMetaFromContext(context);
  const ports = d.ports ?? [];
  const ready = readyList(d);
  const notReady = notReadyList(d);
  return (
    <TrafficFlowSection label="Endpoints" tone="inbound">
      <TrafficFlowCard>
        <TrafficFlow
          from={
            <FlowEndpoints label="Requests" fit>
              <FlowEndpoint>
                {ports.length > 0 ? (
                  <FlowEntries label="Ports">
                    {withStableListKeys(ports, (port) => JSON.stringify(port)).map(
                      ({ key, value }) => (
                        <PortEntry key={key} port={value} />
                      )
                    )}
                  </FlowEntries>
                ) : (
                  <FlowSubject>No ports defined</FlowSubject>
                )}
              </FlowEndpoint>
            </FlowEndpoints>
          }
          middle={<FlowArrow />}
          to={
            <FlowEndpoints label="Endpoint addresses">
              {ready.length > 0 && (
                <AddressBox label="Ready" addresses={ready} limit={10} clusterMeta={clusterMeta} />
              )}
              {notReady.length > 0 && (
                <AddressBox
                  label="Not ready"
                  addresses={notReady}
                  limit={5}
                  clusterMeta={clusterMeta}
                />
              )}
              {ready.length + notReady.length === 0 && (
                <FlowEndpoint warning>
                  <FlowSubject>No endpoints</FlowSubject>
                </FlowEndpoint>
              )}
            </FlowEndpoints>
          }
        />
      </TrafficFlowCard>
    </TrafficFlowSection>
  );
};

export const endpointSliceDescriptor: OverviewDescriptor<EndpointSliceDetails> = {
  displayKind: 'EndpointSlice',
  dtoName: 'EndpointSliceDetails',
  schema: {
    items: [
      {
        field: 'addressType',
        label: 'Address Type',
        render: (d) => d.addressType || 'IPv4',
      },
      {
        // The Status row derives from the ready/not-ready address counts.
        field: 'readyAddresses',
        derivedFrom: ['notReadyAddresses'],
        label: 'Status',
        render: renderStatus,
      },
      {
        label: 'Service',
        hidden: (d) => !d.labels?.[SERVICE_NAME_LABEL],
        render: renderServiceLink,
      },
      {
        kind: 'widget',
        consumes: ['ports', 'readyAddresses', 'notReadyAddresses'],
        render: renderEndpointsSection,
      },
    ],
  },
  // Not surfaced in the Overview: `details` (table-summary string).
  coveredElsewhere: ['details'],
};
