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

const SHARED_VIEW_FILE = 'src/modules/resource-grid/AggregatedResourceGridView.tsx';

// A view satisfies the contract directly (it renders ResourceInventoryTable
// with a normalized `source`) or by delegating to the shared aggregated view,
// which the dedicated assertion below holds to the direct contract — so the
// delegation marker cannot rot.
const satisfiesDirectContract = (source: string) =>
  source.includes('ResourceInventoryTable') && /source=\{/.test(source);

const delegatesToSharedView = (source: string) => source.includes('AggregatedResourceGridView');

describe('query-backed view loading contract', () => {
  // Every query-backed view consumes the query lifecycle through the
  // resource-inventory controller (the legacy ResourceGridTableView form was
  // removed once migration completed). The controller owns the loading boundary,
  // empty eligibility, and the refresh overlay from the normalized source state,
  // so the view must pass `source={...}` — directly or via the shared
  // aggregated view — and must not hand-roll boundaryLoading/loaded/loading.
  it.each(QUERY_BACKED_VIEW_FILES)('%s consumes the query-backed lifecycle', (file) => {
    const source = readFileSync(join(process.cwd(), file), 'utf8');

    expect(satisfiesDirectContract(source) || delegatesToSharedView(source)).toBe(true);
    expect(source).not.toContain('boundaryLoading=');
  });

  it('the shared aggregated view satisfies the direct contract', () => {
    const source = readFileSync(join(process.cwd(), SHARED_VIEW_FILE), 'utf8');

    expect(satisfiesDirectContract(source)).toBe(true);
    expect(source).not.toContain('boundaryLoading=');
  });
});
