/**
 * frontend/src/modules/object-map/objectMapEdgeStyle.test.ts
 *
 * Tests object-map edge style metadata and CSS class resolution.
 */

import { describe, expect, it } from 'vitest';
import { objectMapEdgeClass } from './objectMapEdgeStyle';

describe('objectMapEdgeClass', () => {
  it('covers objectMapEdgeClass scenarios', async () => {
    for (const [type, variant] of [
      ['owner', 'object-map-edge--owner'],
      ['selector', 'object-map-edge--selector'],
      ['endpoint', 'object-map-edge--endpoint'],
      ['schedules', 'object-map-edge--schedules'],
      ['uses', 'object-map-edge--uses'],
      ['mounts', 'object-map-edge--mounts'],
      ['volume-binding', 'object-map-edge--volume-binding'],
      ['storage-class', 'object-map-edge--storage-class'],
      ['routes', 'object-map-edge--routes'],
      ['scales', 'object-map-edge--scales'],
      ['grants', 'object-map-edge--grants'],
      ['binds', 'object-map-edge--binds'],
      ['aggregates', 'object-map-edge--aggregates'],
      ['filtered-path', 'object-map-edge--filtered-path'],
    ]) {
      // Scenarios: maps %s to its variant class
      expect(objectMapEdgeClass(type)).toBe(`object-map-edge ${variant}`);
    }
    // Scenario: falls back to the default variant for unknown types
    expect(objectMapEdgeClass('mystery')).toBe('object-map-edge object-map-edge--default');
    // Scenario: normalizes whitespace and case
    expect(objectMapEdgeClass('  Owner  ')).toBe('object-map-edge object-map-edge--owner');
  });
});
