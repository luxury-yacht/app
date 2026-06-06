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
  // Each query-backed view must consume the query lifecycle in one of two forms.
  // Migration (Phase 3) moves views from the legacy form to the controller form
  // one at a time, so both are accepted; once every view is migrated this test
  // tightens to require the controller form (Phase 6).
  it.each(QUERY_BACKED_VIEW_FILES)('%s consumes the query-backed lifecycle', (file) => {
    const source = readFileSync(join(process.cwd(), file), 'utf8');

    if (source.includes('ResourceInventoryTable')) {
      // Controller form: the resource-inventory controller owns boundary, empty
      // eligibility, and the refresh overlay from the normalized source state, so
      // the view must not hand-roll boundaryLoading/loaded/loading.
      expect(source).toMatch(/source=\{/);
      expect(source).not.toContain('boundaryLoading=');
      return;
    }

    // Legacy form: the view threads the query loading/loaded lifecycle into
    // ResourceGridTableView itself.
    expect(source).toContain('loading: tableLoading');
    expect(source).toContain('loaded: tableLoaded');
    expect(source).toContain('ResourceGridTableView');
    expect(source).toMatch(/loaded=\{[^}]*tableLoaded/);
    expect(source).toMatch(/loading=\{[^}]*tableLoading/);
  });
});
