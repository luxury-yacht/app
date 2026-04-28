/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/SecretOverview.tsx
 */

import React from 'react';
import { types } from '@wailsjs/go/models';
import { OverviewItem } from '@modules/object-panel/components/ObjectPanel/Details/Overview/shared/OverviewItem';
import { ResourceHeader } from '@shared/components/kubernetes/ResourceHeader';
import { ResourceMetadata } from '@shared/components/kubernetes/ResourceMetadata';
import { StatusChip } from '@shared/components/StatusChip';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { ObjectPanelLink } from '@shared/components/ObjectPanelLink';
import { buildObjectReference } from '@shared/utils/objectIdentity';

interface SecretOverviewProps {
  secretDetails: types.SecretDetails | null;
}

// Tooltips for the well-known Secret types defined by Kubernetes.
// User-defined types (anything not matched here) get no tooltip so we don't
// make up semantics for them.
const secretTypeTooltip = (type: string): string | undefined => {
  switch (type) {
    case 'kubernetes.io/tls':
      return 'TLS certificate and key. Typically referenced by Ingress objects.';
    case 'kubernetes.io/service-account-token':
      return 'Authentication token automatically mounted into ServiceAccount-bound pods.';
    case 'kubernetes.io/dockerconfigjson':
    case 'kubernetes.io/dockercfg':
      return 'Container registry pull credentials. Referenced via imagePullSecrets.';
    case 'kubernetes.io/basic-auth':
      return 'Username and password credentials.';
    case 'kubernetes.io/ssh-auth':
      return 'SSH private key.';
    case 'bootstrap.kubernetes.io/token':
      return 'kubeadm cluster join token.';
    case 'Opaque':
      return 'User-defined data. No built-in semantics.';
    default:
      return undefined;
  }
};

export const SecretOverview: React.FC<SecretOverviewProps> = ({ secretDetails }) => {
  const { objectData } = useObjectPanel();
  const clusterMeta = {
    clusterId: objectData?.clusterId ?? undefined,
    clusterName: objectData?.clusterName ?? undefined,
  };

  if (!secretDetails) return null;

  return (
    <>
      {/* Use composed component for header */}
      <ResourceHeader
        kind="Secret"
        name={secretDetails.name}
        namespace={secretDetails.namespace}
        age={secretDetails.age}
      />

      {/* Secret Type — chip with a per-type tooltip for the well-known
          kubernetes.io/* prefixes. */}
      {secretDetails.secretType && (
        <OverviewItem
          label="Type"
          value={
            <StatusChip variant="info" tooltip={secretTypeTooltip(secretDetails.secretType)}>
              {secretDetails.secretType}
            </StatusChip>
          }
        />
      )}

      {/* Usage information — always rendered. The backend leaves UsedBy
          nil when no pods reference this Secret (rather than emitting an
          empty array), so undefined here means "not in use" rather than
          "unknown". */}
      <OverviewItem
        label="Used By"
        value={
          !secretDetails.usedBy || secretDetails.usedBy.length === 0 ? (
            <StatusChip variant="info">Not in use</StatusChip>
          ) : (
            <div>
              {secretDetails.usedBy.map((podName: string, index: number) => (
                <div key={`${podName}-${index}`} style={{ marginTop: index > 0 ? '4px' : 0 }}>
                  <ObjectPanelLink
                    objectRef={buildObjectReference({
                      kind: 'pod',
                      name: podName,
                      namespace: secretDetails.namespace,
                      ...clusterMeta,
                    })}
                    title={`Click to view pod: ${podName}`}
                  >
                    {podName}
                  </ObjectPanelLink>
                </div>
              ))}
            </div>
          )
        }
      />

      {/* Use composed component for metadata */}
      <ResourceMetadata labels={secretDetails.labels} annotations={secretDetails.annotations} />
    </>
  );
};
