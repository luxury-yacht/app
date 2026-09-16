import { RESOURCE_FAMILY_RULES } from '@core/refresh/types.generated';

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

const rules: readonly {
  group?: string;
  groupPrefix?: string;
  family: ResourceFamily;
  kinds?: Readonly<Record<string, boolean>>;
}[] = RESOURCE_FAMILY_RULES;

export function resourceFamilyForObject(
  group: string,
  kind: string,
  namespaced: boolean
): ResourceFamily | undefined {
  return rules.find((rule) =>
    rule.groupPrefix
      ? !namespaced && group.startsWith(rule.groupPrefix)
      : rule.group === group && rule.kinds?.[kind.toLowerCase()] === namespaced
  )?.family;
}
