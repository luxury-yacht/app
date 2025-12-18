import React from 'react';
import { OverviewItem } from './shared/OverviewItem';
import { ResourceHeader } from '@shared/components/kubernetes/ResourceHeader';

interface GenericOverviewProps {
  age?: string;
  apiGroup?: string;
  automountServiceAccountToken?: boolean;
  clusterIP?: string;
  clusterRoleBindings?: any[];
  egressRules?: any[];
  externalIPs?: string[];
  imagePullSecrets?: any[];
  ingressClassName?: string;
  ingressRules?: any[];
  kind?: string;
  loadBalancerStatus?: string[];
  name?: string;
  namespace?: string;
  podSelector?: Record<string, string>;
  policyTypes?: string[];
  ports?: any[];
  roleBindings?: any[];
  roleRef?: any;
  rules?: any[];
  secrets?: any[];
  sessionAffinity?: string;
  subjects?: any[];
  tls?: any[];
  totalAddresses?: number;
  totalNotReady?: number;
  totalPorts?: number;
  type?: string;
}

// Generic overview for resources that don't have a specific component yet
export const GenericOverview: React.FC<GenericOverviewProps> = (props) => {
  const {
    age,
    apiGroup,
    automountServiceAccountToken,
    clusterIP,
    clusterRoleBindings,
    egressRules,
    externalIPs,
    imagePullSecrets,
    ingressClassName,
    ingressRules,
    kind,
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
  } = props;

  return (
    <>
      <ResourceHeader kind={kind || ''} name={name || ''} namespace={namespace} age={age} />

      {apiGroup && <OverviewItem label="API Group" value={apiGroup} />}

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
          value={ports.map((port: any, index: number) => (
            <div key={index}>
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
          value={subjects.map((subject: any, index: number) => (
            <div key={index}>
              {subject.kind}: {subject.namespace ? `${subject.namespace}/` : ''}
              {subject.name}
            </div>
          ))}
          fullWidth
        />
      )}
    </>
  );
};
