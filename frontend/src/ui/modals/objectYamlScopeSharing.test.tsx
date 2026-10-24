/**
 * frontend/src/ui/modals/objectYamlScopeSharing.test.tsx
 *
 * The object diff modal and an open YAML tab read the same object-yaml scope
 * (useObjectDiffYaml builds the panel's scope on purpose so both share one
 * cache entry). Closing the modal must not take the YAML tab's data or its
 * refresh away. Runs both production hooks inside the real providers.
 */

import type { CatalogItem } from '@core/refresh/types';
import { act } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getScopedDomainState } from '@/core/refresh/store';
import { useYamlTransaction } from '@/modules/object-panel/components/ObjectPanel/Yaml/yamlTransaction';
import { installAppStateHarness, setAutoRefresh } from '@/test-utils/appState/harness';
import { snapshotResponse } from '@/test-utils/appState/transport';
import { testScope } from '@/test-utils/refreshScope';
import { useObjectDiffYaml } from './useObjectDiffYaml';

const app = installAppStateHarness();

function YamlTabAndDiff({
  item,
  scope,
  diffOpen,
}: Readonly<{ item: CatalogItem; scope: string; diffOpen: boolean }>) {
  useYamlTransaction({
    scope,
    isActive: true,
    canEdit: false,
    clusterId: item.ref.clusterId,
    yamlContent: '',
    prepareVisibleDraftYaml: (yaml: string) => yaml,
  });
  useObjectDiffYaml(item, diffOpen);
  return null;
}

let reads = 0;

beforeEach(() => {
  vi.useFakeTimers();
  setAutoRefresh(true);
  reads = 0;
  app.snapshots.respond(({ domain, scope }) => {
    if (domain !== 'object-yaml') {
      return undefined;
    }
    reads += 1;
    return snapshotResponse({
      domain,
      scope,
      version: reads,
      payload: { yaml: `kind: Deployment\nmetadata:\n  name: app\n# read ${reads}\n` },
    });
  });
});

afterEach(() => {
  vi.useRealTimers();
});

it('closing the diff modal leaves an open YAML tab with its data and refresh', async () => {
  const dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['ns']);
  const scope = testScope(dev.clusterId, 'ns:apps/v1:Deployment:app');
  const item: CatalogItem = {
    ref: {
      clusterId: dev.clusterId,
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
  const view = await app.render(null);

  await view.show(<YamlTabAndDiff item={item} scope={scope} diffOpen={true} />);
  expect(getScopedDomainState('object-yaml', scope).data).toBeTruthy();

  await view.show(<YamlTabAndDiff item={item} scope={scope} diffOpen={false} />);
  expect(getScopedDomainState('object-yaml', scope).data).toBeTruthy();

  const before = reads;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000);
  });
  await app.settle();
  expect(reads).toBeGreaterThan(before);
});
