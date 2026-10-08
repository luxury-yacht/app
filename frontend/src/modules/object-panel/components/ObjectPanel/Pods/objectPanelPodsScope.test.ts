/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Pods/objectPanelPodsScope.test.ts
 */

import { describe, expect, it } from 'vitest';
import type { PanelObjectData } from '../types';
import { buildObjectPanelPodsScope } from './objectPanelPodsScope';

describe('buildObjectPanelPodsScope', () => {
  it('returns null when the object name is missing', () => {
    expect(
      buildObjectPanelPodsScope({ kind: 'Deployment', namespace: 'team-a' }, 'deployment')
    ).toBeNull();
  });

  it('returns null when the kind is missing', () => {
    expect(buildObjectPanelPodsScope({ name: 'api', namespace: 'team-a' }, null)).toBeNull();
  });

  it('builds a node scope for Node panels', () => {
    expect(buildObjectPanelPodsScope({ kind: 'Node', name: 'worker-a' }, 'node')).toBe(
      'node:worker-a'
    );
  });

  it('builds a workload scope from the object GVK', () => {
    const objectData: PanelObjectData = {
      kind: 'Deployment',
      name: 'api',
      namespace: 'team-a',
      group: 'apps',
      version: 'v1',
    };
    expect(buildObjectPanelPodsScope(objectData, 'deployment')).toBe(
      'workload:team-a:apps:v1:Deployment:api'
    );
  });

  it('returns null when a workload object omits group/version/kind segments', () => {
    expect(
      buildObjectPanelPodsScope({ name: 'api', namespace: 'team-a' }, 'statefulset')
    ).toBeNull();
  });

  it('returns null when a workload object has kind and version but omits group', () => {
    expect(
      buildObjectPanelPodsScope(
        { kind: 'Deployment', name: 'api', namespace: 'team-a', version: 'v1' },
        'deployment'
      )
    ).toBeNull();
  });

  // The backend's workload scope reaches a CronJob's pods through its Jobs.
  it.each([
    ['Job', 'backup'],
    ['CronJob', 'nightly'],
  ])('scopes a %s through the batch group', (kind, name) => {
    expect(
      buildObjectPanelPodsScope(
        { kind, name, namespace: 'team-a', group: 'batch', version: 'v1' },
        kind.toLowerCase()
      )
    ).toBe(`workload:team-a:batch:v1:${kind}:${name}`);
  });

  it('returns null for a workload without a namespace', () => {
    expect(buildObjectPanelPodsScope({ kind: 'Deployment', name: 'api' }, 'deployment')).toBeNull();
  });

  it('returns null for unsupported kinds', () => {
    expect(
      buildObjectPanelPodsScope(
        { kind: 'ServiceAccount', name: 'builder', namespace: 'team-a' },
        'serviceaccount'
      )
    ).toBeNull();
  });

  it('returns null when the object data is null', () => {
    expect(buildObjectPanelPodsScope(null, 'deployment')).toBeNull();
  });
});
