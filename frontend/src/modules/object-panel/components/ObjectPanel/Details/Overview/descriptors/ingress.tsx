/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/descriptors/ingress.tsx
 *
 * Ingress Overview descriptor (X1). Presentation ported verbatim from IngressOverview.tsx. Cluster
 * identity comes from the renderer's OverviewContext (the legacy component read it from
 * useObjectPanel); everything else reads the raw ingress.IngressDetails DTO.
 */

import React from 'react';
import { ingress } from '@wailsjs/go/models';
import { ExternalHostLinks } from '../shared/ExternalHostLinks';
import { ingressHostSchemes } from '../shared/hostLink';
import { ObjectPanelLink } from '@shared/components/ObjectPanelLink';
import { StatusChip } from '@shared/components/StatusChip';
import { buildRequiredObjectReference } from '@shared/utils/objectIdentity';
import type { OverviewContext, OverviewDescriptor } from '../schema';
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

const pathTypeTooltip = (pathType: string): string | undefined => {
  switch (pathType) {
    case 'Prefix':
      return 'URL paths matching this prefix (segment-aligned) are routed to the backend.';
    case 'Exact':
      return 'URL must match this path exactly, case-sensitive.';
    case 'ImplementationSpecific':
      return 'Path matching is left to the IngressClass controller; semantics vary by implementation.';
    default:
      return undefined;
  }
};

const renderBackend = (
  backend: ingress.IngressBackendDetails,
  namespace: string,
  clusterMeta: ClusterMeta
): React.ReactNode => {
  if (backend.serviceName) {
    const portSuffix = backend.servicePort ? `:${backend.servicePort}` : '';
    return (
      <ObjectPanelLink
        objectRef={buildRequiredObjectReference({
          kind: 'service',
          name: backend.serviceName,
          namespace,
          ...clusterMeta,
        })}
      >
        {backend.serviceName}
        {portSuffix}
      </ObjectPanelLink>
    );
  }
  return backend.resource ?? '';
};

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
  // Guard internally: the renderer evaluates render() even for hidden rows, so this must be safe
  // when the field is absent (buildRequiredObjectReference throws on an empty name).
  if (!d.ingressClassName) return null;
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

const renderRules = (d: IngressDetails, context: OverviewContext): React.ReactNode => {
  const namespace = d.namespace;
  const clusterMeta = clusterMetaOf(context);
  const tlsHosts = tlsHostsOf(d);
  return (
    <div className="overview-card-list">
      {(d.rules ?? []).map((rule: ingress.IngressRuleDetails, ruleIndex: number) => (
        <div key={`rule-${ruleIndex}-${rule.host ?? 'default'}`} className="overview-card">
          <div className="overview-card-header">
            <span className="overview-card-title">
              {rule.host ? (
                <ExternalHostLinks
                  host={rule.host}
                  schemes={ingressHostSchemes(rule.host, tlsHosts).map((scheme) => ({
                    scheme,
                  }))}
                />
              ) : (
                'Default'
              )}
            </span>
          </div>
          {rule.paths && rule.paths.length > 0 && (
            <div className="overview-card-rows">
              {rule.paths.map((path: ingress.IngressPathDetails, pathIndex: number) => (
                <div key={`path-${pathIndex}-${path.path ?? '/'}`} className="overview-row">
                  <span className="overview-row-label">{path.path || '/'}</span>
                  <span className="overview-row-value">
                    {path.pathType && (
                      <>
                        <StatusChip variant="info" tooltip={pathTypeTooltip(path.pathType)}>
                          {path.pathType}
                        </StatusChip>{' '}
                      </>
                    )}
                    → {renderBackend(path.backend, namespace, clusterMeta)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

const renderTls = (d: IngressDetails, context: OverviewContext): React.ReactNode => {
  const namespace = d.namespace;
  const clusterMeta = clusterMetaOf(context);
  return (
    <div className="overview-card-list">
      {(d.tls ?? []).map((tls: ingress.IngressTLSDetails, index: number) => (
        <div key={`tls-${index}-${tls.secretName ?? 'no-secret'}`} className="overview-card">
          <div className="overview-card-rows">
            {tls.hosts && tls.hosts.length > 0 && (
              <div className="overview-row">
                <span className="overview-row-label">Hosts</span>
                <span className="overview-row-value">
                  {tls.hosts.map((host, i) => (
                    <React.Fragment key={host}>
                      {i > 0 && ' '}
                      <StatusChip variant="info">{host}</StatusChip>
                    </React.Fragment>
                  ))}
                </span>
              </div>
            )}
            {tls.secretName && (
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
  dtoClass: ingress.IngressDetails,
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
        field: 'rules',
        label: 'Rules',
        fullWidth: true,
        hidden: (d) => !(d.rules && d.rules.length > 0),
        render: renderRules,
      },
      {
        field: 'tls',
        label: 'TLS',
        fullWidth: true,
        hidden: (d) => !(d.tls && d.tls.length > 0),
        render: renderTls,
      },
      {
        field: 'defaultBackend',
        label: 'Default Backend',
        hidden: (d) => !d.defaultBackend,
        // The `hidden` predicate above keeps render() from running when defaultBackend is absent;
        // the ternary is a defensive belt-and-suspenders for the type narrowing.
        render: (d, context) =>
          d.defaultBackend
            ? renderBackend(d.defaultBackend, d.namespace, clusterMetaOf(context))
            : null,
      },
    ],
  },
  // `details` is the table-summary string, not surfaced in the Overview. `namespace` is consumed by
  // the rules/tls/default-backend render fns but is already a frame field.
  coveredElsewhere: ['details'],
};
