/**
 * frontend/src/modules/namespace/components/NsViewQuotas.test.tsx
 *
 * What the namespace Quotas view shows beyond the aggregated namespace table
 * it shares with Config (covered in NsViewConfig.test.tsx): the namespace's
 * quota objects from the backend's namespace-quotas query in its own column
 * set, which keeps to each object's kind, name, and age and leaves the rows'
 * quota details and disruption status out of the table. Runs in the full app,
 * navigated through the sidebar, over a faked backend (test-utils/appState).
 */

import { beforeEach, describe, expect, it } from 'vitest';
import type { NamespaceQuotaSummary } from '@/core/refresh/types';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';

const app = installAppStateHarness();
let dev: TestCluster;
let view: MountedApp;

const resourceQuota = (name: string): NamespaceQuotaSummary => ({
  ref: {
    clusterId: dev.clusterId,
    group: '',
    version: 'v1',
    kind: 'ResourceQuota',
    resource: 'resourcequotas',
    namespace: 'team-a',
    name,
    uid: `${name}-uid`,
  },
  details: '3 resources',
  age: '1h',
});

const disruptionBudget = (name: string): NamespaceQuotaSummary => ({
  ref: {
    clusterId: dev.clusterId,
    group: 'policy',
    version: 'v1',
    kind: 'PodDisruptionBudget',
    resource: 'poddisruptionbudgets',
    namespace: 'team-a',
    name,
    uid: `${name}-uid`,
  },
  details: 'Min available: 1',
  minAvailable: '1',
  status: { disruptionsAllowed: 1, currentHealthy: 2, desiredHealthy: 1 },
  age: '2h',
});

beforeEach(() => {
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['team-a']);
});

describe('NsViewQuotas', () => {
  it('lists the namespace’s quota objects by kind, name, and age only', async () => {
    app.startScreen(dev);
    app.serveTable(dev, 'namespace-quotas', {
      rows: [resourceQuota('rq-default'), disruptionBudget('web-pdb')],
    });
    view = await app.mountApp();

    await view.goTo({ namespace: 'team-a', view: 'quotas' });

    const columns = Array.from(
      view.container.querySelectorAll<HTMLElement>('.grid-cell-header[data-column]'),
      (header) => header.dataset.column
    );
    expect(columns).toEqual(['kind', 'name', 'age']);
    const rows = Array.from(view.container.querySelectorAll<HTMLElement>('.gridtable-row'), (row) =>
      columns.map((column) =>
        row.querySelector(`.grid-cell[data-column="${column}"]`)?.textContent?.trim()
      )
    );
    // Rows keep the backend query's order.
    expect(rows).toEqual([
      ['ResourceQuota', 'rq-default', '1h'],
      ['PodDisruptionBudget', 'web-pdb', '2h'],
    ]);
  });
});
