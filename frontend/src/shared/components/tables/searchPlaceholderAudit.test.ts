import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');

const viewsUsingSharedFilterPlaceholder = [
  'frontend/src/modules/browse/components/BrowseView.tsx',
  'frontend/src/modules/cluster/components/ClusterViewNodes.tsx',
  'frontend/src/modules/cluster/components/ClusterViewRBAC.tsx',
  'frontend/src/modules/cluster/components/ClusterViewStorage.tsx',
  'frontend/src/modules/cluster/components/ClusterViewConfig.tsx',
  'frontend/src/modules/cluster/components/ClusterViewCustom.tsx',
  'frontend/src/modules/cluster/components/ClusterViewEvents.tsx',
  'frontend/src/modules/cluster/components/ClusterViewCRDs.tsx',
  'frontend/src/modules/namespace/components/NsViewWorkloads.tsx',
  'frontend/src/modules/namespace/components/NsViewPods.tsx',
  'frontend/src/modules/namespace/components/NsViewConfig.tsx',
  'frontend/src/modules/namespace/components/NsViewAutoscaling.tsx',
  'frontend/src/modules/namespace/components/NsViewNetwork.tsx',
  'frontend/src/modules/namespace/components/NsViewQuotas.tsx',
  'frontend/src/modules/namespace/components/NsViewRBAC.tsx',
  'frontend/src/modules/namespace/components/NsViewStorage.tsx',
  'frontend/src/modules/namespace/components/NsViewEvents.tsx',
  'frontend/src/modules/namespace/components/NsViewCustom.tsx',
  'frontend/src/modules/namespace/components/NsViewHelm.tsx',
  'frontend/src/modules/object-panel/components/ObjectPanel/Pods/PodsTab.tsx',
  'frontend/src/modules/object-panel/components/ObjectPanel/Jobs/JobsTab.tsx',
] as const;

describe('GridTable search placeholder audit', () => {
  it('keeps major table families on the shared filter placeholder', () => {
    for (const relativePath of viewsUsingSharedFilterPlaceholder) {
      const absolutePath = path.join(repoRoot, relativePath);
      const source = fs.readFileSync(absolutePath, 'utf8');

      expect(source, relativePath).not.toContain('searchPlaceholder:');
    }
  });
});
