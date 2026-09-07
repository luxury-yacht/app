import { describe, expect, it } from 'vitest';
import { resolvePanelWindowClusterName } from './panelWindowClusterName';

describe('resolvePanelWindowClusterName', () => {
  it('uses the cluster display name', () => {
    const clusters = new Map([['cluster-1', { clusterName: 'Production' }]]);

    expect(resolvePanelWindowClusterName(clusters, 'cluster-1')).toBe('Production');
  });

  it('falls back to the stable cluster id until metadata is available', () => {
    expect(resolvePanelWindowClusterName(new Map(), 'cluster-1')).toBe('cluster-1');
  });
  it('disambiguates identical display names with the stable cluster identity', () => {
    const clusters = new Map([
      ['east:production', { clusterName: 'Production' }],
      ['west:production', { clusterName: 'Production' }],
    ]);
    expect(resolvePanelWindowClusterName(clusters, 'east:production')).toBe(
      'Production · east:production'
    );
  });
});
