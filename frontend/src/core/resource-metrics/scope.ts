import { lookupKindFacets } from '@shared/kinds/kindFacets';
import {
  assertObjectRefHasRequiredIdentity,
  buildRequiredObjectReference,
  type ClusterObjectReference,
} from '@shared/utils/objectIdentity';
import { buildClusterRefreshScope, buildRefreshScope } from '@/core/refresh/scopeSelector';
import type { KubernetesObjectReference } from '@/types/view-state';
import type { ResourceMetricsResolution } from './types';

// The kind's metrics facet names the domain whose rows carry its usage, matched by
// complete identity: a custom resource sharing a built-in kind name, or a version
// the backend does not serve, has none.
const resolveMetricsReference = (ref: ClusterObjectReference): ResourceMetricsResolution => {
  const domain = lookupKindFacets(ref)?.metricsDomain ?? 'none';
  if (domain === 'none') {
    return { kind: 'unsupported', reason: 'unsupported-kind' };
  }
  if (domain === 'nodes') {
    return {
      kind: 'domain',
      ref,
      source: domain,
      domain,
      scope: buildClusterRefreshScope(domain, ref.clusterId),
    };
  }
  if (!ref.namespace) {
    return {
      kind: 'invalid',
      error: `Object identity for ${ref.kind}/${ref.name} is missing namespace`,
    };
  }
  return {
    kind: 'domain',
    ref,
    source: domain,
    domain,
    scope: buildRefreshScope(domain, {
      clusterId: ref.clusterId,
      selector: { kind: 'namespace', namespace: ref.namespace },
    }),
  };
};

export const resolveResourceMetricsScope = (
  objectData: KubernetesObjectReference | null | undefined
): ResourceMetricsResolution => {
  if (!objectData) {
    return { kind: 'unsupported', reason: 'unsupported-kind' };
  }
  try {
    assertObjectRefHasRequiredIdentity(objectData);
    return resolveMetricsReference(buildRequiredObjectReference(objectData));
  } catch (error) {
    return { kind: 'invalid', error: error instanceof Error ? error.message : String(error) };
  }
};
