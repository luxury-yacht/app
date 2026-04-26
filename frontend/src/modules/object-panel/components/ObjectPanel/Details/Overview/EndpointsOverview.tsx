/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/EndpointsOverview.tsx
 */

import React, { useMemo } from 'react';
import { types } from '@wailsjs/go/models';
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
  const slices = endpointSliceDetails.slices;

  return (
    <>
      <ResourceHeader
        kind="EndpointSlice"
        name={endpointSliceDetails.name}
        namespace={namespace}
        age={endpointSliceDetails.age}
      />

      {slices && slices.length > 0 && (
        <div className="slices-section">
          <div className="slices-label">Slices</div>
          <div className="overview-card-list">
            {slices.map((slice: types.EndpointSliceSummary, sliceIndex: number) => {
              const readyCount = slice.readyAddresses?.length ?? 0;
              const notReadyCount = slice.notReadyAddresses?.length ?? 0;
              const totalCount = readyCount + notReadyCount;
              const hasPorts = Boolean(slice.ports && slice.ports.length > 0);

              return (
                <div
                  key={`${slice.name}-${sliceIndex}`}
                  className="overview-card"
                  aria-label="endpoint-slice"
                >
                  <div className="overview-card-header">
                    <span className="overview-card-title">{slice.addressType || 'IPv4'}</span>{' '}
                    <span className="overview-card-meta">
                      ({readyCount}/{totalCount} ready)
                    </span>
                  </div>
                  <div className="overview-card-rows">
                    {readyCount > 0 && slice.readyAddresses && (
                      <div className="overview-row">
                        <span className="overview-row-label">
                          <StatusChip variant="healthy">Ready</StatusChip>
                        </span>
                        <span className="overview-row-value plain">
                          <AddressList
                            addresses={slice.readyAddresses}
                            limit={10}
                            namespace={namespace}
                            clusterMeta={clusterMeta}
                          />
                        </span>
                      </div>
                    )}
                    {notReadyCount > 0 && slice.notReadyAddresses && (
                      <div className="overview-row">
                        <span className="overview-row-label">
                          <StatusChip variant="unhealthy">Not Ready</StatusChip>
                        </span>
                        <span className="overview-row-value plain">
                          <AddressList
                            addresses={slice.notReadyAddresses}
                            limit={5}
                            namespace={namespace}
                            clusterMeta={clusterMeta}
                          />
                        </span>
                      </div>
                    )}
                    {hasPorts && slice.ports && (
                      <div className="overview-row">
                        <span className="overview-row-label">Ports</span>
                        <span className="overview-row-value">
                          {slice.ports.map(formatPort).join(', ')}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <ResourceMetadata
        labels={endpointSliceDetails.labels}
        annotations={endpointSliceDetails.annotations}
      />
    </>
  );
};
