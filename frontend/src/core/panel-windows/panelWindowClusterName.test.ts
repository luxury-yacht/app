import { describe, expect, it } from 'vitest';
import { resolvePanelWindowClusterName } from './panelWindowClusterName';

describe('resolvePanelWindowClusterName', () => {
  it('uses the owner workspace cluster display name', () => {
    const clusters = new Map([['cluster-1', { clusterName: 'Production' }]]);

    expect(resolvePanelWindowClusterName(clusters, 'cluster-1')).toBe('Production');
  });

  it('falls back to the stable cluster id until metadata is available', () => {
    expect(resolvePanelWindowClusterName(new Map(), 'cluster-1')).toBe('cluster-1');
  });
});
