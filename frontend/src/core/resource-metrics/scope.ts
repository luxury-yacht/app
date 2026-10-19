import { resolveBuiltinGroupVersion } from '@shared/constants/builtinGroupVersions';
import {
  assertObjectRefHasRequiredIdentity,
  buildRequiredObjectReference,
  type ClusterObjectReference,
} from '@shared/utils/objectIdentity';
import { buildClusterRefreshScope, buildRefreshScope } from '@/core/refresh/scopeSelector';
import type { KubernetesObjectReference } from '@/types/view-state';
import type { ResourceMetricsResolution } from './types';

const resolveMetricsReference = (ref: ClusterObjectReference): ResourceMetricsResolution => {
  const builtin = resolveBuiltinGroupVersion(ref.kind);
  if (ref.group !== builtin.group || ref.version !== builtin.version) {
    return { kind: 'unsupported', reason: 'unsupported-kind' };
  }
  const kind = ref.kind.toLowerCase();
  if (kind === 'node') {
    return {
      kind: 'domain',
      ref,
      source: 'nodes',
      domain: 'nodes',
      scope: buildClusterRefreshScope('nodes', ref.clusterId),
    };
  }
  if (!['pod', 'deployment', 'daemonset', 'statefulset'].includes(kind)) {
    return { kind: 'unsupported', reason: 'unsupported-kind' };
  }
  if (!ref.namespace) {
    return {
      kind: 'invalid',
      error: `Object identity for ${ref.kind}/${ref.name} is missing namespace`,
    };
  }
  const domain = kind === 'pod' ? 'pods' : 'namespace-workloads';
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
