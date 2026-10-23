/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Pods/objectPanelPodsScope.test.ts
 *
 * The Pods tab's selector comes from the kind's pods facet, matched by the
 * object's complete identity.
 */

import { describe, expect, it } from 'vitest';
import type { PanelObjectData } from '../types';
import { buildObjectPanelPodsSelector } from './objectPanelPodsScope';

const workload = (overrides: Partial<PanelObjectData> = {}): PanelObjectData => ({
  kind: 'Deployment',
  name: 'api',
  namespace: 'team-a',
  group: 'apps',
  version: 'v1',
  ...overrides,
});

describe('buildObjectPanelPodsSelector', () => {
  it('selects a node’s pods by node name', () => {
    expect(
      buildObjectPanelPodsSelector({ kind: 'Node', name: 'worker-a', group: '', version: 'v1' })
    ).toEqual({ kind: 'node', node: 'worker-a' });
  });

  it('selects a workload’s pods by its complete identity', () => {
    expect(buildObjectPanelPodsSelector(workload())).toEqual({
      kind: 'workload',
      object: {
        namespace: 'team-a',
        group: 'apps',
        version: 'v1',
        kind: 'Deployment',
        name: 'api',
      },
    });
    expect(
      buildObjectPanelPodsSelector(workload({ kind: 'Job', name: 'backup', group: 'batch' }))
    ).toEqual({
      kind: 'workload',
      object: { namespace: 'team-a', group: 'batch', version: 'v1', kind: 'Job', name: 'backup' },
    });
  });

  // The backend matches the owner's kind exactly, so a panel opened from a
  // lowercase link (a Deployment's current ReplicaSet) must send the canonical kind.
  it('sends the canonical kind for a ref spelled in lowercase', () => {
    expect(buildObjectPanelPodsSelector(workload({ kind: 'replicaset' }))).toEqual({
      kind: 'workload',
      object: {
        namespace: 'team-a',
        group: 'apps',
        version: 'v1',
        kind: 'ReplicaSet',
        name: 'api',
      },
    });
  });

  it('selects nothing for a kind without a Pods tab', () => {
    expect(
      buildObjectPanelPodsSelector(workload({ kind: 'ServiceAccount', group: '' }))
    ).toBeNull();
    // A CronJob lists its pods per Job in the Jobs tab.
    expect(buildObjectPanelPodsSelector(workload({ kind: 'CronJob', group: 'batch' }))).toBeNull();
    // A custom resource named like a built-in kind is not that kind.
    expect(
      buildObjectPanelPodsSelector(
        workload({ kind: 'Job', group: 'batch.volcano.sh', version: 'v1alpha1' })
      )
    ).toBeNull();
  });

  it('selects nothing without a complete identity, a name, or a workload namespace', () => {
    expect(buildObjectPanelPodsSelector(null)).toBeNull();
    expect(buildObjectPanelPodsSelector(workload({ group: undefined }))).toBeNull();
    expect(buildObjectPanelPodsSelector(workload({ version: undefined }))).toBeNull();
    expect(buildObjectPanelPodsSelector(workload({ name: ' ' }))).toBeNull();
    expect(buildObjectPanelPodsSelector(workload({ namespace: undefined }))).toBeNull();
  });
});
