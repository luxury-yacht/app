/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/descriptors/networkpolicy.tsx
 *
 * NetworkPolicy Overview descriptor (X1 P3a). Presentation ported verbatim from
 * NetworkPolicyOverview.tsx.
 */

import React from 'react';
import { networkpolicy } from '@wailsjs/go/models';
import type { OverviewDescriptor } from '../schema';
import '../shared/OverviewBlocks.css';

type NetworkPolicyDetails = networkpolicy.NetworkPolicyDetails;

const formatSelector = (selector: Record<string, string>): string =>
  Object.entries(selector)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');

const formatPort = (port: networkpolicy.NetworkPolicyPort): string => {
  const protocol = port.protocol ? `${port.protocol}/` : '';
  const portValue = port.port ?? '';
  const range = port.endPort ? `-${port.endPort}` : '';
  return `${protocol}${portValue}${range}`;
};

const PeerLines: React.FC<{ peers: networkpolicy.NetworkPolicyPeer[]; keyPrefix: string }> = ({
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
  rule: networkpolicy.NetworkPolicyRule;
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

const renderRules = (
  rules: networkpolicy.NetworkPolicyRule[],
  direction: 'ingress' | 'egress'
): React.ReactNode => (
  <div className="overview-card-list">
    {rules.map((rule, ruleIndex) => (
      <RuleCard
        key={`${direction}-rule-${ruleIndex}`}
        rule={rule}
        index={ruleIndex}
        direction={direction}
      />
    ))}
  </div>
);

export const networkPolicyDescriptor: OverviewDescriptor<NetworkPolicyDetails> = {
  displayKind: 'NetworkPolicy',
  dtoClass: networkpolicy.NetworkPolicyDetails,
  schema: {
    items: [
      {
        field: 'podSelector',
        label: 'Pod Selector',
        fullWidth: (d) => {
          const ps = d.podSelector as Record<string, string> | undefined;
          return !!ps && Object.keys(ps).length > 2;
        },
        render: (d) => {
          const ps = d.podSelector as Record<string, string> | undefined;
          if (!ps || Object.keys(ps).length === 0) {
            return 'All pods in namespace';
          }
          return (
            <div className="overview-ref-list">
              {Object.entries(ps).map(([k, v]) => (
                <div key={`${k}-${v}`} className="overview-ref-item">
                  {k}={v}
                </div>
              ))}
            </div>
          );
        },
      },
      {
        field: 'policyTypes',
        label: 'Policy Types',
        render: (d) => d.policyTypes?.join(', ') || 'None',
      },
      {
        field: 'ingressRules',
        label: 'Ingress Rules',
        fullWidth: true,
        hidden: (d) => !(d.ingressRules && d.ingressRules.length > 0),
        render: (d) => renderRules(d.ingressRules ?? [], 'ingress'),
      },
      {
        field: 'egressRules',
        label: 'Egress Rules',
        fullWidth: true,
        hidden: (d) => !(d.egressRules && d.egressRules.length > 0),
        render: (d) => renderRules(d.egressRules ?? [], 'egress'),
      },
    ],
  },
  coveredElsewhere: ['details'],
};
