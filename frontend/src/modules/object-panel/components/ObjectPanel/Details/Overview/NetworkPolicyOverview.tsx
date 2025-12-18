import React from 'react';
import { types } from '@wailsjs/go/models';
import { OverviewItem } from '@modules/object-panel/components/ObjectPanel/Details/Overview/shared/OverviewItem';
import { ResourceHeader } from '@shared/components/kubernetes/ResourceHeader';
import { ResourceMetadata } from '@shared/components/kubernetes/ResourceMetadata';
import './NetworkOverview.css';

interface NetworkPolicyOverviewProps {
  networkPolicyDetails: types.NetworkPolicyDetails | null;
}

export const NetworkPolicyOverview: React.FC<NetworkPolicyOverviewProps> = ({
  networkPolicyDetails,
}) => {
  if (!networkPolicyDetails) return null;

  return (
    <>
      <ResourceHeader
        kind="NetworkPolicy"
        name={networkPolicyDetails.name}
        namespace={networkPolicyDetails.namespace}
        age={networkPolicyDetails.age}
      />

      {/* Pod Selector */}
      {networkPolicyDetails.podSelector &&
      Object.keys(networkPolicyDetails.podSelector).length > 0 ? (
        <OverviewItem
          label="Pod Selector"
          value={
            <div className="selector-list">
              {Object.entries(networkPolicyDetails.podSelector as Record<string, string>).map(
                ([key, value], index) => (
                  <div key={`${key}-${value}-${index}`} className="selector-item">
                    {key}={value}
                  </div>
                )
              )}
            </div>
          }
          fullWidth={Object.keys(networkPolicyDetails.podSelector).length > 2}
        />
      ) : (
        <OverviewItem label="Pod Selector" value="All pods in namespace" />
      )}

      {/* Policy Types */}
      <OverviewItem
        label="Policy Types"
        value={networkPolicyDetails.policyTypes?.join(', ') || 'None'}
      />

      {/* Ingress Rules */}
      {networkPolicyDetails.ingressRules && networkPolicyDetails.ingressRules.length > 0 && (
        <OverviewItem
          label="Ingress Rules"
          value={
            <div className="policy-rules-list">
              {networkPolicyDetails.ingressRules.map(
                (rule: types.NetworkPolicyRule, ruleIndex: number) => (
                  <div key={`ingress-rule-${ruleIndex}`} className="policy-rule">
                    <div className="rule-header">Rule {ruleIndex + 1}:</div>

                    {/* From peers */}
                    {rule.from && rule.from.length > 0 && (
                      <div className="rule-peers">
                        <strong>From:</strong>
                        {rule.from.map((peer: types.NetworkPolicyPeer, peerIndex: number) => (
                          <div key={`ingress-peer-${ruleIndex}-${peerIndex}`} className="peer-item">
                            {peer.podSelector && Object.keys(peer.podSelector).length > 0 && (
                              <div className="peer-selector">
                                Pods:{' '}
                                {Object.entries(peer.podSelector as Record<string, string>)
                                  .map(([k, v]) => `${k}=${v}`)
                                  .join(', ')}
                              </div>
                            )}
                            {peer.namespaceSelector &&
                              Object.keys(peer.namespaceSelector).length > 0 && (
                                <div className="peer-selector">
                                  Namespaces:{' '}
                                  {Object.entries(peer.namespaceSelector as Record<string, string>)
                                    .map(([k, v]) => `${k}=${v}`)
                                    .join(', ')}
                                </div>
                              )}
                            {peer.ipBlock && (
                              <div className="peer-ipblock">
                                IP Block: {peer.ipBlock.cidr}
                                {peer.ipBlock.except && peer.ipBlock.except.length > 0 && (
                                  <span className="ipblock-except">
                                    {' '}
                                    (except: {peer.ipBlock.except.join(', ')})
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Ports */}
                    {rule.ports && rule.ports.length > 0 && (
                      <div className="rule-ports">
                        <strong>Ports:</strong>
                        <div className="ports-list">
                          {rule.ports.map((port: types.NetworkPolicyPort, portIndex: number) => (
                            <div
                              key={`ingress-port-${ruleIndex}-${portIndex}-${port.port ?? 'any'}`}
                              className="port-item"
                            >
                              {port.protocol && (
                                <span className="port-protocol">{port.protocol}/</span>
                              )}
                              {port.port && <span className="port-number">{port.port}</span>}
                              {port.endPort && <span className="port-range">-{port.endPort}</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )
              )}
            </div>
          }
          fullWidth
        />
      )}

      {/* Egress Rules */}
      {networkPolicyDetails.egressRules && networkPolicyDetails.egressRules.length > 0 && (
        <OverviewItem
          label="Egress Rules"
          value={
            <div className="policy-rules-list">
              {networkPolicyDetails.egressRules.map(
                (rule: types.NetworkPolicyRule, ruleIndex: number) => (
                  <div key={`egress-rule-${ruleIndex}`} className="policy-rule">
                    <div className="rule-header">Rule {ruleIndex + 1}:</div>

                    {/* To peers */}
                    {rule.to && rule.to.length > 0 && (
                      <div className="rule-peers">
                        <strong>To:</strong>
                        {rule.to.map((peer: types.NetworkPolicyPeer, peerIndex: number) => (
                          <div key={`egress-peer-${ruleIndex}-${peerIndex}`} className="peer-item">
                            {peer.podSelector && Object.keys(peer.podSelector).length > 0 && (
                              <div className="peer-selector">
                                Pods:{' '}
                                {Object.entries(peer.podSelector as Record<string, string>)
                                  .map(([k, v]) => `${k}=${v}`)
                                  .join(', ')}
                              </div>
                            )}
                            {peer.namespaceSelector &&
                              Object.keys(peer.namespaceSelector).length > 0 && (
                                <div className="peer-selector">
                                  Namespaces:{' '}
                                  {Object.entries(peer.namespaceSelector as Record<string, string>)
                                    .map(([k, v]) => `${k}=${v}`)
                                    .join(', ')}
                                </div>
                              )}
                            {peer.ipBlock && (
                              <div className="peer-ipblock">
                                IP Block: {peer.ipBlock.cidr}
                                {peer.ipBlock.except && peer.ipBlock.except.length > 0 && (
                                  <span className="ipblock-except">
                                    {' '}
                                    (except: {peer.ipBlock.except.join(', ')})
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Ports */}
                    {rule.ports && rule.ports.length > 0 && (
                      <div className="rule-ports">
                        <strong>Ports:</strong>
                        <div className="ports-list">
                          {rule.ports.map((port: types.NetworkPolicyPort, portIndex: number) => (
                            <div
                              key={`egress-port-${ruleIndex}-${portIndex}-${port.port ?? 'any'}`}
                              className="port-item"
                            >
                              {port.protocol && (
                                <span className="port-protocol">{port.protocol}/</span>
                              )}
                              {port.port && <span className="port-number">{port.port}</span>}
                              {port.endPort && <span className="port-range">-{port.endPort}</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )
              )}
            </div>
          }
          fullWidth
        />
      )}

      {/* Labels and Annotations */}
      <ResourceMetadata
        labels={networkPolicyDetails.labels}
        annotations={networkPolicyDetails.annotations}
      />
    </>
  );
};
