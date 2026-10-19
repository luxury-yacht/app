/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Pods/objectPanelPodsScope.test.ts
 */

import { describe, expect, it } from 'vitest';
import type { PanelObjectData } from '../types';
import { buildObjectPanelPodsSelector } from './objectPanelPodsScope';

describe('buildObjectPanelPodsSelector', () => {
  it('returns null when the object name is missing', () => {
    expect(
      buildObjectPanelPodsSelector({ kind: 'Deployment', namespace: 'team-a' }, 'deployment')
    ).toBeNull();
  });

  it('returns null when the kind is missing', () => {
    expect(buildObjectPanelPodsSelector({ name: 'api', namespace: 'team-a' }, null)).toBeNull();
  });

  it('builds a node scope for Node panels', () => {
    expect(buildObjectPanelPodsSelector({ kind: 'Node', name: 'worker-a' }, 'node')).toEqual({
      kind: 'node',
      node: 'worker-a',
    });
  });

  it('builds a workload scope from the object GVK', () => {
    const objectData: PanelObjectData = {
      kind: 'Deployment',
      name: 'api',
      namespace: 'team-a',
      group: 'apps',
      version: 'v1',
    };
    expect(buildObjectPanelPodsSelector(objectData, 'deployment')).toEqual({
      kind: 'workload',
      object: {
        namespace: 'team-a',
        group: 'apps',
        version: 'v1',
        kind: 'Deployment',
        name: 'api',
      },
    });
  });

  it('returns null when a workload object omits group/version/kind segments', () => {
    expect(
      buildObjectPanelPodsSelector({ name: 'api', namespace: 'team-a' }, 'statefulset')
    ).toBeNull();
  });

  it('returns null when a workload object has kind and version but omits group', () => {
    expect(
      buildObjectPanelPodsSelector(
        { kind: 'Deployment', name: 'api', namespace: 'team-a', version: 'v1' },
        'deployment'
      )
    ).toBeNull();
  });

  it('uses the batch group for jobs', () => {
    expect(
      buildObjectPanelPodsSelector(
        { kind: 'Job', name: 'backup', namespace: 'team-a', group: 'batch', version: 'v1' },
        'job'
      )
    ).toEqual({
      kind: 'workload',
      object: { namespace: 'team-a', group: 'batch', version: 'v1', kind: 'Job', name: 'backup' },
    });
  });

  it('returns null for a workload without a namespace', () => {
    expect(
      buildObjectPanelPodsSelector({ kind: 'Deployment', name: 'api' }, 'deployment')
    ).toBeNull();
  });

  it('returns null for unsupported kinds', () => {
    expect(
      buildObjectPanelPodsSelector(
        { kind: 'ServiceAccount', name: 'builder', namespace: 'team-a' },
        'serviceaccount'
      )
    ).toBeNull();
  });

  it('returns null when the object data is null', () => {
    expect(buildObjectPanelPodsSelector(null, 'deployment')).toBeNull();
  });
});
