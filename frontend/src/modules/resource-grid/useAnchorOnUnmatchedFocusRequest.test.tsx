/**
 * frontend/src/modules/resource-grid/useAnchorOnUnmatchedFocusRequest.test.tsx
 *
 * "Show in list" for an object that is not on the destination table's loaded
 * page: navigating to it (useNavigateToView, the only producer of focus
 * requests) turns the request into a backend anchor read on the NAVIGATION
 * DESTINATION table only, which then lands on the object's page. A
 * same-cluster table that is not the destination (an open object panel's Pods
 * list) must not consume the request and issue a spurious anchor. Runs in the
 * full app over a faked backend (test-utils/appState).
 */

import { act } from 'react';
import { describe, expect, it } from 'vitest';
import {
  makeNamespaceWorkloadSnapshotPayload,
  makePodSnapshotEntry,
  makePodSnapshotPayload,
} from '@/core/refresh/refreshContractTestBuilders';
import { parseRefreshScope } from '@/core/refresh/scopeSelector';
import type { PodSnapshotPayload } from '@/core/refresh/types';
import { useNavigateToView } from '@/shared/hooks/useNavigateToView';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { objectDetailOf } from '@/test-utils/objectDetail';
import { requireValue } from '@/test-utils/requireValue';

const app = installAppStateHarness();
let dev: TestCluster;
let view: MountedApp;
let navigateToView: ReturnType<typeof useNavigateToView>['navigateToView'] | undefined;

function NavigateProbe() {
  navigateToView = useNavigateToView().navigateToView;
  return null;
}

const deployment = {
  group: 'apps',
  version: 'v1',
  kind: 'Deployment',
  namespace: 'default',
  name: 'api',
};

/** A pods page as backend/refresh/snapshot/pods.go serves it. */
const podsPage = (
  namespace: string,
  names: string[],
  overrides: Partial<PodSnapshotPayload> = {}
): PodSnapshotPayload =>
  makePodSnapshotPayload({
    clusterId: dev.clusterId,
    clusterName: dev.clusterName,
    rows: names.map((name) =>
      makePodSnapshotEntry({ ref: { clusterId: dev.clusterId, namespace, name } })
    ),
    total: 61,
    unfilteredTotal: 61,
    ...overrides,
  });

const podReads = () =>
  app.snapshots.reads('pods').map((read) => {
    const { selector, query } = parseRefreshScope('pods', read.scope);
    return { selector, params: new URLSearchParams(query ?? '') };
  });
const anchoredReads = () => podReads().filter((read) => read.params.has('anchor.name'));

/**
 * The shop namespace has 61 pods; web-5 sorts onto page 2. The backend lands
 * an anchored read on web-5's page; every other pods read is answered too.
 */
const startCluster = () => {
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['default', 'shop']);
  app.startScreen(dev);
  app.snapshots.answer(({ domain, scope }) => {
    if (domain === 'namespace-workloads') {
      return makeNamespaceWorkloadSnapshotPayload({
        clusterId: dev.clusterId,
        clusterName: dev.clusterName,
      });
    }
    if (domain !== 'pods') {
      return undefined;
    }
    const { selector, query } = parseRefreshScope('pods', scope);
    const params = new URLSearchParams(query ?? '');
    if (params.has('anchor.name')) {
      return podsPage('shop', ['web-5'], {
        anchor: { found: true, rank: 55 },
        pageStartRank: 50,
        self: 'web-5-page',
      });
    }
    if (params.get('continue') === 'web-5-page') {
      return podsPage('shop', ['web-5']);
    }
    if (selector.kind === 'namespace' && selector.namespace === 'shop') {
      return podsPage('shop', ['web-0'], { continue: 'page-2' });
    }
    return podsPage('default', ['api-1']);
  });
  // backend/autoscaling_details.go IsWorkloadHPAManaged: no HPA targets the workload.
  app.backend.answer('IsWorkloadHPAManaged', () => false);
};

const mount = async () => {
  view = await app.mountApp(<NavigateProbe />);
};

const activate = async (run: () => void) => {
  await act(async () => {
    run();
  });
  await app.settle();
};

/** Alt+click navigation to web-5, as an object panel link does it. */
const navigateToWeb5 = () =>
  activate(() =>
    requireValue(
      navigateToView,
      'expected the navigation hook'
    )({
      clusterId: dev.clusterId,
      clusterName: dev.clusterName,
      group: '',
      version: 'v1',
      kind: 'Pod',
      namespace: 'shop',
      name: 'web-5',
    })
  );

// Docked panels render outside the workspace container.
const renderedRows = () =>
  Array.from(document.querySelectorAll<HTMLElement>('.gridtable-row')).map(
    (row) => row.textContent ?? ''
  );

const selectPanelTab = async (label: string) => {
  const tablist = requireValue(
    document.querySelector('[role="tablist"][aria-label="Object Panel Tabs"]'),
    'expected the object panel tab strip'
  );
  const tab = requireValue(
    (tablist.getAttribute('aria-owns') ?? '')
      .split(' ')
      .map((id) => document.getElementById(id))
      .find((element) => element?.textContent?.trim().toLowerCase() === label),
    `expected the ${label} tab`
  );
  await activate(() => tab.click());
};

describe('useAnchorOnUnmatchedFocusRequest — destination scoping', () => {
  it('anchors the destination table on an object its first page does not show', async () => {
    startCluster();
    await mount();

    await navigateToWeb5();

    expect(view.owners().viewState?.activeNamespaceTab).toBe('pods');
    expect(view.owners().namespace.selectedNamespace).toBe('shop');
    expect(anchoredReads()).toEqual([
      {
        selector: { kind: 'namespace', namespace: 'shop' },
        params: expect.any(URLSearchParams),
      },
    ]);
    const anchor = Object.fromEntries(
      requireValue(anchoredReads()[0], 'expected the anchored read').params
    );
    expect(anchor).toMatchObject({
      'anchor.clusterId': dev.clusterId,
      'anchor.version': 'v1',
      'anchor.kind': 'Pod',
      'anchor.namespace': 'shop',
      'anchor.name': 'web-5',
    });
    expect(renderedRows()).toEqual([expect.stringContaining('web-5')]);
  });

  it('leaves an open object panel’s Pods list alone while the destination anchors', async () => {
    startCluster();
    const panel = app.servePanel(
      dev,
      deployment,
      objectDetailOf('deployment', { name: deployment.name, namespace: deployment.namespace })
    );
    await mount();
    await activate(() => view.owners().objectPanel.openWithObject(panel.ref));
    await selectPanelTab('pods');
    expect(podReads().some((read) => read.selector.kind === 'workload')).toBe(true);

    await navigateToWeb5();

    // The panel still lists its workload's pods beside the destination's landing.
    expect(renderedRows()).toEqual(
      expect.arrayContaining([expect.stringContaining('api-1'), expect.stringContaining('web-5')])
    );
    expect(anchoredReads().map((read) => read.selector)).toEqual([
      { kind: 'namespace', namespace: 'shop' },
    ]);
  });
});
