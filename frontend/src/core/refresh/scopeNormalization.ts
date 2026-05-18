import { buildClusterScope, parseClusterScopeList } from './clusterScope';
import { isResourceStreamDomain } from './resourceStreamViews';
import type { RefreshDomain } from './types';

type NormalizeRefreshDomainScopeOptions = {
  domain: RefreshDomain;
  value?: string | null;
  selectedClusterId?: string;
  allowEmpty?: boolean;
};

export const normalizeRefreshDomainScope = ({
  domain,
  value,
  selectedClusterId,
  allowEmpty = false,
}: NormalizeRefreshDomainScopeOptions): string | undefined => {
  if (isResourceStreamDomain(domain)) {
    return normalizeResourceStreamScope(domain, value, selectedClusterId, allowEmpty);
  }
  return normalizeDefaultScope(value, selectedClusterId, allowEmpty);
};

export const normalizeNamespaceScope = (
  value: string | null | undefined,
  clusterId: string | undefined
): string | null => {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const namespaceScope = trimmed.startsWith('namespace:') ? trimmed : `namespace:${trimmed}`;
  return buildClusterScope(clusterId, namespaceScope) || null;
};

const normalizeDefaultScope = (
  value: string | null | undefined,
  selectedClusterId: string | undefined,
  allowEmpty: boolean
): string | undefined => {
  if (!value) {
    if (!allowEmpty) {
      return undefined;
    }
    const clusterScope = buildClusterScope(selectedClusterId, '');
    return clusterScope || undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    if (!allowEmpty) {
      return undefined;
    }
    const clusterScope = buildClusterScope(selectedClusterId, '');
    return clusterScope || undefined;
  }
  const parsed = parseClusterScopeList(trimmed);
  if (parsed.isMultiCluster) {
    throw new Error('Refresh domain scopes must target a single cluster');
  }
  // Preserve explicit cluster-scoped inputs to avoid rewriting historical keys
  // when the selected cluster changes between enable/disable calls.
  if (parsed.clusterIds.length > 0) {
    return buildClusterScope(parsed.clusterIds[0], parsed.scope);
  }
  return buildClusterScope(selectedClusterId, parsed.scope || trimmed) || undefined;
};

const normalizeResourceStreamScope = (
  domain: RefreshDomain,
  value: string | null | undefined,
  selectedClusterId: string | undefined,
  allowEmpty: boolean
): string | undefined => {
  if (!value || !value.trim()) {
    if (!allowEmpty) {
      return undefined;
    }
    return buildClusterScope(selectedClusterId, '') || undefined;
  }

  const trimmed = value.trim();
  const parsed = parseClusterScopeList(trimmed);
  if (parsed.isMultiCluster) {
    throw new Error(`Resource stream domain "${domain}" requires a single cluster scope`);
  }
  if (parsed.clusterIds.length > 0) {
    return buildClusterScope(parsed.clusterIds[0], parsed.scope);
  }

  return buildClusterScope(selectedClusterId, parsed.scope || trimmed) || undefined;
};
