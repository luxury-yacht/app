/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Pods/objectPanelPodsScope.test.ts
 */

import { describe, expect, it } from 'vitest';
import { buildObjectPanelPodsScope } from './objectPanelPodsScope';
import type { PanelObjectData } from '../types';

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

  it('falls back to the GVK map when the object omits group/version/kind segments', () => {
    expect(buildObjectPanelPodsScope({ name: 'api', namespace: 'team-a' }, 'statefulset')).toBe(
      'workload:team-a:apps:v1:StatefulSet:api'
    );
  });

  it('uses the batch group for jobs', () => {
    expect(buildObjectPanelPodsScope({ name: 'backup', namespace: 'team-a' }, 'job')).toBe(
      'workload:team-a:batch:v1:Job:backup'
    );
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
