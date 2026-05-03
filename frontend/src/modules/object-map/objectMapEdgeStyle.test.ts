import { describe, expect, it } from 'vitest';
import { objectMapEdgeClass } from './objectMapEdgeStyle';

describe('objectMapEdgeClass', () => {
  it.each([
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
  ])('maps %s to its variant class', (type, variant) => {
    expect(objectMapEdgeClass(type)).toBe(`object-map-edge ${variant}`);
  });

  it('falls back to the default variant for unknown types', () => {
    expect(objectMapEdgeClass('mystery')).toBe('object-map-edge object-map-edge--default');
  });

  it('normalizes whitespace and case', () => {
    expect(objectMapEdgeClass('  Owner  ')).toBe('object-map-edge object-map-edge--owner');
  });
});
