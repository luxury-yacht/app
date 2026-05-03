import type {
  ObjectMapEdge,
  ObjectMapNode,
  ObjectMapReference,
  ObjectMapSnapshotPayload,
} from '@core/refresh/types';

export interface ObjectMapPerformanceFixtureOptions {
  nodeCount: number;
  edgeCount: number;
}

const KINDS: Array<{ kind: string; group: string; version: string; namespace?: string }> = [
  { kind: 'Deployment', group: 'apps', version: 'v1', namespace: 'perf' },
  { kind: 'Pod', group: '', version: 'v1', namespace: 'perf' },
  { kind: 'Service', group: '', version: 'v1', namespace: 'perf' },
  { kind: 'ConfigMap', group: '', version: 'v1', namespace: 'perf' },
  { kind: 'Secret', group: '', version: 'v1', namespace: 'perf' },
  { kind: 'PersistentVolumeClaim', group: '', version: 'v1', namespace: 'perf' },
  { kind: 'PersistentVolume', group: '', version: 'v1' },
  { kind: 'Ingress', group: 'networking.k8s.io', version: 'v1', namespace: 'perf' },
  { kind: 'ServiceAccount', group: '', version: 'v1', namespace: 'perf' },
  { kind: 'Node', group: '', version: 'v1' },
];

const EDGE_TYPES = [
  'owner',
  'routes',
  'uses',
  'mounts',
  'volume-binding',
  'storage-class',
  'scales',
  'schedules',
];

const refFor = (index: number): ObjectMapReference => {
  const meta = KINDS[index % KINDS.length];
  return {
    clusterId: 'perf-cluster',
    group: meta.group,
    version: meta.version,
    kind: meta.kind,
    namespace: meta.namespace,
    name: `${meta.kind.toLowerCase()}-${index}`,
    uid: `perf-${meta.kind.toLowerCase()}-${index}`,
  };
};

export const createObjectMapPerformanceFixture = ({
  nodeCount,
  edgeCount,
}: ObjectMapPerformanceFixtureOptions): ObjectMapSnapshotPayload => {
  if (nodeCount < 2) {
    throw new Error('object map performance fixtures need at least 2 nodes');
  }
  if (edgeCount < nodeCount - 1) {
    throw new Error('edgeCount must be at least nodeCount - 1 so every node is reachable');
  }

  const nodes: ObjectMapNode[] = Array.from({ length: nodeCount }, (_, index) => ({
    id: `node-${index}`,
    depth: index === 0 ? 0 : 1 + (index % 6),
    ref: refFor(index),
  }));

  const edges: ObjectMapEdge[] = [];
  const addEdge = (sourceIndex: number, targetIndex: number, edgeIndex: number) => {
    const type = EDGE_TYPES[edgeIndex % EDGE_TYPES.length];
    edges.push({
      id: `edge-${edgeIndex}`,
      source: `node-${sourceIndex}`,
      target: `node-${targetIndex}`,
      type,
      label: `${type} relationship`,
      tracedBy: edgeIndex % 5 === 0 ? `fixture trace ${edgeIndex}` : undefined,
    });
  };

  for (let targetIndex = 1; targetIndex < nodeCount; targetIndex += 1) {
    addEdge(targetIndex - 1, targetIndex, edges.length);
  }

  let stride = 2;
  while (edges.length < edgeCount) {
    for (let sourceIndex = 0; sourceIndex + stride < nodeCount; sourceIndex += 1) {
      addEdge(sourceIndex, sourceIndex + stride, edges.length);
      if (edges.length >= edgeCount) break;
    }
    stride += 1;
  }

  return {
    clusterId: 'perf-cluster',
    clusterName: 'Performance Fixture',
    seed: nodes[0].ref,
    nodes,
    edges,
    maxDepth: 8,
    maxNodes: nodeCount,
    truncated: false,
  };
};
