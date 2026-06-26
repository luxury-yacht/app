import { buildClusterScope } from '@/core/refresh/clusterScope';
import type { KubernetesObjectReference } from '@/types/view-state';
import {
  buildRequiredObjectReference,
  type ResolvedObjectReference,
} from '@shared/utils/objectIdentity';
import { resourceMetricsSourceFromKind } from './valueAdapters';
import type { ResourceMetricsResolution } from './types';

const workloadMetricKinds = new Set(['deployment', 'daemonset', 'statefulset']);

const namespaceScope = (clusterId: string | undefined, namespace: string | undefined): string =>
  buildClusterScope(clusterId, `namespace:${namespace ?? ''}`);

export const buildResourceMetricsReference = (
  objectData: KubernetesObjectReference | null | undefined
): ResolvedObjectReference | null => {
  if (!objectData) {
    return null;
  }
  return buildRequiredObjectReference(objectData);
};

export const resolveResourceMetricsScope = (
  objectData: KubernetesObjectReference | null | undefined
): ResourceMetricsResolution => {
  let ref: ResolvedObjectReference | null = null;
  try {
    ref = buildResourceMetricsReference(objectData);
  } catch (error) {
    return {
      kind: 'invalid',
      error: error instanceof Error ? error.message : String(error),
    };
  }

  if (!ref) {
    return { kind: 'unsupported', reason: 'unsupported-kind' };
  }

  const source = resourceMetricsSourceFromKind(ref.kind);
  const kind = ref.kind.toLowerCase();
  if (!source) {
    return { kind: 'unsupported', reason: 'unsupported-kind' };
  }

  if (source === 'detail-replicaset') {
    return {
      kind: 'detail-exception',
      source: 'detail-replicaset',
      reason: 'replicaset-owner-collapse',
    };
  }

  if (kind === 'pod') {
    if (!ref.namespace) {
      return { kind: 'invalid', error: `Object identity for Pod/${ref.name} is missing namespace` };
    }
    return {
      kind: 'domain',
      source: 'pods',
      domain: 'pods',
      scope: namespaceScope(ref.clusterId, ref.namespace),
    };
  }

  if (workloadMetricKinds.has(kind)) {
    if (!ref.namespace) {
      return {
        kind: 'invalid',
        error: `Object identity for ${ref.kind}/${ref.name} is missing namespace`,
      };
    }
    return {
      kind: 'domain',
      source: 'namespace-workloads',
      domain: 'namespace-workloads',
      scope: namespaceScope(ref.clusterId, ref.namespace),
      freshnessDomain: 'nodes',
      freshnessScope: buildClusterScope(ref.clusterId, ''),
    };
  }

  if (kind === 'node') {
    return {
      kind: 'domain',
      source: 'nodes',
      domain: 'nodes',
      scope: buildClusterScope(ref.clusterId, ''),
    };
  }

  return { kind: 'unsupported', reason: 'unsupported-kind' };
};
