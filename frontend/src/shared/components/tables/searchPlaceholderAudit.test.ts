import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');

const expectedSearchPlaceholders = [
  [
    'frontend/src/modules/browse/components/BrowseView.tsx',
    "searchPlaceholder: 'Search resources'",
  ],
  [
    'frontend/src/modules/cluster/components/ClusterViewNodes.tsx',
    "searchPlaceholder: 'Search nodes'",
  ],
  [
    'frontend/src/modules/cluster/components/ClusterViewRBAC.tsx',
    "searchPlaceholder: 'Search RBAC resources'",
  ],
  [
    'frontend/src/modules/cluster/components/ClusterViewStorage.tsx',
    "searchPlaceholder: 'Search storage resources'",
  ],
  [
    'frontend/src/modules/cluster/components/ClusterViewConfig.tsx',
    "searchPlaceholder: 'Search configuration resources'",
  ],
  [
    'frontend/src/modules/cluster/components/ClusterViewCustom.tsx',
    "searchPlaceholder: 'Search custom resources'",
  ],
  [
    'frontend/src/modules/cluster/components/ClusterViewEvents.tsx',
    "searchPlaceholder: 'Search events'",
  ],
  [
    'frontend/src/modules/cluster/components/ClusterViewCRDs.tsx',
    "searchPlaceholder: 'Search CRDs'",
  ],
  [
    'frontend/src/modules/namespace/components/NsViewWorkloads.tsx',
    "searchPlaceholder: 'Search workloads'",
  ],
  ['frontend/src/modules/namespace/components/NsViewPods.tsx', "searchPlaceholder: 'Search pods'"],
  [
    'frontend/src/modules/namespace/components/NsViewConfig.tsx',
    "searchPlaceholder: 'Search configuration resources'",
  ],
  [
    'frontend/src/modules/namespace/components/NsViewAutoscaling.tsx',
    "searchPlaceholder: 'Search autoscaling resources'",
  ],
  [
    'frontend/src/modules/namespace/components/NsViewNetwork.tsx',
    "searchPlaceholder: 'Search network resources'",
  ],
  [
    'frontend/src/modules/namespace/components/NsViewQuotas.tsx',
    "searchPlaceholder: 'Search quotas'",
  ],
  [
    'frontend/src/modules/namespace/components/NsViewRBAC.tsx',
    "searchPlaceholder: 'Search RBAC resources'",
  ],
  [
    'frontend/src/modules/namespace/components/NsViewStorage.tsx',
    "searchPlaceholder: 'Search storage resources'",
  ],
  [
    'frontend/src/modules/namespace/components/NsViewEvents.tsx',
    "searchPlaceholder: 'Search events'",
  ],
  [
    'frontend/src/modules/namespace/components/NsViewCustom.tsx',
    "searchPlaceholder: 'Search custom resources'",
  ],
  [
    'frontend/src/modules/namespace/components/NsViewHelm.tsx',
    "searchPlaceholder: 'Search Helm releases'",
  ],
] as const;

describe('GridTable search placeholder audit', () => {
  it('keeps explicit scoped search placeholders on the major table families', () => {
    for (const [relativePath, expectedPlaceholder] of expectedSearchPlaceholders) {
      const absolutePath = path.join(repoRoot, relativePath);
      const source = fs.readFileSync(absolutePath, 'utf8');

      expect(source, relativePath).toContain(expectedPlaceholder);
    }
  });
});
