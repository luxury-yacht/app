/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/NetworkPolicyOverview.tsx
 */

import React from 'react';
import { types } from '@wailsjs/go/models';
import { OverviewItem } from '@modules/object-panel/components/ObjectPanel/Details/Overview/shared/OverviewItem';
import { ResourceHeader } from '@shared/components/kubernetes/ResourceHeader';
import { ResourceMetadata } from '@shared/components/kubernetes/ResourceMetadata';
import './shared/OverviewBlocks.css';

interface NetworkPolicyOverviewProps {
  networkPolicyDetails: types.NetworkPolicyDetails | null;
}

const formatSelector = (selector: Record<string, string>): string =>
  Object.entries(selector)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');

const formatPort = (port: types.NetworkPolicyPort): string => {
  const protocol = port.protocol ? `${port.protocol}/` : '';
  const portValue = port.port ?? '';
  const range = port.endPort ? `-${port.endPort}` : '';
  return `${protocol}${portValue}${range}`;
};

const PeerLines: React.FC<{ peers: types.NetworkPolicyPeer[]; keyPrefix: string }> = ({
  peers,
  keyPrefix,
}) => (
  <>
    {peers.flatMap((peer, peerIndex) => {
      const lines: React.ReactNode[] = [];
      const baseKey = `${keyPrefix}-${peerIndex}`;
      if (peer.podSelector && Object.keys(peer.podSelector).length > 0) {
        lines.push(
          <div key={`${baseKey}-pods`}>
            Pods: {formatSelector(peer.podSelector as Record<string, string>)}
          </div>
        );
      }
      if (peer.namespaceSelector && Object.keys(peer.namespaceSelector).length > 0) {
        lines.push(
          <div key={`${baseKey}-ns`}>
            Namespaces: {formatSelector(peer.namespaceSelector as Record<string, string>)}
          </div>
        );
      }
      if (peer.ipBlock) {
        lines.push(
          <div key={`${baseKey}-ip`}>
            IP Block: {peer.ipBlock.cidr}
            {peer.ipBlock.except && peer.ipBlock.except.length > 0 && (
              <span> (except: {peer.ipBlock.except.join(', ')})</span>
            )}
          </div>
        );
      }
      return lines;
    })}
  </>
);

const RuleCard: React.FC<{
  rule: types.NetworkPolicyRule;
  index: number;
  direction: 'ingress' | 'egress';
}> = ({ rule, index, direction }) => {
  const peers = direction === 'ingress' ? rule.from : rule.to;
  const peerLabel = direction === 'ingress' ? 'From' : 'To';
  const hasPeers = Boolean(peers && peers.length > 0);
  const hasPorts = Boolean(rule.ports && rule.ports.length > 0);

  return (
    <div className="overview-card">
      <div className="overview-card-header">
        <span className="overview-card-title">Rule {index + 1}</span>
      </div>
      {(hasPeers || hasPorts) && (
        <div className="overview-card-rows">
          {hasPeers && peers && (
            <div className="overview-row">
              <span className="overview-row-label">{peerLabel}</span>
              <span className="overview-row-value">
                <PeerLines peers={peers} keyPrefix={`${direction}-${index}`} />
              </span>
            </div>
          )}
          {hasPorts && rule.ports && (
            <div className="overview-row">
              <span className="overview-row-label">Ports</span>
              <span className="overview-row-value">{rule.ports.map(formatPort).join(', ')}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const NetworkPolicyOverview: React.FC<NetworkPolicyOverviewProps> = ({
  networkPolicyDetails,
}) => {
  if (!networkPolicyDetails) return null;

  const podSelector = networkPolicyDetails.podSelector as Record<string, string> | undefined;
  const hasPodSelector = podSelector && Object.keys(podSelector).length > 0;

  return (
    <>
      <ResourceHeader
        kind="NetworkPolicy"
        name={networkPolicyDetails.name}
        namespace={networkPolicyDetails.namespace}
        age={networkPolicyDetails.age}
      />

      {hasPodSelector ? (
        <OverviewItem
          label="Pod Selector"
          value={
            <div className="overview-ref-list">
              {Object.entries(podSelector).map(([k, v]) => (
                <div key={`${k}-${v}`} className="overview-ref-item">
                  {k}={v}
                </div>
              ))}
            </div>
          }
          fullWidth={Object.keys(podSelector).length > 2}
        />
      ) : (
        <OverviewItem label="Pod Selector" value="All pods in namespace" />
      )}

      <OverviewItem
        label="Policy Types"
        value={networkPolicyDetails.policyTypes?.join(', ') || 'None'}
      />

      {networkPolicyDetails.ingressRules && networkPolicyDetails.ingressRules.length > 0 && (
        <OverviewItem
          label="Ingress Rules"
          value={
            <div className="overview-card-list">
              {networkPolicyDetails.ingressRules.map(
                (rule: types.NetworkPolicyRule, ruleIndex: number) => (
                  <RuleCard
                    key={`ingress-rule-${ruleIndex}`}
                    rule={rule}
                    index={ruleIndex}
                    direction="ingress"
                  />
                )
              )}
            </div>
          }
          fullWidth
        />
      )}

      {networkPolicyDetails.egressRules && networkPolicyDetails.egressRules.length > 0 && (
        <OverviewItem
          label="Egress Rules"
          value={
            <div className="overview-card-list">
              {networkPolicyDetails.egressRules.map(
                (rule: types.NetworkPolicyRule, ruleIndex: number) => (
                  <RuleCard
                    key={`egress-rule-${ruleIndex}`}
                    rule={rule}
                    index={ruleIndex}
                    direction="egress"
                  />
                )
              )}
            </div>
          }
          fullWidth
        />
      )}

      <ResourceMetadata
        labels={networkPolicyDetails.labels}
        annotations={networkPolicyDetails.annotations}
      />
    </>
  );
};
