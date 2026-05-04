/**
 * frontend/src/modules/object-map/objectMapKindFilter.test.ts
 *
 * Tests kind filtering and transitive filtered-path reconstruction.
 */

import { describe, expect, it } from 'vitest';
import type { ObjectMapNode, ObjectMapReference } from '@core/refresh/types';
import { contractObjectMapKindFilter, FILTERED_PATH_EDGE_TYPE } from './objectMapKindFilter';

const ref = (kind: string, name: string): ObjectMapReference => ({
  clusterId: 'cluster-a',
  group: kind === 'EndpointSlice' ? 'discovery.k8s.io' : '',
  version: 'v1',
  kind,
  namespace: 'default',
  name,
  uid: `${kind.toLowerCase()}-${name}`,
});

const node = (id: string, kind: string, name = id): ObjectMapNode => ({
  id,
  depth: 0,
  ref: ref(kind, name),
});

describe('contractObjectMapKindFilter', () => {
  it('contracts directed paths through nodes hidden by the Kinds filter', () => {
    const result = contractObjectMapKindFilter(
      [
        node('service', 'Service', 'web'),
        node('endpoint-slice', 'EndpointSlice', 'web-abcd'),
        node('pod', 'Pod', 'web-123'),
      ],
      [
        {
          id: 'service-endpoints',
          source: 'service',
          target: 'endpoint-slice',
          type: 'endpoint',
          label: 'has endpoints',
        },
        {
          id: 'endpoints-pod',
          source: 'endpoint-slice',
          target: 'pod',
          type: 'routes',
          label: 'routes to',
        },
      ],
      new Set(['Service', 'Pod'])
    );

    expect(result.nodes.map((entry) => entry.id)).toEqual(['service', 'pod']);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toEqual(
      expect.objectContaining({
        source: 'service',
        target: 'pod',
        type: FILTERED_PATH_EDGE_TYPE,
        label: 'filtered path',
      })
    );
    expect(result.edges[0].filteredPath?.nodes.map((entry) => [entry.id, entry.filtered])).toEqual([
      ['service', false],
      ['endpoint-slice', true],
      ['pod', false],
    ]);
    expect(result.edges[0].filteredPath?.relationships.map((entry) => entry.label)).toEqual([
      'has endpoints',
      'routes to',
    ]);
  });

  it('merges multiple hidden paths and keeps the shortest tooltip path', () => {
    const result = contractObjectMapKindFilter(
      [
        node('service', 'Service', 'web'),
        node('endpoint-slice-a', 'EndpointSlice', 'web-a'),
        node('endpoint-slice-b', 'EndpointSlice', 'web-b'),
        node('config', 'ConfigMap', 'web-config'),
        node('pod', 'Pod', 'web-123'),
      ],
      [
        {
          id: 'service-a',
          source: 'service',
          target: 'endpoint-slice-a',
          type: 'endpoint',
          label: 'has endpoints',
        },
        {
          id: 'a-pod',
          source: 'endpoint-slice-a',
          target: 'pod',
          type: 'routes',
          label: 'routes to',
        },
        {
          id: 'service-b',
          source: 'service',
          target: 'endpoint-slice-b',
          type: 'endpoint',
          label: 'has endpoints',
        },
        {
          id: 'b-config',
          source: 'endpoint-slice-b',
          target: 'config',
          type: 'uses',
          label: 'uses',
        },
        {
          id: 'config-pod',
          source: 'config',
          target: 'pod',
          type: 'routes',
          label: 'routes to',
        },
      ],
      new Set(['Service', 'Pod'])
    );

    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].filteredPath?.additionalPathCount).toBe(1);
    expect(result.edges[0].filteredPath?.nodes.map((entry) => entry.id)).toEqual([
      'service',
      'endpoint-slice-a',
      'pod',
    ]);
  });
});
