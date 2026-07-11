/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/descriptors/endpointslice.tsx
 *
 * EndpointSlice Overview descriptor (X1 P3). Presentation ported verbatim from EndpointsOverview.tsx.
 * The address rows link to target pods and nodes; the active cluster identity used to build those
 * object references comes from the OverviewContext threaded by the renderer (clusterId/clusterName)
 * rather than from useObjectPanel — ObjectPanelLink itself still uses the hook for navigation.
 */

import { ObjectPanelLink } from '@shared/components/ObjectPanelLink';
import { StatusChip } from '@shared/components/StatusChip';
import { buildRequiredObjectReference } from '@shared/utils/objectIdentity';
import { withStableListKeys } from '@shared/utils/stableListKeys';
import { endpointslice } from '@wailsjs/go/models';
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

const parseTargetRef = (targetRef: string): { kind: string; name: string } | null => {
  if (!targetRef) {
    return null;
  }
  const parts = targetRef.split('/');
  if (parts.length === 2) {
    return { kind: parts[0], name: parts[1] };
  }
  return null;
};

const TargetRefLink: React.FC<{
  targetRef: string;
  namespace: string;
  clusterMeta: ClusterMeta;
}> = ({ targetRef, namespace, clusterMeta }) => {
  const parsed = parseTargetRef(targetRef);
  if (!parsed) {
    return <span className="address-target">{targetRef}</span>;
  }
  let objectRef: ReturnType<typeof buildRequiredObjectReference> | null;
  try {
    objectRef = buildRequiredObjectReference({
      kind: parsed.kind,
      name: parsed.name,
      namespace,
      ...clusterMeta,
    });
  } catch {
    objectRef = null;
  }
  if (!objectRef) {
    return <span className="address-target">{targetRef}</span>;
  }
  return (
    <ObjectPanelLink className="address-target" objectRef={objectRef}>
      {targetRef}
    </ObjectPanelLink>
  );
};

const AddressRow: React.FC<{
  address: endpointslice.EndpointSliceAddress;
  namespace: string;
  clusterMeta: ClusterMeta;
}> = ({ address, namespace, clusterMeta }) => (
  <div className="address-row">
    <span className="address-ip">{address.ip}</span>
    {!!address.targetRef && (
      <>
        <span className="address-arrow">→</span>
        <TargetRefLink
          targetRef={address.targetRef}
          namespace={namespace}
          clusterMeta={clusterMeta}
        />
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
  namespace: string;
  clusterMeta: ClusterMeta;
}> = ({ addresses, limit, namespace, clusterMeta }) => (
  <div className="addresses-list">
    {withStableListKeys(addresses.slice(0, limit), (address) => address.ip).map(
      ({ key, value: addr }) => (
        <AddressRow key={key} address={addr} namespace={namespace} clusterMeta={clusterMeta} />
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
  dtoClass: endpointslice.EndpointSliceDetails,
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
            namespace={d.namespace}
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
            namespace={d.namespace}
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
