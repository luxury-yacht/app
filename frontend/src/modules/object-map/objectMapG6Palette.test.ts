/**
 * frontend/src/modules/object-map/objectMapG6Palette.test.ts
 *
 * Tests CSS variable palette reading for the G6 object-map renderer.
 */

import { describe, expect, it } from 'vitest';
import type { ObjectMapG6Palette } from './objectMapG6Data';
import { readObjectMapG6Palette, sameObjectMapG6Palette } from './objectMapG6Palette';

const colorVars = [
  '--color-accent',
  '--color-accent-bg',
  '--color-bg',
  '--color-bg-secondary',
  '--color-border',
  '--color-text',
  '--color-text-secondary',
  '--color-text-tertiary',
  '--color-text-inverse',
  '--status-healthy',
  '--status-refreshing',
  '--status-degraded',
  '--status-unhealthy',
  '--status-inactive',
  '--object-map-edge-owner',
  '--object-map-edge-routes',
  '--object-map-edge-selector',
  '--object-map-edge-endpoint',
  '--object-map-edge-volume-binding',
  '--object-map-edge-storage-class',
  '--object-map-edge-mounts',
  '--object-map-edge-schedules',
  '--object-map-edge-scales',
  '--object-map-edge-grants',
  '--object-map-edge-binds',
  '--object-map-edge-aggregates',
  '--object-map-edge-filtered-path',
  '--object-map-edge-uses',
  '--object-map-edge-default',
];

const numberVars = [
  '--object-map-edge-line-width',
  '--object-map-edge-highlighted-line-width',
  '--object-map-edge-hovered-line-width',
  '--object-map-edge-dimmed-opacity',
  '--object-map-edge-dash-length',
  '--object-map-edge-dash-gap',
  '--object-map-node-connected-line-width',
  '--object-map-node-selected-line-width',
  '--object-map-node-edge-hovered-line-width',
  '--object-map-node-dimmed-background-opacity',
  '--object-map-node-dimmed-foreground-opacity',
  '--object-map-tooltip-max-width',
  '--object-map-tooltip-height',
  '--object-map-tooltip-offset-y',
  '--object-map-tooltip-arrow-width',
  '--object-map-tooltip-arrow-height',
  '--object-map-tooltip-radius',
  '--object-map-tooltip-source-y',
  '--object-map-tooltip-relationship-y',
  '--object-map-tooltip-target-y',
  '--object-map-tooltip-relationship-bottom-padding',
  '--object-map-tooltip-horizontal-padding',
  '--object-map-tooltip-badge-gap',
  '--object-map-tooltip-badge-max-width',
  '--object-map-tooltip-badge-max-font-size',
  '--object-map-tooltip-badge-padding-x',
  '--object-map-tooltip-badge-padding-y',
  '--object-map-tooltip-name-font-size',
  '--object-map-tooltip-name-font-weight',
  '--object-map-tooltip-relationship-font-size',
  '--object-map-tooltip-relationship-font-weight',
  '--object-map-fit-view-padding',
  '--object-map-full-opacity',
];

const applyPaletteVars = (element: HTMLElement) => {
  colorVars.forEach((name, index) => {
    element.style.setProperty(name, `#${String(index + 1).padStart(6, '0')}`);
  });
  numberVars.forEach((name, index) => {
    element.style.setProperty(name, String(index + 1));
  });
  element.style.fontFamily = 'Inter, sans-serif';
};

describe('objectMapG6Palette', () => {
  it('compares every palette field including edge dash values', () => {
    const element = document.createElement('div');
    applyPaletteVars(element);
    document.body.appendChild(element);
    const palette = readObjectMapG6Palette(element);
    const samePalette: ObjectMapG6Palette = { ...palette, edgeDash: [...palette.edgeDash] };
    const differentPalette: ObjectMapG6Palette = {
      ...palette,
      edgeDash: [palette.edgeDash[0], palette.edgeDash[1] + 1],
    };

    expect(sameObjectMapG6Palette(null, palette)).toBe(false);
    expect(sameObjectMapG6Palette(palette, samePalette)).toBe(true);
    expect(sameObjectMapG6Palette(palette, differentPalette)).toBe(false);

    element.remove();
  });
});
