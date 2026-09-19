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
  const trimmed = value?.trim() ?? '';
  if (!trimmed && !allowEmpty) {
    return undefined;
  }
  const resourceStream = isResourceStreamDomain(domain);
  const parsed = parseClusterScopeList(trimmed);
  if (parsed.isMultiCluster) {
    throw new Error(
      resourceStream
        ? `Resource stream domain "${domain}" requires a single cluster scope`
        : 'Refresh domain scopes must target a single cluster'
    );
  }
  // Explicit identity wins when selection changes between lease acquisition and release.
  const clusterId = parsed.clusterIds[0] ?? selectedClusterId;
  const scope = parsed.clusterIds.length > 0 ? parsed.scope : parsed.scope || trimmed;
  const tail = resourceStream && scope.toLowerCase() === 'cluster' ? '' : scope;
  return buildClusterScope(clusterId, tail) || undefined;
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
