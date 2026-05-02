/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/IngressOverview.tsx
 */

import React from 'react';
import { types } from '@wailsjs/go/models';
import { OverviewItem } from '@modules/object-panel/components/ObjectPanel/Details/Overview/shared/OverviewItem';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { ObjectPanelLink } from '@shared/components/ObjectPanelLink';
import { ResourceHeader } from '@shared/components/kubernetes/ResourceHeader';
import { ResourceMetadata } from '@shared/components/kubernetes/ResourceMetadata';
import { StatusChip } from '@shared/components/StatusChip';
import { buildRequiredObjectReference } from '@shared/utils/objectIdentity';
import './shared/OverviewBlocks.css';

interface IngressOverviewProps {
  ingressDetails: types.IngressDetails | null;
}

interface ClusterMeta {
  clusterId?: string;
  clusterName?: string;
}

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
  backend: types.IngressBackendDetails,
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

export const IngressOverview: React.FC<IngressOverviewProps> = ({ ingressDetails }) => {
  const { objectData } = useObjectPanel();
  const clusterMeta: ClusterMeta = {
    clusterId: objectData?.clusterId ?? undefined,
    clusterName: objectData?.clusterName ?? undefined,
  };

  if (!ingressDetails) return null;
  const namespace = ingressDetails.namespace;
  const lbAddresses = ingressDetails.loadBalancerStatus ?? [];

  return (
    <>
      <ResourceHeader
        kind="Ingress"
        name={ingressDetails.name}
        namespace={namespace}
        age={ingressDetails.age}
      />

      {/* Address — surfaced near the top because it's the most-asked
          question for an Ingress ("what URL does this expose?"). When the
          controller hasn't assigned an address yet, render an info chip so
          the row still appears and the empty state is explicit. */}
      <OverviewItem
        label="Address"
        value={
          lbAddresses.length > 0 ? (
            lbAddresses.join(', ')
          ) : (
            <StatusChip variant="info">no address</StatusChip>
          )
        }
        fullWidth={lbAddresses.length > 1}
      />

      {ingressDetails.ingressClassName && (
        <OverviewItem
          label="Ingress Class"
          value={
            <ObjectPanelLink
              objectRef={buildRequiredObjectReference({
                kind: 'ingressclass',
                name: ingressDetails.ingressClassName,
                ...clusterMeta,
              })}
            >
              {ingressDetails.ingressClassName}
            </ObjectPanelLink>
          }
        />
      )}

      {ingressDetails.rules && ingressDetails.rules.length > 0 && (
        <OverviewItem
          label="Rules"
          value={
            <div className="overview-card-list">
              {ingressDetails.rules.map((rule: types.IngressRuleDetails, ruleIndex: number) => (
                <div key={`rule-${ruleIndex}-${rule.host ?? 'default'}`} className="overview-card">
                  <div className="overview-card-header">
                    <span className="overview-card-title">{rule.host || 'Default'}</span>
                  </div>
                  {rule.paths && rule.paths.length > 0 && (
                    <div className="overview-card-rows">
                      {rule.paths.map((path: types.IngressPathDetails, pathIndex: number) => (
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
          }
          fullWidth
        />
      )}

      {ingressDetails.tls && ingressDetails.tls.length > 0 && (
        <OverviewItem
          label="TLS"
          value={
            <div className="overview-card-list">
              {ingressDetails.tls.map((tls: types.IngressTLSDetails, index: number) => (
                <div
                  key={`tls-${index}-${tls.secretName ?? 'no-secret'}`}
                  className="overview-card"
                >
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
          }
          fullWidth
        />
      )}

      {ingressDetails.defaultBackend && (
        <OverviewItem
          label="Default Backend"
          value={renderBackend(ingressDetails.defaultBackend, namespace, clusterMeta)}
        />
      )}

      <ResourceMetadata labels={ingressDetails.labels} annotations={ingressDetails.annotations} />
    </>
  );
};
