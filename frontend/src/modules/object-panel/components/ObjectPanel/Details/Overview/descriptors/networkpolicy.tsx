/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/descriptors/networkpolicy.tsx
 *
 * NetworkPolicy Overview descriptor. Each rule renders as a flow built from the ReferenceGrant
 * diagram boxes: allowed sources → ports → this policy's pods (Ingress), or this policy's pods →
 * ports → allowed destinations (Egress). Every peer is its own box, so separate boxes are
 * alternatives (OR) while the namespace and pod terms inside one box apply together (AND).
 */

import type { networkpolicy } from '@core/backend-api/models';
import { withStableListKeys } from '@shared/utils/stableListKeys';
import type React from 'react';
import { Fragment } from 'react';
import type { OverviewDescriptor } from '../schema';
import { labelSelectorTerms } from '../shared/labelSelector';
import '../shared/OverviewBlocks.css';
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

/** Lets a long "prefix/key=value" term wrap after "/" or "=" instead of mid-word. */
const SelectorTerm: React.FC<{ term: string }> = ({ term }) => {
  const parts = (term.match(/[^/=]*[/=]?/g) ?? []).filter(Boolean);
  return (
    <>
      {withStableListKeys(parts, (part) => part).map(({ key, value }, index) => (
        <Fragment key={key}>
          {index > 0 && <wbr />}
          {value}
        </Fragment>
      ))}
    </>
  );
};

const TermLines: React.FC<{ terms: string[] }> = ({ terms }) => (
  <>
    {withStableListKeys(terms, (term) => term).map(({ key, value }) => (
      <div key={key} className="reference-grant-item">
        <SelectorTerm term={value} />
      </div>
    ))}
  </>
);

const MutedLine: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="reference-grant-item network-policy-muted">{children}</div>
);

// A peer without a namespaceSelector is limited to the policy's own namespace; an empty
// namespaceSelector matches every namespace.
const namespaceScope = (
  peer: NetworkPolicyPeer,
  policyNamespace: string
): { heading: string; terms: string[] } => {
  if (!peer.namespaceSelector) {
    return { heading: `Namespace ${policyNamespace}`, terms: [] };
  }
  const terms = labelSelectorTerms(peer.namespaceSelector);
  return { heading: terms.length > 0 ? 'Namespaces matching' : 'All namespaces', terms };
};

const PodPeer: React.FC<{ peer: NetworkPolicyPeer; policyNamespace: string }> = ({
  peer,
  policyNamespace,
}) => {
  const scope = namespaceScope(peer, policyNamespace);
  const podTerms = labelSelectorTerms(peer.podSelector);
  return (
    <>
      <div className="reference-grant-namespace">{scope.heading}</div>
      <TermLines terms={scope.terms} />
      <MutedLine>{podTerms.length > 0 ? 'pods matching' : 'all pods'}</MutedLine>
      <TermLines terms={podTerms} />
    </>
  );
};

const IPBlockPeer: React.FC<{ ipBlock: networkpolicy.IPBlock }> = ({ ipBlock }) => (
  <>
    <div className="reference-grant-namespace">IP range</div>
    <div className="reference-grant-item">{ipBlock.cidr}</div>
    {withStableListKeys(ipBlock.except ?? [], (cidr) => cidr).map(({ key, value }) => (
      <MutedLine key={key}>except {value}</MutedLine>
    ))}
  </>
);

const PeerList: React.FC<{
  label: 'Sources' | 'Destinations';
  peers?: NetworkPolicyPeer[] | null;
  policyNamespace: string;
}> = ({ label, peers, policyNamespace }) => (
  <ul className="reference-grant-side-stack network-policy-list" aria-label={label}>
    {peers && peers.length > 0 ? (
      withStableListKeys(peers, (peer) => JSON.stringify(peer)).map(({ key, value: peer }) => (
        <li key={key} className="reference-grant-side">
          {peer.ipBlock ? (
            <IPBlockPeer ipBlock={peer.ipBlock} />
          ) : (
            <PodPeer peer={peer} policyNamespace={policyNamespace} />
          )}
        </li>
      ))
    ) : (
      // No peers in a rule means traffic is allowed from (or to) anywhere.
      <li className="reference-grant-side">
        <div className="reference-grant-namespace">
          {label === 'Sources' ? 'Any source' : 'Any destination'}
        </div>
        <MutedLine>any pod or IP</MutedLine>
      </li>
    )}
  </ul>
);

const SelectedPods: React.FC<{ policy: NetworkPolicyDetails }> = ({ policy }) => {
  const terms = labelSelectorTerms(policy.podSelector);
  return (
    <ul className="reference-grant-side-stack network-policy-list" aria-label="Selected pods">
      <li className="reference-grant-side network-policy-selected">
        <div className="reference-grant-namespace">This policy's pods · {policy.namespace}</div>
        {terms.length > 0 ? <TermLines terms={terms} /> : <MutedLine>all pods</MutedLine>}
      </li>
    </ul>
  );
};

const Flow: React.FC<{
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
  return (
    <div className="reference-grant-diagram network-policy-flow">
      {from}
      {middle}
      {to}
    </div>
  );
};

const RulePorts: React.FC<{ ports?: NetworkPolicyPort[] | null }> = ({ ports }) => {
  const labels = ports && ports.length > 0 ? ports.map(formatPort) : ['All ports'];
  return (
    <div className="network-policy-flow-ports">
      <span className="reference-grant-arrow" aria-hidden="true">
        →
      </span>
      <ul className="network-policy-list" aria-label="Ports">
        {withStableListKeys(labels, (label) => label).map(({ key, value }) => (
          <li key={key}>{value}</li>
        ))}
      </ul>
    </div>
  );
};

const DeniedMarker: React.FC = () => (
  <div className="network-policy-flow-ports network-policy-denied">
    <span className="reference-grant-arrow" aria-hidden="true">
      ✕
    </span>
    <span>denied</span>
  </div>
);

const DirectionContent: React.FC<{ policy: NetworkPolicyDetails; direction: Direction }> = ({
  policy,
  direction,
}) => {
  if (!policy.policyTypes?.includes(direction)) {
    return <span className="network-policy-muted">No {direction.toLowerCase()} rules</span>;
  }
  const rules = (direction === 'Ingress' ? policy.ingressRules : policy.egressRules) ?? [];
  // A restricted direction with no rules allows no traffic at all.
  if (rules.length === 0) {
    return (
      <div className="network-policy-card network-policy-card--denied">
        <Flow direction={direction} policy={policy} middle={<DeniedMarker />} />
      </div>
    );
  }
  return (
    <ol className="network-policy-list network-policy-rules" aria-label={`${direction} rules`}>
      {withStableListKeys(rules, (rule) => JSON.stringify(rule)).map(
        ({ key, value: rule }, index) => (
          <li key={key} className="network-policy-rule network-policy-card">
            <div className="network-policy-rule-title">
              {direction} · Rule {index + 1}
            </div>
            <Flow
              direction={direction}
              policy={policy}
              peers={direction === 'Ingress' ? rule.from : rule.to}
              middle={<RulePorts ports={rule.ports} />}
            />
          </li>
        )
      )}
    </ol>
  );
};

const directionSection = (direction: Direction) => (policy: NetworkPolicyDetails) => (
  <section
    className={`network-policy-direction network-policy-direction--${direction.toLowerCase()}`}
    aria-label={direction}
  >
    <h3 className="metadata-label">{direction}</h3>
    <DirectionContent policy={policy} direction={direction} />
  </section>
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
