import BrowseView from '@modules/browse/components/BrowseView';
import NsViewAutoscaling from '@modules/namespace/components/NsViewAutoscaling';
import NsViewConfig from '@modules/namespace/components/NsViewConfig';
import NsViewCustom, {
  NsViewArgoCD,
  NsViewCertManager,
  NsViewExternalSecrets,
  NsViewPrometheus,
} from '@modules/namespace/components/NsViewCustom';
import NsViewEvents from '@modules/namespace/components/NsViewEvents';
import NsViewHelm from '@modules/namespace/components/NsViewHelm';
import NsViewMap from '@modules/namespace/components/NsViewMap';
import NsViewNetwork from '@modules/namespace/components/NsViewNetwork';
import NsViewQuotas from '@modules/namespace/components/NsViewQuotas';
import NsViewRBAC from '@modules/namespace/components/NsViewRBAC';
import NsViewStorage from '@modules/namespace/components/NsViewStorage';
import NsViewWorkloads from '@modules/namespace/components/NsViewWorkloads';
import type React from 'react';
import type { NamespaceViewType } from '@/types/navigation/views';

// One entry per namespace tab: the error-boundary display name and the view
// component (every view takes the namespace as its only prop).
export const NAMESPACE_RESOURCE_VIEWS: Partial<
  Record<
    NamespaceViewType,
    {
      name: string;
      Component: React.ComponentType<{ namespace: string; showNamespaceColumn?: boolean }>;
    }
  >
> = {
  browse: { name: 'Browse', Component: BrowseView },
  map: { name: 'Map', Component: NsViewMap },
  workloads: { name: 'Workloads', Component: NsViewWorkloads },
  config: { name: 'Config', Component: NsViewConfig },
  network: { name: 'Network', Component: NsViewNetwork },
  rbac: { name: 'RBAC', Component: NsViewRBAC },
  storage: { name: 'Storage', Component: NsViewStorage },
  autoscaling: { name: 'Autoscaling', Component: NsViewAutoscaling },
  quotas: { name: 'Quotas', Component: NsViewQuotas },
  custom: { name: 'Custom Resources', Component: NsViewCustom },
  argocd: { name: 'Argo CD', Component: NsViewArgoCD },
  'cert-manager': { name: 'cert-manager', Component: NsViewCertManager },
  'external-secrets': { name: 'External Secrets', Component: NsViewExternalSecrets },
  prometheus: { name: 'Prometheus Operator', Component: NsViewPrometheus },
  helm: { name: 'Helm', Component: NsViewHelm },
  events: { name: 'Events', Component: NsViewEvents },
};
