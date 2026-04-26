/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/EndpointsOverview.tsx
 */

import React, { useMemo } from 'react';
import { types } from '@wailsjs/go/models';
import { OverviewItem } from '@modules/object-panel/components/ObjectPanel/Details/Overview/shared/OverviewItem';
import { ResourceHeader } from '@shared/components/kubernetes/ResourceHeader';
import { ResourceMetadata } from '@shared/components/kubernetes/ResourceMetadata';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { ObjectPanelLink } from '@shared/components/ObjectPanelLink';
import { StatusChip } from '@shared/components/StatusChip';
import { buildObjectReference } from '@shared/utils/objectIdentity';
import './shared/OverviewBlocks.css';
import './EndpointsOverview.css';

interface EndpointSliceOverviewProps {
  endpointSliceDetails: types.EndpointSliceDetails | null;
}

interface ClusterMeta {
  clusterId?: string;
  clusterName?: string;
}

const parseTargetRef = (targetRef: string): { kind: string; name: string } | null => {
  if (!targetRef) return null;
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
  let objectRef: ReturnType<typeof buildObjectReference> | null;
  try {
    objectRef = buildObjectReference({
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
  address: types.EndpointSliceAddress;
  namespace: string;
  clusterMeta: ClusterMeta;
}> = ({ address, namespace, clusterMeta }) => (
  <div className="address-row">
    <span className="address-ip">{address.ip}</span>
    {address.targetRef && (
      <>
        <span className="address-arrow">→</span>
        <TargetRefLink
          targetRef={address.targetRef}
          namespace={namespace}
          clusterMeta={clusterMeta}
        />
      </>
    )}
    {address.nodeName && (
      <>
        <span className="address-on">on</span>
        <ObjectPanelLink
          className="address-node"
          objectRef={buildObjectReference({
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
  addresses: types.EndpointSliceAddress[];
  limit: number;
  namespace: string;
  clusterMeta: ClusterMeta;
}> = ({ addresses, limit, namespace, clusterMeta }) => (
  <div className="addresses-list">
    {addresses.slice(0, limit).map((addr, addrIndex) => (
      <AddressRow
        key={`${addr.ip}-${addrIndex}`}
        address={addr}
        namespace={namespace}
        clusterMeta={clusterMeta}
      />
    ))}
    {addresses.length > limit && (
      <div className="addresses-more">... and {addresses.length - limit} more</div>
    )}
  </div>
);

const formatPort = (port: types.EndpointSlicePort): string => {
  const name = port.name ? `${port.name}: ` : '';
  const protocol = port.protocol ? `/${port.protocol}` : '';
  const appProtocol = port.appProtocol ? ` (${port.appProtocol})` : '';
  return `${name}${port.port}${protocol}${appProtocol}`;
};

export const EndpointSliceOverview: React.FC<EndpointSliceOverviewProps> = ({
  endpointSliceDetails,
}) => {
  const { objectData } = useObjectPanel();
  const clusterId = objectData?.clusterId ?? undefined;
  const clusterName = objectData?.clusterName ?? undefined;
  const clusterMeta = useMemo<ClusterMeta>(
    () => ({ clusterId, clusterName }),
    [clusterId, clusterName]
  );

  if (!endpointSliceDetails) return null;

  const namespace = endpointSliceDetails.namespace;
  const readyAddresses = endpointSliceDetails.readyAddresses ?? [];
  const notReadyAddresses = endpointSliceDetails.notReadyAddresses ?? [];
  const ports = endpointSliceDetails.ports ?? [];
  const readyCount = readyAddresses.length;
  const notReadyCount = notReadyAddresses.length;
  const totalCount = readyCount + notReadyCount;

  const statusValue =
    totalCount === 0 ? (
      <StatusChip variant="warning">No endpoints</StatusChip>
    ) : (
      <span className="endpoint-status-chips">
        {readyCount > 0 && <StatusChip variant="healthy">{readyCount} ready</StatusChip>}
        {notReadyCount > 0 && (
          <StatusChip variant="unhealthy">{notReadyCount} not ready</StatusChip>
        )}
      </span>
    );

  return (
    <>
      <ResourceHeader
        kind="EndpointSlice"
        name={endpointSliceDetails.name}
        namespace={namespace}
        age={endpointSliceDetails.age}
      />

      <OverviewItem label="Address Type" value={endpointSliceDetails.addressType || 'IPv4'} />
      <OverviewItem label="Status" value={statusValue} />

      {readyCount > 0 && (
        <OverviewItem
          label={`Ready (${readyCount})`}
          value={
            <AddressList
              addresses={readyAddresses}
              limit={10}
              namespace={namespace}
              clusterMeta={clusterMeta}
            />
          }
          fullWidth
        />
      )}
      {notReadyCount > 0 && (
        <OverviewItem
          label={`Not Ready (${notReadyCount})`}
          value={
            <AddressList
              addresses={notReadyAddresses}
              limit={5}
              namespace={namespace}
              clusterMeta={clusterMeta}
            />
          }
          fullWidth
        />
      )}

      {ports.length > 0 && (
        <OverviewItem
          label="Ports"
          value={
            <div className="overview-ref-list">
              {ports.map((port, portIndex) => (
                <div key={`${port.port}-${portIndex}`} className="overview-ref-item">
                  {formatPort(port)}
                </div>
              ))}
            </div>
          }
          fullWidth
        />
      )}

      <ResourceMetadata
        labels={endpointSliceDetails.labels}
        annotations={endpointSliceDetails.annotations}
      />
    </>
  );
};
