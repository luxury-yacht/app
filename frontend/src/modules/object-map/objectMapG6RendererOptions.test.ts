/**
 * frontend/src/modules/object-map/objectMapG6RendererOptions.test.ts
 *
 * Tests pure G6 renderer option and layout lookup helpers.
 */

import { describe, expect, it } from 'vitest';
import type { ObjectMapG6Palette } from './objectMapG6Data';
import {
  findObjectMapG6Edge,
  findObjectMapG6Node,
  objectMapG6EdgeOptions,
  objectMapG6EndpointKind,
  objectMapG6EndpointLabel,
  objectMapG6NodeOptions,
} from './objectMapG6RendererOptions';
import type { ObjectMapLayout } from './objectMapLayout';

const palette = {
  accent: '#2563eb',
  edgeHoveredLineWidth: 4,
  edgeHighlightedLineWidth: 3,
  edgeDimmedOpacity: 0.2,
  fullOpacity: 1,
  nodeConnectedLineWidth: 1,
  nodeDimmedBackgroundOpacity: 0.25,
  nodeDimmedForegroundOpacity: 0.45,
  nodeEdgeHoveredLineWidth: 3,
  nodeSelectedLineWidth: 1,
} as ObjectMapG6Palette;

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

  it('builds node and edge states from palette values', () => {
    expect(objectMapG6NodeOptions(palette).state.selected).toEqual({
      stroke: '#2563eb',
      lineWidth: 1,
      opacity: 1,
    });
    expect(objectMapG6NodeOptions(palette).state.dimmed).toEqual({
      cardBackgroundOpacity: 0.25,
      cardForegroundOpacity: 0.45,
    });
    expect(objectMapG6EdgeOptions(palette).state.dimmed).toEqual({ opacity: 0.2 });
  });
});
