import type { ObjectMapSnapshotPayload } from '@core/refresh/types';
import { describe, expect, it } from 'vitest';
import { normalizeObjectMapPayload } from './objectMapPayload';

describe('normalizeObjectMapPayload', () => {
  it('normalizes nullable node and edge collections', () => {
    const payload = {
      clusterId: 'cluster-a',
      clusterName: 'Cluster A',
      seed: {
        clusterId: 'cluster-a',
        group: 'apps',
        version: 'v1',
        kind: 'Deployment',
        name: 'api',
      },
      nodes: null,
      edges: null,
      maxDepth: 3,
      maxNodes: 100,
      truncated: false,
    } satisfies ObjectMapSnapshotPayload;

    const normalized = normalizeObjectMapPayload(payload);

    expect(normalized.nodes).toEqual([]);
    expect(normalized.edges).toEqual([]);
  });
});
