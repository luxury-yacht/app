/**
 * frontend/src/modules/object-map/objectMapG6RendererOptions.test.ts
 *
 * Tests pure G6 renderer option and layout lookup helpers.
 */

import { describe, expect, it } from 'vitest';
import {
  findObjectMapG6Edge,
  findObjectMapG6Node,
  objectMapG6EndpointKind,
  objectMapG6EndpointLabel,
} from './objectMapG6RendererOptions';
import type { ObjectMapLayout } from './objectMapLayout';

const layout: ObjectMapLayout = {
  nodes: [
    {
      id: 'deploy',
      x: 0,
      y: 0,
      width: 120,
      height: 58,
      column: 0,
      isSeed: true,
      ref: {
        clusterId: 'cluster-a',
        group: 'apps',
        version: 'v1',
        kind: 'Deployment',
        namespace: 'default',
        name: 'web',
      },
    },
  ],
  edges: [
    {
      id: 'edge',
      sourceId: 'deploy',
      targetId: 'pod',
      type: 'owner',
      label: 'owns',
      d: 'M0 0 L1 1',
      midX: 0,
      midY: 0,
      sameColumn: false,
    },
  ],
  bounds: { minX: 0, minY: 0, maxX: 120, maxY: 58 },
};

describe('objectMapG6RendererOptions', () => {
  it('finds layout endpoints and formats fallback endpoint labels', () => {
    const node = findObjectMapG6Node(layout, 'deploy');

    expect(node?.ref.name).toBe('web');
    expect(findObjectMapG6Node(layout, 'missing')).toBeNull();
    expect(findObjectMapG6Edge(layout, 'edge')?.label).toBe('owns');
    expect(findObjectMapG6Edge(layout, 'missing')).toBeNull();
    expect(objectMapG6EndpointLabel(node)).toBe('web');
    expect(objectMapG6EndpointKind(node)).toBe('Deployment');
    expect(objectMapG6EndpointLabel(null)).toBe('Unknown');
    expect(objectMapG6EndpointKind(null)).toBe('Object');
  });
});
