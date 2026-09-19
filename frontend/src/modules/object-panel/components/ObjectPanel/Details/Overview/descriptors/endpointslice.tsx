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

const AddressRow: React.FC<{
  address: endpointslice.EndpointSliceAddress;
  clusterMeta: ClusterMeta;
}> = ({ address, clusterMeta }) => (
  <div className="address-row">
    <span className="address-ip">{address.ip}</span>
    {!!address.targetRef && (
      <>
        <span className="address-arrow">→</span>
        <TargetRefLink targetRef={address.targetRef} clusterName={clusterMeta.clusterName} />
      </>
    )}
    {!!address.nodeName && (
      <>
        <span className="address-on">on</span>
        <ObjectPanelLink
          className="address-node"
          objectRef={buildRequiredObjectReference({
            kind: 'Node',
            name: address.nodeName,
            ...clusterMeta,
          })}
        >
          {address.nodeName}
        </ObjectPanelLink>
      </>
    )}
  </div>
);

const AddressList: React.FC<{
  addresses: endpointslice.EndpointSliceAddress[];
  limit: number;
  clusterMeta: ClusterMeta;
}> = ({ addresses, limit, clusterMeta }) => (
  <div className="addresses-list">
    {withStableListKeys(addresses.slice(0, limit), (address) => address.ip).map(
      ({ key, value: addr }) => (
        <AddressRow key={key} address={addr} clusterMeta={clusterMeta} />
      )
    )}
    {addresses.length > limit && (
      <div className="addresses-more">... and {addresses.length - limit} more</div>
    )}
  </div>
);

const formatPortValue = (port: endpointslice.EndpointSlicePort): string => {
  const protocol = port.protocol ? `/${port.protocol}` : '';
  const appProtocol = port.appProtocol ? ` (${port.appProtocol})` : '';
  return `${port.port}${protocol}${appProtocol}`;
};

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
        // Ready addresses are also keyed off `readyAddresses` (already covered above).
        field: 'readyAddresses',
        label: 'Ready',
        fullWidth: true,
        hidden: (d) => readyList(d).length === 0,
        render: (d, context) => (
          <AddressList
            addresses={readyList(d)}
            limit={10}
            clusterMeta={clusterMetaFromContext(context)}
          />
        ),
      },
      {
        field: 'notReadyAddresses',
        label: 'Not Ready',
        fullWidth: true,
        hidden: (d) => notReadyList(d).length === 0,
        render: (d, context) => (
          <AddressList
            addresses={notReadyList(d)}
            limit={5}
            clusterMeta={clusterMetaFromContext(context)}
          />
        ),
      },
      {
        field: 'ports',
        label: 'Ports',
        fullWidth: true,
        hidden: (d) => (d.ports ?? []).length === 0,
        render: (d) => (
          <div className="overview-row-list">
            {withStableListKeys(d.ports ?? [], (port) => JSON.stringify(port)).map(
              ({ key, value: port }) => (
                <div key={key} className="overview-row">
                  <span className="overview-row-label">{port.name || `port ${port.port}`}</span>
                  <span className="overview-row-value">{formatPortValue(port)}</span>
                </div>
              )
            )}
          </div>
        ),
      },
    ],
  },
  // Not surfaced in the Overview: `details` (table-summary string).
  coveredElsewhere: ['details'],
};
