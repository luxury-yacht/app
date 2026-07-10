/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/GenericOverview.tsx
 */

import { ResourceHeader } from '@shared/components/kubernetes/ResourceHeader';
import { ResourceMetadata } from '@shared/components/kubernetes/ResourceMetadata';
import { withStableListKeys } from '@shared/utils/stableListKeys';
import type React from 'react';
import { OverviewItem } from './shared/OverviewItem';

interface GenericPort {
  name?: string;
  port?: string | number;
  protocol?: string;
  targetPort?: string | number;
}

interface GenericSubject {
  kind?: string;
  namespace?: string;
  name?: string;
}

export interface GenericOverviewProps {
  group?: string;
  automountServiceAccountToken?: boolean;
  clusterIP?: string;
  clusterRoleBindings?: unknown[];
  egressRules?: unknown[];
  externalIPs?: string[];
  imagePullSecrets?: unknown[];
  ingressClassName?: string;
  ingressRules?: unknown[];
  kind?: string;
  labels?: Record<string, string>;
  loadBalancerStatus?: string[];
  name?: string;
  namespace?: string;
  podSelector?: Record<string, string>;
  policyTypes?: string[];
  ports?: GenericPort[];
  roleBindings?: unknown[];
  roleRef?: { kind?: string; name?: string };
  rules?: unknown[];
  secrets?: unknown[];
  sessionAffinity?: string;
  subjects?: GenericSubject[];
  tls?: unknown[];
  totalAddresses?: number;
  totalNotReady?: number;
  totalPorts?: number;
  type?: string;
  annotations?: Record<string, string>;
}

// Generic overview for resources that don't have a specific component yet
export const GenericOverview: React.FC<GenericOverviewProps> = (props) => {
  const {
    group,
    automountServiceAccountToken,
    clusterIP,
    clusterRoleBindings,
    egressRules,
    externalIPs,
    imagePullSecrets,
    ingressClassName,
    ingressRules,
    kind,
    labels,
    loadBalancerStatus,
    name,
    namespace,
    podSelector,
    policyTypes,
    ports,
    roleBindings,
    roleRef,
    rules,
    secrets,
    sessionAffinity,
    subjects,
    tls,
    totalAddresses,
    totalNotReady,
    totalPorts,
    type,
    annotations,
  } = props;

  return (
    <>
      <ResourceHeader kind={kind || ''} name={name || ''} namespace={namespace} />

      {group && <OverviewItem label="API Group" value={group} />}

      {/* Service fields */}
      <OverviewItem label="Type" value={type} />
      <OverviewItem label="Cluster IP" value={clusterIP} />
      {externalIPs && externalIPs.length > 0 && (
        <OverviewItem
          label="External IPs"
          value={externalIPs.join(', ')}
          fullWidth={externalIPs.length > 2}
        />
      )}
      {ports && ports.length > 0 && (
        <OverviewItem
          label="Ports"
          value={withStableListKeys(
            ports,
            (port) =>
              `${port.name ?? ''}:${port.port ?? ''}:${port.protocol ?? ''}:${port.targetPort ?? ''}`
          ).map(({ key, value: port }) => (
            <div key={key}>
              {port.name && `${port.name}: `}
              {port.port}/{port.protocol}
              {port.targetPort && ` → ${port.targetPort}`}
            </div>
          ))}
          fullWidth
        />
      )}
      <OverviewItem label="Session Affinity" value={sessionAffinity} />

      {/* Ingress fields */}
      <OverviewItem label="Ingress Class" value={ingressClassName} />
      {rules && rules.length > 0 && (
        <OverviewItem label="Rules" value={`${rules.length} rule(s)`} />
      )}
      {tls && tls.length > 0 && <OverviewItem label="TLS" value="Enabled" />}
      {loadBalancerStatus && loadBalancerStatus.length > 0 && (
        <OverviewItem label="Load Balancer" value={loadBalancerStatus.join(', ')} fullWidth />
      )}

      {/* NetworkPolicy fields */}
      {podSelector && Object.keys(podSelector).length > 0 && (
        <OverviewItem
          label="Pod Selector"
          value={Object.entries(podSelector)
            .map(([k, v]) => `${k}=${v}`)
            .join(', ')}
          fullWidth
        />
      )}
      {policyTypes && policyTypes.length > 0 && (
        <OverviewItem label="Policy Types" value={policyTypes.join(', ')} />
      )}
      {ingressRules && ingressRules.length > 0 && (
        <OverviewItem label="Ingress Rules" value={`${ingressRules.length} rule(s)`} />
      )}
      {egressRules && egressRules.length > 0 && (
        <OverviewItem label="Egress Rules" value={`${egressRules.length} rule(s)`} />
      )}

      {/* Endpoints fields */}
      <OverviewItem label="Total Addresses" value={totalAddresses} />
      <OverviewItem label="Not Ready" value={totalNotReady} />
      <OverviewItem label="Total Ports" value={totalPorts} />

      {/* ServiceAccount fields */}
      {secrets && secrets.length > 0 && (
        <OverviewItem label="Secrets" value={`${secrets.length} secret(s)`} />
      )}
      {imagePullSecrets && imagePullSecrets.length > 0 && (
        <OverviewItem label="Image Pull Secrets" value={`${imagePullSecrets.length} secret(s)`} />
      )}
      {automountServiceAccountToken !== undefined && (
        <OverviewItem label="Automount Token" value={automountServiceAccountToken ? 'Yes' : 'No'} />
      )}
      {roleBindings && roleBindings.length > 0 && (
        <OverviewItem label="Role Bindings" value={`${roleBindings.length} binding(s)`} />
      )}
      {clusterRoleBindings && clusterRoleBindings.length > 0 && (
        <OverviewItem
          label="Cluster Role Bindings"
          value={`${clusterRoleBindings.length} binding(s)`}
        />
      )}

      {/* Role/RoleBinding fields */}
      {roleRef && <OverviewItem label="Role Reference" value={`${roleRef.kind}/${roleRef.name}`} />}
      {subjects && subjects.length > 0 && (
        <OverviewItem
          label="Subjects"
          value={withStableListKeys(
            subjects,
            (subject) => `${subject.kind ?? ''}:${subject.namespace ?? ''}:${subject.name ?? ''}`
          ).map(({ key, value: subject }) => (
            <div key={key}>
              {subject.kind}: {subject.namespace ? `${subject.namespace}/` : ''}
              {subject.name}
            </div>
          ))}
          fullWidth
        />
      )}

      {/* Shared metadata section for labels/annotations when present. */}
      <ResourceMetadata labels={labels} annotations={annotations} />
    </>
  );
};
