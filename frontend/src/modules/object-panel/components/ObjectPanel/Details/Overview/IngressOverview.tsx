/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/IngressOverview.tsx
 *
 * Module source for IngressOverview.
 */
import React from 'react';
import { types } from '@wailsjs/go/models';
import { OverviewItem } from '@modules/object-panel/components/ObjectPanel/Details/Overview/shared/OverviewItem';
import { ResourceHeader } from '@shared/components/kubernetes/ResourceHeader';
import { ResourceMetadata } from '@shared/components/kubernetes/ResourceMetadata';
import './NetworkOverview.css';

interface IngressOverviewProps {
  ingressDetails: types.IngressDetails | null;
}

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

      {/* Ingress Class */}
      {ingressDetails.ingressClassName && (
        <OverviewItem label="Ingress Class" value={ingressDetails.ingressClassName} />
      )}

      {/* Load Balancer Status */}
      {ingressDetails.loadBalancerStatus && ingressDetails.loadBalancerStatus.length > 0 && (
        <OverviewItem
          label="Load Balancer"
          value={ingressDetails.loadBalancerStatus.join(', ')}
          fullWidth={ingressDetails.loadBalancerStatus.length > 1}
        />
      )}

      {/* Rules */}
      {ingressDetails.rules && ingressDetails.rules.length > 0 && (
        <OverviewItem
          label="Rules"
          value={
            <div className="ingress-rules-list">
              {ingressDetails.rules.map((rule: types.IngressRuleDetails, ruleIndex: number) => (
                <div key={`rule-${ruleIndex}-${rule.host ?? 'default'}`} className="ingress-rule">
                  {rule.host && (
                    <div className="rule-host">
                      <strong>Host:</strong> {rule.host}
                    </div>
                  )}
                  {rule.paths && rule.paths.length > 0 && (
                    <div className="rule-paths">
                      {rule.paths.map((path: types.IngressPathDetails, pathIndex: number) => (
                        <div key={`path-${pathIndex}-${path.path ?? '/'}`} className="path-item">
                          <span className="path-value">{path.path || '/'}</span>
                          <span className="path-type"> ({path.pathType})</span>
                          <span className="path-arrow"> → </span>
                          {path.backend.serviceName ? (
                            <span className="backend-service">
                              {path.backend.serviceName}:{path.backend.servicePort}
                            </span>
                          ) : (
                            <span className="backend-resource">{path.backend.resource}</span>
                          )}
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

      {/* TLS Configuration */}
      {ingressDetails.tls && ingressDetails.tls.length > 0 && (
        <OverviewItem
          label="TLS"
          value={
            <div className="tls-list">
              {ingressDetails.tls.map((tls: types.IngressTLSDetails, index: number) => (
                <div key={`tls-${index}-${tls.secretName ?? 'no-secret'}`} className="tls-item">
                  {tls.hosts && tls.hosts.length > 0 && (
                    <div className="tls-hosts">
                      <strong>Hosts:</strong> {tls.hosts.join(', ')}
                    </div>
                  )}
                  {tls.secretName && (
                    <div className="tls-secret">
                      <strong>Secret:</strong> {tls.secretName}
                    </div>
                  )}
                </div>
              ))}
            </div>
          }
          fullWidth
        />
      )}

      {/* Default Backend */}
      {ingressDetails.defaultBackend && (
        <OverviewItem
          label="Default Backend"
          value={
            ingressDetails.defaultBackend.serviceName
              ? `${ingressDetails.defaultBackend.serviceName}:${ingressDetails.defaultBackend.servicePort}`
              : ingressDetails.defaultBackend.resource
          }
        />
      )}

      {/* Labels and Annotations */}
      <ResourceMetadata labels={ingressDetails.labels} annotations={ingressDetails.annotations} />
    </>
  );
};
