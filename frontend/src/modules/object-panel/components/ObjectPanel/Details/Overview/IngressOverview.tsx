/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/IngressOverview.tsx
 */

import React from 'react';
import { types } from '@wailsjs/go/models';
import { OverviewItem } from '@modules/object-panel/components/ObjectPanel/Details/Overview/shared/OverviewItem';
import { ResourceHeader } from '@shared/components/kubernetes/ResourceHeader';
import { ResourceMetadata } from '@shared/components/kubernetes/ResourceMetadata';
import './shared/OverviewBlocks.css';

interface IngressOverviewProps {
  ingressDetails: types.IngressDetails | null;
}

const formatBackend = (backend: types.IngressBackendDetails): string =>
  backend.serviceName ? `${backend.serviceName}:${backend.servicePort}` : (backend.resource ?? '');

export const IngressOverview: React.FC<IngressOverviewProps> = ({ ingressDetails }) => {
  if (!ingressDetails) return null;

  return (
    <>
      <ResourceHeader
        kind="Ingress"
        name={ingressDetails.name}
        namespace={ingressDetails.namespace}
        age={ingressDetails.age}
      />

      {ingressDetails.ingressClassName && (
        <OverviewItem label="Ingress Class" value={ingressDetails.ingressClassName} />
      )}

      {ingressDetails.loadBalancerStatus && ingressDetails.loadBalancerStatus.length > 0 && (
        <OverviewItem
          label="Load Balancer"
          value={ingressDetails.loadBalancerStatus.join(', ')}
          fullWidth={ingressDetails.loadBalancerStatus.length > 1}
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
                            {path.pathType ? `(${path.pathType}) ` : ''}→{' '}
                            {formatBackend(path.backend)}
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
                        <span className="overview-row-value">{tls.hosts.join(', ')}</span>
                      </div>
                    )}
                    {tls.secretName && (
                      <div className="overview-row">
                        <span className="overview-row-label">Secret</span>
                        <span className="overview-row-value">{tls.secretName}</span>
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
          value={formatBackend(ingressDetails.defaultBackend)}
        />
      )}

      <ResourceMetadata labels={ingressDetails.labels} annotations={ingressDetails.annotations} />
    </>
  );
};
