/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/descriptors/ingress.tsx
 *
 * Ingress Overview descriptor (X1). Presentation ported verbatim from IngressOverview.tsx. Cluster
 * identity comes from the renderer's OverviewContext (the legacy component read it from
 * useObjectPanel); everything else reads the raw ingress.IngressDetails DTO.
 */

import type { ingress } from '@core/backend-api/models';
import { ObjectPanelLink } from '@shared/components/ObjectPanelLink';
import { StatusChip } from '@shared/components/StatusChip';
import { buildRequiredObjectReference } from '@shared/utils/objectIdentity';
import { withStableListKeys } from '@shared/utils/stableListKeys';
import React from 'react';
import type { OverviewContext, OverviewDescriptor } from '../schema';
import { ExternalHostLinks } from '../shared/ExternalHostLinks';
import { ingressHostSchemes } from '../shared/hostLink';
import {
  FlowArrow,
  FlowEndpoint,
  FlowEndpoints,
  FlowScope,
  FlowSubject,
  FlowTerm,
  FlowTermLines,
  TrafficFlow,
  TrafficFlowRule,
  TrafficFlowRules,
  TrafficFlowSection,
} from '../shared/TrafficFlow';
import '../shared/OverviewBlocks.css';

type IngressDetails = ingress.IngressDetails;

interface ClusterMeta {
  clusterId?: string;
  clusterName?: string;
}

const clusterMetaOf = (context: OverviewContext): ClusterMeta => ({
  clusterId: context.clusterId,
  clusterName: context.clusterName,
});

// Path type decides how a request path is compared (Ingress spec).
const pathSubject = (pathType: string): string => {
  if (pathType === 'Exact') {
    return 'Path exactly';
  }
  if (pathType === 'Prefix') {
    return 'Paths starting with';
  }
  return 'Paths matching (controller-specific)';
};

const BackendEndpoint: React.FC<{
  backend: ingress.IngressBackendDetails;
  namespace: string;
  clusterMeta: ClusterMeta;
}> = ({ backend, namespace, clusterMeta }) => (
  <FlowEndpoints label="Backend">
    <FlowEndpoint target>
      {backend.serviceName ? (
        <>
          <FlowSubject>Service</FlowSubject>
          <div className="reference-grant-item">
            <ObjectPanelLink
              objectRef={buildRequiredObjectReference({
                kind: 'service',
                name: backend.serviceName,
                namespace,
                ...clusterMeta,
              })}
            >
              {backend.serviceName}
            </ObjectPanelLink>
          </div>
        </>
      ) : (
        <>
          <FlowSubject>Resource</FlowSubject>
          <FlowTermLines terms={[backend.resource ?? '']} />
        </>
      )}
    </FlowEndpoint>
  </FlowEndpoints>
);

const backendPorts = (backend: ingress.IngressBackendDetails): string[] =>
  backend.servicePort ? [`port ${backend.servicePort}`] : [];

const PathFlow: React.FC<{
  path: ingress.IngressPathDetails;
  host?: string;
  namespace: string;
  clusterMeta: ClusterMeta;
}> = ({ path, host, namespace, clusterMeta }) => (
  <TrafficFlow
    from={
      <FlowEndpoints label="Requests">
        <FlowEndpoint>
          <FlowSubject>{pathSubject(path.pathType)}</FlowSubject>
          <FlowTermLines terms={[path.path || '/']} />
          <FlowScope>
            {host ? (
              <>
                on <FlowTerm>{host}</FlowTerm>
              </>
            ) : (
              'on any host'
            )}
          </FlowScope>
        </FlowEndpoint>
      </FlowEndpoints>
    }
    middle={<FlowArrow label="Ports" items={backendPorts(path.backend)} />}
    to={<BackendEndpoint backend={path.backend} namespace={namespace} clusterMeta={clusterMeta} />}
  />
);

// Hosts covered by TLS are served over https; everything else over http.
const tlsHostsOf = (d: IngressDetails): string[] =>
  d.tls?.flatMap((entry) => entry.hosts ?? []) ?? [];

const renderAddress = (d: IngressDetails): React.ReactNode => {
  const lbAddresses = d.loadBalancerStatus ?? [];
  // When the controller hasn't assigned an address yet, render an info chip so the row still
  // appears and the empty state is explicit.
  return lbAddresses.length > 0 ? (
    lbAddresses.join(', ')
  ) : (
    <StatusChip variant="info">no address</StatusChip>
  );
};

const renderIngressClass = (d: IngressDetails, context: OverviewContext): React.ReactNode => {
  return (
    <ObjectPanelLink
      objectRef={buildRequiredObjectReference({
        kind: 'ingressclass',
        name: d.ingressClassName,
        ...clusterMetaOf(context),
      })}
    >
      {d.ingressClassName}
    </ObjectPanelLink>
  );
};

const RuleTitle: React.FC<{ index: number; host?: string; tlsHosts: string[] }> = ({
  index,
  host,
  tlsHosts,
}) => (
  <>
    Rule {index + 1} ·{' '}
    {host ? (
      <ExternalHostLinks
        host={host}
        schemes={ingressHostSchemes(host, tlsHosts).map((scheme) => ({ scheme }))}
      />
    ) : (
      'any host'
    )}
  </>
);

// Each host rule is a card with one flow per path; the default backend takes every request no
// rule matches.
const renderRulesSection = (d: IngressDetails, context: OverviewContext): React.ReactNode => {
  const rules = d.rules ?? [];
  if (rules.length === 0 && !d.defaultBackend) {
    return null;
  }
  const clusterMeta = clusterMetaOf(context);
  const tlsHosts = tlsHostsOf(d);
  return (
    <TrafficFlowSection label="Rules" tone="inbound">
      <TrafficFlowRules label="Ingress rules">
        {withStableListKeys(rules, (rule) => JSON.stringify(rule)).map(
          ({ key, value: rule }, index) => (
            <TrafficFlowRule
              key={key}
              title={<RuleTitle index={index} host={rule.host} tlsHosts={tlsHosts} />}
            >
              {withStableListKeys(rule.paths ?? [], (path) => JSON.stringify(path)).map(
                ({ key: pathKey, value: path }) => (
                  <PathFlow
                    key={pathKey}
                    path={path}
                    host={rule.host}
                    namespace={d.namespace}
                    clusterMeta={clusterMeta}
                  />
                )
              )}
            </TrafficFlowRule>
          )
        )}
        {!!d.defaultBackend && (
          <TrafficFlowRule title="Default backend">
            <TrafficFlow
              from={
                <FlowEndpoints label="Requests">
                  <FlowEndpoint>
                    <FlowSubject>All other requests</FlowSubject>
                  </FlowEndpoint>
                </FlowEndpoints>
              }
              middle={<FlowArrow label="Ports" items={backendPorts(d.defaultBackend)} />}
              to={
                <BackendEndpoint
                  backend={d.defaultBackend}
                  namespace={d.namespace}
                  clusterMeta={clusterMeta}
                />
              }
            />
          </TrafficFlowRule>
        )}
      </TrafficFlowRules>
    </TrafficFlowSection>
  );
};

const renderTls = (d: IngressDetails, context: OverviewContext): React.ReactNode => {
  const namespace = d.namespace;
  const clusterMeta = clusterMetaOf(context);
  return (
    <div className="overview-card-list">
      {withStableListKeys(d.tls ?? [], (tls) => JSON.stringify(tls)).map(({ key, value: tls }) => (
        <div key={key} className="overview-card">
          <div className="overview-card-rows">
            {tls.hosts && tls.hosts.length > 0 && (
              <div className="overview-row">
                <span className="overview-row-label">Hosts</span>
                <span className="overview-row-value">
                  {withStableListKeys(tls.hosts, (host) => host).map(
                    ({ key: hostKey, value: host }, i) => (
                      <React.Fragment key={hostKey}>
                        {i > 0 && ' '}
                        <StatusChip variant="info">{host}</StatusChip>
                      </React.Fragment>
                    )
                  )}
                </span>
              </div>
            )}
            {!!tls.secretName && (
              <div className="overview-row">
                <span className="overview-row-label">Secret</span>
                <span className="overview-row-value">
                  <ObjectPanelLink
                    objectRef={buildRequiredObjectReference({
                      kind: 'secret',
                      name: tls.secretName,
                      namespace,
                      ...clusterMeta,
                    })}
                  >
                    {tls.secretName}
                  </ObjectPanelLink>
                </span>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

export const ingressDescriptor: OverviewDescriptor<IngressDetails> = {
  displayKind: 'Ingress',
  dtoName: 'IngressDetails',
  schema: {
    items: [
      {
        // Address — surfaced near the top because it's the most-asked question for an Ingress
        // ("what URL does this expose?").
        field: 'loadBalancerStatus',
        label: 'Address',
        fullWidth: (d) => (d.loadBalancerStatus ?? []).length > 1,
        render: renderAddress,
      },
      {
        field: 'ingressClassName',
        label: 'Ingress Class',
        hidden: (d) => !d.ingressClassName,
        render: renderIngressClass,
      },
      {
        field: 'tls',
        label: 'TLS',
        fullWidth: true,
        hidden: (d) => !(d.tls && d.tls.length > 0),
        render: renderTls,
      },
      {
        kind: 'widget',
        consumes: ['rules', 'defaultBackend', 'tls'],
        render: renderRulesSection,
      },
    ],
  },
  // `details` is the table-summary string, not surfaced in the Overview. `namespace` is consumed by
  // the rules section and TLS render fns but is already a frame field.
  coveredElsewhere: ['details'],
};
