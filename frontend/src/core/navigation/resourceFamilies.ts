export const RESOURCE_FAMILY_LABELS = {
  karpenter: 'Karpenter',
  argocd: 'Argo CD',
  'cert-manager': 'cert-manager',
  'external-secrets': 'External Secrets',
  prometheus: 'Prometheus Operator',
} as const;

export type ResourceFamily = keyof typeof RESOURCE_FAMILY_LABELS;
export type NamespaceResourceFamily = Exclude<ResourceFamily, 'karpenter'>;
export type ClusterResourceFamily = Exclude<ResourceFamily, 'argocd' | 'prometheus'>;

const API_FAMILIES: Record<
  string,
  {
    family: ResourceFamily;
    namespaced: readonly string[];
    cluster: readonly string[];
  }
> = {
  'argoproj.io': {
    family: 'argocd',
    namespaced: ['application', 'applicationset', 'appproject'],
    cluster: [],
  },
  'cert-manager.io': {
    family: 'cert-manager',
    namespaced: ['certificate', 'certificaterequest', 'issuer'],
    cluster: ['clusterissuer'],
  },
  'acme.cert-manager.io': {
    family: 'cert-manager',
    namespaced: ['order', 'challenge'],
    cluster: [],
  },
  'external-secrets.io': {
    family: 'external-secrets',
    namespaced: ['externalsecret', 'secretstore'],
    cluster: ['clusterexternalsecret', 'clustersecretstore'],
  },
  'monitoring.coreos.com': {
    family: 'prometheus',
    namespaced: ['servicemonitor', 'podmonitor', 'prometheusrule', 'prometheus', 'alertmanager'],
    cluster: [],
  },
};

export function resourceFamilyForObject(
  group: string,
  kind: string,
  namespaced: boolean
): ResourceFamily | undefined {
  if (!namespaced && group.startsWith('karpenter.')) {
    return 'karpenter';
  }
  const definition = API_FAMILIES[group];
  const kinds = namespaced ? definition?.namespaced : definition?.cluster;
  return kinds?.includes(kind.toLowerCase()) ? definition.family : undefined;
}
