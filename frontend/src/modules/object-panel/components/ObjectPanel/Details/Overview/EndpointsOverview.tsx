/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/EndpointsOverview.tsx
 *
 * UI component for EndpointsOverview.
 * Handles rendering and interactions for the object panel feature.
 */

import React, { useCallback } from 'react';
import { types } from '@wailsjs/go/models';
import { ResourceHeader } from '@shared/components/kubernetes/ResourceHeader';
import { ResourceMetadata } from '@shared/components/kubernetes/ResourceMetadata';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import './EndpointsOverview.css';

interface EndpointSliceOverviewProps {
  endpointSliceDetails: types.EndpointSliceDetails | null;
}

const parseTargetRef = (targetRef: string): { kind: string; name: string } | null => {
  if (!targetRef) return null;
  const parts = targetRef.split('/');
  if (parts.length === 2) {
    return { kind: parts[0], name: parts[1] };
  }
  return null;
};

export const EndpointSliceOverview: React.FC<EndpointSliceOverviewProps> = ({
  endpointSliceDetails,
}) => {
  const { openWithObject, objectData } = useObjectPanel();
  const clusterMeta = {
    clusterId: objectData?.clusterId ?? undefined,
    clusterName: objectData?.clusterName ?? undefined,
  };

  const handleTargetClick = useCallback(
    (targetRef: string, namespace: string) => {
      const parsed = parseTargetRef(targetRef);
      if (parsed) {
        openWithObject({
          kind: parsed.kind,
          name: parsed.name,
          namespace,
          ...clusterMeta,
        });
      }
    },
    [clusterMeta, openWithObject]
  );

  const handleNodeClick = useCallback(
    (nodeName: string) => {
      openWithObject({
        kind: 'Node',
        name: nodeName,
        ...clusterMeta,
      });
    },
    [clusterMeta, openWithObject]
  );

  if (!endpointSliceDetails) return null;

  const namespace = endpointSliceDetails.namespace;

  return (
    <>
      <ResourceHeader
        kind="EndpointSlice"
        name={endpointSliceDetails.name}
        namespace={namespace}
        age={endpointSliceDetails.age}
      />

      {endpointSliceDetails.slices && endpointSliceDetails.slices.length > 0 && (
        <div className="slices-section">
          <div className="slices-label">Slices</div>
          <div className="slices-list">
            {endpointSliceDetails.slices.map(
              (slice: types.EndpointSliceSummary, sliceIndex: number) => {
                const readyCount = slice.readyAddresses?.length ?? 0;
                const notReadyCount = slice.notReadyAddresses?.length ?? 0;
                const totalCount = readyCount + notReadyCount;

                return (
                  <div
                    key={`${slice.name}-${sliceIndex}`}
                    className="slice-item"
                    aria-label="endpoint-slice"
                  >
                    <div className="slice-section">
                      <div className="slice-section-header">
                        {slice.addressType || 'IPv4'} ({readyCount}/{totalCount} ready)
                      </div>

                      {slice.readyAddresses && slice.readyAddresses.length > 0 && (
                        <div className="slice-addresses">
                          <div className="addresses-label ready">Ready</div>
                          <div className="addresses-list">
                            {slice.readyAddresses
                              .slice(0, 10)
                              .map((addr: types.EndpointSliceAddress, addrIndex: number) => (
                                <div key={`${addr.ip}-${addrIndex}`} className="address-row">
                                  <span className="address-ip">{addr.ip}</span>
                                  {addr.targetRef && (
                                    <>
                                      <span className="address-arrow">→</span>
                                      <span
                                        className="address-target object-panel-link"
                                        onClick={() =>
                                          handleTargetClick(addr.targetRef!, namespace)
                                        }
                                        role="button"
                                        tabIndex={0}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter' || e.key === ' ') {
                                            handleTargetClick(addr.targetRef!, namespace);
                                          }
                                        }}
                                      >
                                        {addr.targetRef}
                                      </span>
                                    </>
                                  )}
                                  {addr.nodeName && (
                                    <>
                                      <span className="address-on">on</span>
                                      <span
                                        className="address-node object-panel-link"
                                        onClick={() => handleNodeClick(addr.nodeName!)}
                                        role="button"
                                        tabIndex={0}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter' || e.key === ' ') {
                                            handleNodeClick(addr.nodeName!);
                                          }
                                        }}
                                      >
                                        {addr.nodeName}
                                      </span>
                                    </>
                                  )}
                                </div>
                              ))}
                            {slice.readyAddresses.length > 10 && (
                              <div className="addresses-more">
                                ... and {slice.readyAddresses.length - 10} more
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {slice.notReadyAddresses && slice.notReadyAddresses.length > 0 && (
                        <div className="slice-addresses not-ready">
                          <div className="addresses-label not-ready">Not Ready</div>
                          <div className="addresses-list">
                            {slice.notReadyAddresses
                              .slice(0, 5)
                              .map((addr: types.EndpointSliceAddress, addrIndex: number) => (
                                <div key={`${addr.ip}-${addrIndex}`} className="address-row">
                                  <span className="address-ip">{addr.ip}</span>
                                  {addr.targetRef && (
                                    <>
                                      <span className="address-arrow">→</span>
                                      <span
                                        className="address-target object-panel-link"
                                        onClick={() =>
                                          handleTargetClick(addr.targetRef!, namespace)
                                        }
                                        role="button"
                                        tabIndex={0}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter' || e.key === ' ') {
                                            handleTargetClick(addr.targetRef!, namespace);
                                          }
                                        }}
                                      >
                                        {addr.targetRef}
                                      </span>
                                    </>
                                  )}
                                  {addr.nodeName && (
                                    <>
                                      <span className="address-on">on</span>
                                      <span
                                        className="address-node object-panel-link"
                                        onClick={() => handleNodeClick(addr.nodeName!)}
                                        role="button"
                                        tabIndex={0}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter' || e.key === ' ') {
                                            handleNodeClick(addr.nodeName!);
                                          }
                                        }}
                                      >
                                        {addr.nodeName}
                                      </span>
                                    </>
                                  )}
                                </div>
                              ))}
                            {slice.notReadyAddresses.length > 5 && (
                              <div className="addresses-more">
                                ... and {slice.notReadyAddresses.length - 5} more
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    {slice.ports && slice.ports.length > 0 && (
                      <div className="slice-ports">
                        <div className="ports-label">Ports</div>
                        <div className="ports-list">
                          {slice.ports.map((port: types.EndpointSlicePort, portIndex: number) => (
                            <div key={`${port.port}-${portIndex}`} className="port-row">
                              {port.name && <span className="port-name">{port.name}:</span>}
                              <span className="port-value">
                                {port.port}/{port.protocol}
                                {port.appProtocol ? ` (${port.appProtocol})` : ''}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              }
            )}
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
