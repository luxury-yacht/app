import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const QUERY_BACKED_VIEW_FILES = [
  'src/modules/cluster/components/ClusterViewConfig.tsx',
  'src/modules/cluster/components/ClusterViewCRDs.tsx',
  'src/modules/cluster/components/ClusterViewEvents.tsx',
  'src/modules/cluster/components/ClusterViewNodes.tsx',
  'src/modules/cluster/components/ClusterViewRBAC.tsx',
  'src/modules/cluster/components/ClusterViewStorage.tsx',
  'src/modules/namespace/components/NsViewAutoscaling.tsx',
  'src/modules/namespace/components/NsViewConfig.tsx',
  'src/modules/namespace/components/NsViewEvents.tsx',
  'src/modules/namespace/components/NsViewHelm.tsx',
  'src/modules/namespace/components/NsViewNetwork.tsx',
  'src/modules/namespace/components/NsViewPods.tsx',
  'src/modules/namespace/components/NsViewQuotas.tsx',
  'src/modules/namespace/components/NsViewRBAC.tsx',
  'src/modules/namespace/components/NsViewStorage.tsx',
  'src/modules/namespace/components/NsViewWorkloads.tsx',
] as const;

describe('query-backed view loading contract', () => {
  it.each(QUERY_BACKED_VIEW_FILES)('%s consumes query-backed loading and loaded state', (file) => {
    const source = readFileSync(join(process.cwd(), file), 'utf8');

    expect(source).toContain('loading: tableLoading');
    expect(source).toContain('loaded: tableLoaded');
    expect(source).toContain('ResourceGridTableView');
    expect(source).toMatch(/loaded=\{[^}]*tableLoaded/);
    expect(source).toMatch(/loading=\{[^}]*tableLoading/);
  });
});
