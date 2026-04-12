import { describe, expect, it } from 'vitest';

import { buildStablePodColorMap, hashPodColorIndex } from './podColors';

describe('podColors', () => {
  const palette = Array.from({ length: 20 }, (_, index) => `color-${index + 1}`);

  it('keeps a pod on the same color when the visible pod set changes', () => {
    const first = buildStablePodColorMap(['api-7', 'api-1'], palette, 'fallback');
    const second = buildStablePodColorMap(
      ['api-7', 'api-1', 'api-99', 'worker-2'],
      palette,
      'fallback'
    );

    expect(first['api-7']).toBe(second['api-7']);
    expect(first['api-1']).toBe(second['api-1']);
  });

  it('wraps onto the existing 20-color palette deterministically', () => {
    const podNames = Array.from({ length: 20 }, (_, index) => `pod-${index + 1}`);
    const colorMap = buildStablePodColorMap(podNames, palette, 'fallback');

    for (const podName of podNames) {
      expect(palette).toContain(colorMap[podName]);
    }

    const distinctColors = new Set(podNames.map((podName) => colorMap[podName]));
    expect(distinctColors.size).toBeLessThanOrEqual(palette.length);
  });

  it('returns a stable hash index for the same pod name', () => {
    expect(hashPodColorIndex('api-7', palette.length)).toBe(
      hashPodColorIndex('api-7', palette.length)
    );
  });
});
