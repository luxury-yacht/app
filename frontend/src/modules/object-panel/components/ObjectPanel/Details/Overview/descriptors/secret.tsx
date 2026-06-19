/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/descriptors/secret.tsx
 *
 * Secret Overview descriptor (X1 P3a). Presentation ported verbatim from SecretOverview.tsx.
 */

import { secret } from '@wailsjs/go/models';
import { StatusChip } from '@shared/components/StatusChip';
import type { OverviewDescriptor } from '../schema';
import { renderUsedByLinks } from './shared';

type SecretDetails = secret.SecretDetails;

// Tooltips for the well-known Secret types defined by Kubernetes. User-defined types get no
// tooltip so we don't invent semantics for them.
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

export const secretDescriptor: OverviewDescriptor<SecretDetails> = {
  displayKind: 'Secret',
  dtoClass: secret.SecretDetails,
  masksValues: true,
  schema: {
    items: [
      {
        field: 'secretType',
        label: 'Type',
        hidden: (d) => !d.secretType,
        render: (d) => (
          <StatusChip variant="info" tooltip={secretTypeTooltip(d.secretType)}>
            {d.secretType}
          </StatusChip>
        ),
      },
      {
        field: 'usedBy',
        label: 'Used By',
        render: (d) => renderUsedByLinks(d.usedBy),
      },
    ],
  },
  // data → DataSection (masked); dataKeys/dataCount/details not surfaced in the Overview.
  coveredElsewhere: ['data', 'dataKeys', 'dataCount', 'details'],
};
