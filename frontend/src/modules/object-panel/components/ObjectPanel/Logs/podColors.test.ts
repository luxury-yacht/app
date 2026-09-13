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

  it('assigns distinct colors when pod names hash to the same preferred slot', () => {
    const firstPod = 'argocd-repo-server-7898d489bb-q26sj';
    const secondPod = 'argocd-repo-server-7898d489bb-nsqrr';
    const productionPalette = Array.from({ length: 24 }, (_, index) => `color-${index + 1}`);

    expect(hashPodColorIndex(firstPod, productionPalette.length)).toBe(
      hashPodColorIndex(secondPod, productionPalette.length)
    );

    const colorMap = buildStablePodColorMap([firstPod, secondPod], productionPalette, 'fallback');

    expect(colorMap[firstPod]).not.toBe(colorMap[secondPod]);
  });

  it('keeps collision-resolved colors stable when pod input order changes', () => {
    const firstPod = 'argocd-repo-server-7898d489bb-q26sj';
    const secondPod = 'argocd-repo-server-7898d489bb-nsqrr';
    const productionPalette = Array.from({ length: 24 }, (_, index) => `color-${index + 1}`);

    const forward = buildStablePodColorMap([firstPod, secondPod], productionPalette, 'fallback');
    const reversed = buildStablePodColorMap([secondPod, firstPod], productionPalette, 'fallback');

    expect(forward[firstPod]).toBe(reversed[firstPod]);
    expect(forward[secondPod]).toBe(reversed[secondPod]);
  });

  it('resolves color collisions in locale-alphabetical pod name order', () => {
    const firstAlphabetically = 'ä-pod-15';
    const secondAlphabetically = 'z-pod-0';

    expect(hashPodColorIndex(firstAlphabetically, palette.length)).toBe(
      hashPodColorIndex(secondAlphabetically, palette.length)
    );

    const colorMap = buildStablePodColorMap(
      [secondAlphabetically, firstAlphabetically],
      palette,
      'fallback'
    );

    expect(colorMap[firstAlphabetically]).toBe('color-15');
    expect(colorMap[secondAlphabetically]).toBe('color-16');
  });

  it('uses every available color before reusing a palette slot', () => {
    const podNames = Array.from({ length: 20 }, (_, index) => `pod-${index + 1}`);
    const colorMap = buildStablePodColorMap(podNames, palette, 'fallback');

    for (const podName of podNames) {
      expect(palette).toContain(colorMap[podName]);
    }

    const distinctColors = new Set(podNames.map((podName) => colorMap[podName]));
    expect(distinctColors.size).toBe(palette.length);
  });
});
