/**
 * frontend/src/ui/modals/useObjectDiffYaml.test.tsx
 *
 * One side of the object diff reads its object's YAML: it keeps the last YAML
 * while a refresh fails, marks the side updated when the backend's YAML
 * changes, and never shows one object's YAML or update mark for another, even
 * for an object with the same UID in another cluster. Runs the hook in the
 * production shell (refresh orchestrator, store, data-access leases) over the
 * faked backend (test-utils/appState): reads are answered by the snapshot
 * server, and refreshes arrive on the object-yaml poll.
 */

import type { CatalogItem } from '@core/refresh/types';
import { act } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { snapshotResponse } from '@/test-utils/appState/transport';
import { makeErrorStatus } from '@/test-utils/errorStatusFixtures';
import { useObjectDiffYaml } from './useObjectDiffYaml';

const app = installAppStateHarness();
let dev: TestCluster;
let stg: TestCluster;
let view: MountedApp;
let current: ReturnType<typeof useObjectDiffYaml>;
const seen: Array<Pick<typeof current, 'normalized' | 'changedAt'>> = [];

// The object-yaml domain polls every 5 s (types.generated.ts).
const POLL_MS = 5_000;

const deployment = { group: 'apps', version: 'v1', kind: 'Deployment', namespace: 'ns' };

const catalogItem = (cluster: TestCluster, name: string): CatalogItem => ({
  ref: {
    ...deployment,
    clusterId: cluster.clusterId,
    resource: 'deployments',
    name,
    // Both clusters' objects share a UID, as restored or copied objects can.
    uid: 'shared-uid',
  },
  resourceVersion: '1',
  creationTimestamp: '',
  scope: 'Namespace',
});

const yamlScope = (cluster: TestCluster, name: string) =>
  app.object(cluster, { ...deployment, name }).scopes.detailScope ?? '';

const serveYaml = (cluster: TestCluster, name: string, yaml: string) => {
  app.snapshots.serve('object-yaml', yamlScope(cluster, name), {
    clusterId: cluster.clusterId,
    clusterName: cluster.clusterName,
    yaml,
  });
};

function Side({ selection }: Readonly<{ selection: CatalogItem }>) {
  current = useObjectDiffYaml(selection, true);
  seen.push({ normalized: current.normalized, changedAt: current.changedAt });
  return null;
}

const poll = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(POLL_MS);
  });
  await app.settle();
};

beforeEach(async () => {
  vi.useFakeTimers();
  seen.length = 0;
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  stg = app.cluster({ name: 'stg', context: 'beta' });
  app.namespaces(dev, ['ns']);
  app.namespaces(stg, ['ns']);
  view = await app.render(null);
});

afterEach(() => {
  vi.useRealTimers();
});

it('keeps the last YAML while a refresh fails and marks the side updated when the YAML changes', async () => {
  serveYaml(dev, 'app', 'value: first');
  await view.show(<Side selection={catalogItem(dev, 'app')} />);
  expect(current.normalized).toContain('first');
  expect(current.changedAt).toBeNull();

  serveYaml(dev, 'app', 'value: second');
  await poll();
  expect(current.normalized).toContain('second');
  expect(current.changedAt).not.toBeNull();

  app.snapshots.fail(
    'object-yaml',
    yamlScope(dev, 'app'),
    makeErrorStatus('ServiceUnavailable', 'cluster offline')
  );
  await poll();
  expect(current.error).toContain('cluster offline');
  expect(current.normalized).toContain('second');
  // The failed refresh is also reported to the user.
  expect(
    app.errors.take((record) => (record.error as Error).message === 'cluster offline')
  ).toHaveLength(1);
});

it('starts another cluster’s object with the same UID empty and unmarked', async () => {
  serveYaml(dev, 'app', 'value: first');
  await view.show(<Side selection={catalogItem(dev, 'app')} />);
  serveYaml(dev, 'app', 'value: second');
  await poll();
  expect(current.changedAt).not.toBeNull();

  // The other cluster's read stays in flight until the test answers it.
  let answer!: () => void;
  app.snapshots.respond(({ domain, scope }) =>
    domain === 'object-yaml' && scope === yamlScope(stg, 'app')
      ? new Promise<Response>((resolve) => {
          answer = () =>
            resolve(
              snapshotResponse({ domain, scope, version: 1, payload: { yaml: 'value: third' } })
            );
        })
      : undefined
  );
  seen.length = 0;
  await view.show(<Side selection={catalogItem(stg, 'app')} />);

  expect(current.initialLoading).toBe(true);
  expect(seen).not.toEqual([]);
  expect(seen.every(({ normalized, changedAt }) => normalized === '' && changedAt === null)).toBe(
    true
  );

  await act(async () => answer());
  await app.settle();
  expect(current.normalized).toContain('third');
  expect(current.changedAt).toBeNull();

  // Unlike a failed read, a read that succeeds with no YAML replaces what was shown.
  app.snapshots.respond(null);
  serveYaml(stg, 'app', '');
  await poll();
  expect(current.normalized).toBe('');
});
