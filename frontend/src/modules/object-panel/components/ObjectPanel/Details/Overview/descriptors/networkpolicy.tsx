/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/descriptors/networkpolicy.tsx
 *
 * NetworkPolicy Overview descriptor. Each rule renders as a shared traffic flow: allowed sources →
 * ports → this policy's pods (Ingress), or this policy's pods → ports → allowed destinations
 * (Egress). Every peer is its own box, so separate boxes are alternatives (OR) while the namespace
 * and pod terms inside one box apply together (AND).
 */

import type { networkpolicy } from '@core/backend-api/models';
import { StatusChip } from '@shared/components/StatusChip';
import { withStableListKeys } from '@shared/utils/stableListKeys';
import type React from 'react';
import type { OverviewDescriptor } from '../schema';
import { labelSelectorTerms } from '../shared/labelSelector';
import {
  FlowArrow,
  FlowDenied,
  FlowEndpoint,
  FlowEndpoints,
  FlowScope,
  FlowSubject,
  FlowTerm,
  FlowTermLines,
  TrafficFlow,
  TrafficFlowDeniedCard,
  TrafficFlowRule,
  TrafficFlowRules,
  TrafficFlowSection,
} from '../shared/TrafficFlow';
import '../NetworkPolicyOverview.css';

type NetworkPolicyDetails = networkpolicy.NetworkPolicyDetails;
type NetworkPolicyPeer = networkpolicy.NetworkPolicyPeer;
type NetworkPolicyPort = networkpolicy.NetworkPolicyPort;
type Direction = 'Ingress' | 'Egress';

const formatPort = (port: NetworkPolicyPort): string => {
  // The API server defaults an unset protocol to TCP.
  const protocol = port.protocol || 'TCP';
  if (!port.port) {
    return `${protocol} (all ports)`;
  }
  return port.endPort ? `${protocol} ${port.port}-${port.endPort}` : `${protocol} ${port.port}`;
};

// Kubernetes sets this label on every namespace to the namespace's own name.
const NAMESPACE_NAME_LABEL = 'kubernetes.io/metadata.name';

/**
 * The namespace names a selector picks when its only requirement is the namespace-name label
 * (equality or In); null when anything else applies, since every requirement must hold.
 */
const selectedNamespaceNames = (selector: networkpolicy.LabelSelector): string[] | null => {
  const labels = Object.entries(selector.matchLabels ?? {});
  const expressions = selector.matchExpressions ?? [];
  if (expressions.length === 0 && labels.length === 1 && labels[0]?.[0] === NAMESPACE_NAME_LABEL) {
    return [labels[0][1] ?? ''];
  }
  const expression = expressions[0];
  if (
    labels.length === 0 &&
    expressions.length === 1 &&
    expression?.key === NAMESPACE_NAME_LABEL &&
    expression.operator === 'In'
  ) {
    return expression.values ?? [];
  }
  return null;
};

// Where pods live. Without a namespaceSelector they are in the policy's own namespace; an empty
// namespaceSelector matches every namespace.
const NamespaceScope: React.FC<{
  selector?: networkpolicy.LabelSelector | null;
  policyNamespace: string;
}> = ({ selector, policyNamespace }) => {
  const names = selector ? selectedNamespaceNames(selector) : [policyNamespace];
  if (names) {
    return (
      <FlowScope>
        in {names.length === 1 ? 'namespace' : 'namespaces'} <FlowTerm>{names.join(', ')}</FlowTerm>
      </FlowScope>
    );
  }
  const terms = labelSelectorTerms(selector);
  if (terms.length === 0) {
    return <FlowScope>in any namespace</FlowScope>;
  }
  return (
    <>
      <FlowScope>in namespaces matching</FlowScope>
      <FlowTermLines terms={terms} />
    </>
  );
};

// Which pods: an empty pod selector matches every pod.
const PodSubject: React.FC<{ selector?: networkpolicy.LabelSelector | null }> = ({ selector }) => {
  const terms = labelSelectorTerms(selector);
  return (
    <>
      <FlowSubject>{terms.length > 0 ? 'Pods matching' : 'All pods'}</FlowSubject>
      <FlowTermLines terms={terms} />
    </>
  );
};

// A pod peer reads as a sentence: which pods, then where they live.
const PodPeer: React.FC<{ peer: NetworkPolicyPeer; policyNamespace: string }> = ({
  peer,
  policyNamespace,
}) => (
  <>
    <PodSubject selector={peer.podSelector} />
    <NamespaceScope selector={peer.namespaceSelector} policyNamespace={policyNamespace} />
  </>
);

// Except ranges are carved out of the allowed range, so they render as red exclusion chips.
const IPBlockPeer: React.FC<{ ipBlock: networkpolicy.IPBlock }> = ({ ipBlock }) => (
  <>
    <FlowSubject>IP addresses</FlowSubject>
    <FlowScope>
      in <FlowTerm>{ipBlock.cidr}</FlowTerm>
    </FlowScope>
    {!!ipBlock.except?.length && (
      <div className="network-policy-excluded">
        <span className="traffic-flow-muted">excluding</span>
        <ul className="traffic-flow-list network-policy-excluded-list" aria-label="Excluded">
          {withStableListKeys(ipBlock.except, (cidr) => cidr).map(({ key, value }) => (
            <li key={key}>
              <StatusChip variant="unhealthy" className="network-policy-excluded-range">
                {value}
              </StatusChip>
            </li>
          ))}
        </ul>
      </div>
    )}
  </>
);

const PeerList: React.FC<{
  label: 'Sources' | 'Destinations';
  peers?: NetworkPolicyPeer[] | null;
  policyNamespace: string;
}> = ({ label, peers, policyNamespace }) => (
  <FlowEndpoints label={label}>
    {peers && peers.length > 0 ? (
      withStableListKeys(peers, (peer) => JSON.stringify(peer)).map(({ key, value: peer }) => (
        <FlowEndpoint key={key}>
          {peer.ipBlock ? (
            <IPBlockPeer ipBlock={peer.ipBlock} />
          ) : (
            <PodPeer peer={peer} policyNamespace={policyNamespace} />
          )}
        </FlowEndpoint>
      ))
    ) : (
      // No peers in a rule means traffic is allowed from (or to) anywhere.
      <FlowEndpoint>
        <FlowSubject>Any pod or IP address</FlowSubject>
      </FlowEndpoint>
    )}
  </FlowEndpoints>
);

// The policy's own pods read like a peer; the target outline marks their role.
const SelectedPods: React.FC<{ policy: NetworkPolicyDetails }> = ({ policy }) => (
  <FlowEndpoints label="Selected pods">
    <FlowEndpoint target>
      <PodSubject selector={policy.podSelector} />
      <NamespaceScope policyNamespace={policy.namespace} />
    </FlowEndpoint>
  </FlowEndpoints>
);

const PolicyFlow: React.FC<{
  direction: Direction;
  policy: NetworkPolicyDetails;
  peers?: NetworkPolicyPeer[] | null;
  middle: React.ReactNode;
}> = ({ direction, policy, peers, middle }) => {
  const ingress = direction === 'Ingress';
  const peerList = (
    <PeerList
      label={ingress ? 'Sources' : 'Destinations'}
      peers={peers}
      policyNamespace={policy.namespace}
    />
  );
  const selected = <SelectedPods policy={policy} />;
  const [from, to] = ingress ? [peerList, selected] : [selected, peerList];
  return <TrafficFlow from={from} middle={middle} to={to} />;
};

const rulePorts = (ports?: NetworkPolicyPort[] | null): string[] =>
  ports && ports.length > 0 ? ports.map(formatPort) : ['All ports'];

const DirectionContent: React.FC<{ policy: NetworkPolicyDetails; direction: Direction }> = ({
  policy,
  direction,
}) => {
  if (!policy.policyTypes?.includes(direction)) {
    return <span className="traffic-flow-muted">No {direction.toLowerCase()} rules</span>;
  }
  const rules = (direction === 'Ingress' ? policy.ingressRules : policy.egressRules) ?? [];
  // A restricted direction with no rules allows no traffic at all.
  if (rules.length === 0) {
    return (
      <TrafficFlowDeniedCard>
        <PolicyFlow direction={direction} policy={policy} middle={<FlowDenied />} />
      </TrafficFlowDeniedCard>
    );
  }
  return (
    <TrafficFlowRules label={`${direction} rules`}>
      {withStableListKeys(rules, (rule) => JSON.stringify(rule)).map(
        ({ key, value: rule }, index) => (
          <TrafficFlowRule key={key} title={`${direction} · Rule ${index + 1}`}>
            <PolicyFlow
              direction={direction}
              policy={policy}
              peers={direction === 'Ingress' ? rule.from : rule.to}
              middle={<FlowArrow label="Ports" items={rulePorts(rule.ports)} />}
            />
          </TrafficFlowRule>
        )
      )}
    </TrafficFlowRules>
  );
};

const directionSection = (direction: Direction) => (policy: NetworkPolicyDetails) => (
  <TrafficFlowSection
    label={direction}
    tone={direction === 'Ingress' ? 'inbound' : 'outbound'}
    directional
  >
    <DirectionContent policy={policy} direction={direction} />
  </TrafficFlowSection>
);
export const networkPolicyDescriptor: OverviewDescriptor<NetworkPolicyDetails> = {
  displayKind: 'NetworkPolicy',
  dtoName: 'NetworkPolicyDetails',
  schema: {
    items: [
      {
        kind: 'widget',
        consumes: ['podSelector', 'policyTypes', 'ingressRules'],
        render: directionSection('Ingress'),
      },
      {
        kind: 'widget',
        consumes: ['podSelector', 'policyTypes', 'egressRules'],
        render: directionSection('Egress'),
      },
    ],
  },
  coveredElsewhere: ['details'],
};
