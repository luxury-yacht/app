/**
 * frontend/src/ui/modals/objectYamlScopeSharing.test.tsx
 *
 * The object diff modal and an open YAML tab read the same object-yaml scope
 * (useObjectDiffYaml builds the panel's scope on purpose so both share one
 * cache entry). Closing the modal must not take the YAML tab's data or its
 * refresh away. Runs both production hooks against the real orchestrator.
 */

import type { CatalogItem } from '@core/refresh/types';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';

const { fetchSnapshotMock } = vi.hoisted(() => ({ fetchSnapshotMock: vi.fn() }));

vi.mock('@/core/refresh/client', () => ({
  fetchSnapshot: (...args: unknown[]) => fetchSnapshotMock(...args),
  setMetricsActive: () => Promise.resolve(),
}));

vi.mock('@/core/logging/appLogsClient', () => ({
  APP_LOG_SOURCES: new Proxy({}, { get: (_target, key) => String(key) }),
  logAppLogsDebug: () => undefined,
  logAppLogsInfo: () => undefined,
  logAppLogsWarn: () => undefined,
  logAppLogsError: () => undefined,
}));

import { getScopedDomainState } from '@/core/refresh/store';
import { setAppPreferencesForTesting } from '@/core/settings/appPreferences';
import { useYamlTransaction } from '@/modules/object-panel/components/ObjectPanel/Yaml/yamlTransaction';
import {
  flushRefreshWork,
  installFakeStreamSockets,
  markClusterReady,
  resetRefreshHarness,
} from '@/test-utils/refreshHarness';
import { testScope } from '@/test-utils/refreshScope';
import { useObjectDiffYaml } from './useObjectDiffYaml';

const CLUSTER = 'yaml-share';
const SCOPE = testScope(CLUSTER, 'ns:apps/v1:Deployment:app');

const item: CatalogItem = {
  ref: {
    clusterId: CLUSTER,
    group: 'apps',
    version: 'v1',
    kind: 'Deployment',
    namespace: 'ns',
    name: 'app',
    uid: 'app-uid',
    resource: 'deployments',
  },
  resourceVersion: '1',
  creationTimestamp: '',
  scope: 'Namespace',
};

function YamlTabAndDiff({ diffOpen }: { diffOpen: boolean }) {
  useYamlTransaction({
    scope: SCOPE,
    isActive: true,
    canEdit: false,
    clusterId: CLUSTER,
    yamlContent: '',
    prepareVisibleDraftYaml: (yaml: string) => yaml,
  });
  useObjectDiffYaml(item, diffOpen);
  return null;
}

let reads = 0;

beforeAll(() => {
  installFakeStreamSockets();
});

beforeEach(() => {
  vi.useFakeTimers();
  setAppPreferencesForTesting({ autoRefreshEnabled: true });
  reads = 0;
  fetchSnapshotMock.mockReset();
  fetchSnapshotMock.mockImplementation(async (domain: string, options: { scope: string }) => {
    reads += 1;
    return {
      notModified: false,
      etag: `v${reads}`,
      snapshot: {
        domain,
        scope: options.scope,
        version: reads,
        checksum: `c${reads}`,
        generatedAt: Date.now(),
        sequence: reads,
        payload: { yaml: `kind: Deployment\nmetadata:\n  name: app\n# read ${reads}\n` },
        stats: { itemCount: 1, buildDurationMs: 0 },
      },
    };
  });
  markClusterReady(CLUSTER);
});

afterEach(async () => {
  resetRefreshHarness();
  await vi.runOnlyPendingTimersAsync();
  vi.useRealTimers();
});

it('closing the diff modal leaves an open YAML tab with its data and refresh', async () => {
  const root = createRoot(document.createElement('div'));
  await act(async () => {
    root.render(<YamlTabAndDiff diffOpen={true} />);
    await flushRefreshWork();
  });
  expect(getScopedDomainState('object-yaml', SCOPE).data).toBeTruthy();

  await act(async () => {
    root.render(<YamlTabAndDiff diffOpen={false} />);
    await flushRefreshWork();
  });
  expect(getScopedDomainState('object-yaml', SCOPE).data).toBeTruthy();

  const before = reads;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000);
    await flushRefreshWork();
  });
  expect(reads).toBeGreaterThan(before);

  act(() => root.unmount());
});
