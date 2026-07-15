import { describe, expect, it } from 'vitest';
import { getScopedFeaturesForView } from '@/core/refresh/components/diagnostics';
import { requireValue } from '@/test-utils/requireValue';
import { CLUSTER_CAPABILITIES } from './catalog';
import { PERMISSION_FEATURE_LABELS } from './permissionFeatures';
import { ALL_NAMESPACE_PERMISSIONS, CLUSTER_PERMISSIONS } from './permissionSpecs';

describe('permission feature contract', () => {
  it('uses stable feature keys with labels for every static permission spec', () => {
    const specs = [...ALL_NAMESPACE_PERMISSIONS, ...CLUSTER_PERMISSIONS];

    for (const specList of specs) {
      expect(PERMISSION_FEATURE_LABELS[specList.feature]).toBeTruthy();
    }
  });

  it('keeps cluster capability features in the same keyed catalog', () => {
    for (const capability of CLUSTER_CAPABILITIES) {
      expect(capability.feature).toBeTruthy();
      expect(
        PERMISSION_FEATURE_LABELS[
          requireValue(capability.feature, 'expected test value in permissionFeatures.test.ts')
        ]
      ).toBeTruthy();
    }
  });

  it('maps diagnostics filters to known feature keys', () => {
    const filters = [
      ...getScopedFeaturesForView('overview', null, 'browse'),
      ...getScopedFeaturesForView('cluster', 'nodes', 'browse'),
      ...getScopedFeaturesForView('cluster', 'rbac', 'browse'),
      ...getScopedFeaturesForView('cluster', 'storage', 'browse'),
      ...getScopedFeaturesForView('cluster', 'config', 'browse'),
      ...getScopedFeaturesForView('cluster', 'crds', 'browse'),
      ...getScopedFeaturesForView('cluster', 'custom', 'browse'),
      ...getScopedFeaturesForView('cluster', 'events', 'browse'),
      ...getScopedFeaturesForView('namespace', null, 'map'),
      ...getScopedFeaturesForView('namespace', null, 'workloads'),
      ...getScopedFeaturesForView('namespace', null, 'config'),
      ...getScopedFeaturesForView('namespace', null, 'network'),
      ...getScopedFeaturesForView('namespace', null, 'rbac'),
      ...getScopedFeaturesForView('namespace', null, 'storage'),
      ...getScopedFeaturesForView('namespace', null, 'autoscaling'),
      ...getScopedFeaturesForView('namespace', null, 'quotas'),
      ...getScopedFeaturesForView('namespace', null, 'custom'),
      ...getScopedFeaturesForView('namespace', null, 'helm'),
      ...getScopedFeaturesForView('namespace', null, 'events'),
    ];

    for (const feature of filters) {
      expect(PERMISSION_FEATURE_LABELS[feature]).toBeTruthy();
    }
  });
});
