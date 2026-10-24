/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Jobs/JobsTab.test.tsx
 *
 * A CronJob panel's Jobs tab lists the jobs from the CronJob's served details,
 * restores the table state saved for the panel's cluster, and opens or
 * navigates to a job with complete identity in the panel's cluster. JobsTab
 * reads its object from CurrentObjectPanelContext (JobsTab.tsx:63), so the
 * suite mounts the full app (or a native panel window), opens the CronJob's
 * panel, and switches to the Jobs tab through the panel's tab strip. Only the
 * backend boundary is faked (test-utils/appState); the table is stubbed only
 * to reach its cell renders and props.
 */

import type { types } from '@core/backend-api/models';
import { OBJECT_ACTION_IDS } from '@shared/actions/objectActionContract';
import type { GridTableProps } from '@shared/components/tables/GridTable';
import {
  buildGridTableStorageKey,
  computeClusterHash,
} from '@shared/components/tables/persistence/gridTablePersistence';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { objectPanelTabSnapshot } from '@/core/panel-windows/tabTransfer';
import { makeNamespaceWorkloadSnapshotPayload } from '@/core/refresh/refreshContractTestBuilders';
import { parseRefreshScope } from '@/core/refresh/scopeSelector';
import { objectPanelId } from '@/modules/object-panel/objectPanelRef';
import {
  installAppStateHarness,
  type MountedApp,
  type ObjectIdentity,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { type SnapshotRequest, snapshotResponse } from '@/test-utils/appState/transport';
import { objectDetailOf } from '@/test-utils/objectDetail';
import { partialModelFixture } from '@/test-utils/partialModelFixture';
import { requireReactElement } from '@/test-utils/requireReactElement';
import { requireValue } from '@/test-utils/requireValue';

type JobRow = types.JobSimpleInfo & { clusterId?: string | null; clusterName?: string | null };

const JOBS_TABLE = 'Object Panel Jobs';

const gridTables = vi.hoisted(() => new Map<string, unknown>());

vi.mock('@shared/components/tables/GridTable', () => ({
  default: (props: { diagnosticsLabel?: string }) => {
    gridTables.set(props.diagnosticsLabel ?? '', props);
    return <div data-testid="grid-table" data-label={props.diagnosticsLabel} />;
  },
  GRIDTABLE_VIRTUALIZATION_DEFAULT: {},
}));

const app = installAppStateHarness();

const cronJob: ObjectIdentity = {
  group: 'batch',
  version: 'v1',
  kind: 'CronJob',
  namespace: 'default',
  name: 'my-cronjob',
};

const makeJob = (overrides: Partial<types.JobSimpleInfo> = {}): types.JobSimpleInfo =>
  partialModelFixture<types.JobSimpleInfo>({
    kind: 'Job',
    name: 'test-job-1',
    namespace: 'default',
    status: 'Completed',
    statusState: 'True',
    statusPresentation: 'ready',
    completions: '1/1',
    succeeded: 1,
    failed: 0,
    active: 0,
    age: '5m',
    duration: '30s',
    ...overrides,
  });

let dev: TestCluster;
let view: MountedApp;

const jobsTable = () =>
  requireValue(
    gridTables.get(JOBS_TABLE) as GridTableProps<JobRow> | undefined,
    'expected the rendered Jobs table'
  );

const column = (key: string) =>
  requireValue(
    jobsTable().columns.find((candidate) => candidate.key === key),
    `expected the ${key} column`
  );

const firstRow = () => requireValue(jobsTable().data[0], 'expected a job row');

const activate = async (run: () => void) => {
  await act(async () => {
    run();
  });
  await app.settle();
};

/** The reads a panel makes, with `detail` as its object-details snapshot (test-utils/appState). */
const servePanel = (identity: ObjectIdentity, detail: object) =>
  app.servePanel(dev, identity, detail as never);

const startCluster = () => {
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['default', 'ops']);
  app.startScreen(dev);
};

// backend/resources/cronjob/details.go: a CronJob's details carry the jobs it owns.
const serveCronJob = (jobs: types.JobSimpleInfo[]) =>
  servePanel(
    cronJob,
    objectDetailOf('cronjob', { name: cronJob.name, namespace: cronJob.namespace, jobs })
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

/** Opens the CronJob's panel in the workspace and shows its Jobs tab. */
const openJobsTab = async (jobs: types.JobSimpleInfo[]) => {
  const panel = serveCronJob(jobs);
  view = await app.mountApp();
  await activate(() => view.owners().objectPanel.openWithObject(panel.ref));
  await selectPanelTab('jobs');
};

const nightlyJob: ObjectIdentity = {
  group: 'batch',
  version: 'v1',
  kind: 'Job',
  namespace: 'ops',
  name: 'nightly',
};

/** The panel a job link opens reads the job's details. */
const serveJob = () =>
  servePanel(nightlyJob, objectDetailOf('job', { name: 'nightly', namespace: 'ops' }));

const inCluster = (identity: ObjectIdentity) => ({
  clusterId: dev.clusterId,
  clusterName: dev.clusterName,
  ...identity,
});

/**
 * Answers the namespace Workloads view's reads for `namespace` (any page or
 * anchor), as backend/refresh/snapshot/namespace_workloads.go does for an
 * empty namespace.
 */
const serveWorkloadsView = (namespace: string) => {
  app.snapshots.respond(({ domain, scope }: SnapshotRequest) => {
    if (domain !== 'namespace-workloads') {
      return undefined;
    }
    const { selector } = parseRefreshScope(domain, scope);
    if (selector.kind !== 'namespace' || selector.namespace !== namespace) {
      return undefined;
    }
    return snapshotResponse({
      domain,
      scope,
      version: 1,
      payload: makeNamespaceWorkloadSnapshotPayload({
        clusterId: dev.clusterId,
        clusterName: dev.clusterName,
      }),
      itemCount: 0,
    });
  });
};

// jsdom has no layout scrolling; the sidebar scrolls the selected namespace into view.
const nativeScrollIntoView = Element.prototype.scrollIntoView;
beforeEach(() => {
  Element.prototype.scrollIntoView = () => undefined;
});

afterEach(() => {
  Element.prototype.scrollIntoView = nativeScrollIntoView;
  gridTables.clear();
  vi.useRealTimers();
});

describe('JobsTab', () => {
  it("restores the table state saved for the panel's cluster and view", async () => {
    startCluster();
    const other = app.cluster({ name: 'dev', context: 'beta' });
    app.namespaces(other, ['default']);
    const storageKey = async (cluster: TestCluster) =>
      buildGridTableStorageKey({
        clusterHash: await computeClusterHash(cluster.clusterId),
        viewId: 'object-panel-jobs',
      }) ?? '';
    // backend/ui_state_store_persistence.go GetGridTablePersistence: saved
    // table states by storage key.
    const saved = {
      [await storageKey(dev)]: { version: 3, sort: { key: 'status', direction: 'desc' } },
      [await storageKey(other)]: { version: 3, sort: { key: 'age', direction: 'asc' } },
    };
    app.backend.answer('GetGridTablePersistence', () => saved as never);

    await openJobsTab([makeJob()]);

    expect(jobsTable().sortConfig).toEqual({ key: 'status', direction: 'desc' });
  });

  it('opens a job in a native panel window, which has no workspace navigation', async () => {
    startCluster();
    serveCronJob([makeJob({ name: 'nightly', namespace: 'ops' })]);
    serveJob();
    const panelRef = { clusterId: dev.clusterId, ...cronJob };
    app.panelWindow(dev, {
      tabs: [objectPanelTabSnapshot(objectPanelId(panelRef), panelRef, 'jobs')],
    });
    view = await app.render(null);

    const nameCell = requireReactElement<{ onClick: (event: { altKey: boolean }) => void }>(
      column('name').render(firstRow()),
      'expected an interactive Job name'
    );
    await activate(() => nameCell.props.onClick({ altKey: true }));

    expect(view.openPanels()).toContainEqual(inCluster(nightlyJob));
    expect(column('namespace').render(firstRow())).toBe('ops');
  });

  it('offers no custom metadata columns and leaves Download to the filtered rows', async () => {
    startCluster();
    await openJobsTab([makeJob({ name: 'job-a' }), makeJob({ name: 'job-b' })]);

    expect(jobsTable().customMetadataColumns).toBeUndefined();
    // Jobs are a local table: an all-rows fetcher would bypass its filters.
    expect(jobsTable().exportFilename).toBe('object-panel-jobs');
    expect(jobsTable().fetchAllRows).toBeUndefined();
  });

  it("keys job rows by complete identity in the panel's cluster", async () => {
    startCluster();
    await openJobsTab([makeJob({ name: 'nightly', namespace: 'ops' })]);

    expect(jobsTable().keyExtractor(firstRow(), 0)).toBe(
      `${dev.clusterId}|batch/v1/Job/ops/nightly`
    );
  });

  it('styles the status from the backend status presentation', async () => {
    startCluster();
    await openJobsTab([makeJob({ statusPresentation: 'error' })]);

    const cell = requireReactElement<{ className?: string }>(
      column('status').render(firstRow()),
      'expected a status cell'
    );
    expect(cell.props.className).toBe('status-text error');
  });

  it('sorts locally by every displayed job fact', async () => {
    startCluster();
    await openJobsTab([makeJob()]);

    const sortableKeys = jobsTable()
      .columns.filter((candidate) => candidate.sortable !== false)
      .map((candidate) => candidate.key)
      .sort((left: string, right: string) => left.localeCompare(right));
    expect(sortableKeys).toEqual(['age', 'completions', 'duration', 'name', 'namespace', 'status']);
  });

  it('renders Job age from the live age timestamp', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:10Z'));
    startCluster();
    await openJobsTab([
      makeJob({ age: 'stale', ageTimestamp: Date.parse('2026-01-01T00:00:00Z') }),
    ]);

    const cellContainer = document.createElement('div');
    document.body.appendChild(cellContainer);
    const cellRoot = ReactDOM.createRoot(cellContainer);
    try {
      act(() => {
        cellRoot.render(column('age').render(firstRow()));
      });
      expect(cellContainer.textContent).toBe('10s');

      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(cellContainer.textContent).toBe('11s');
    } finally {
      act(() => cellRoot.unmount());
      cellContainer.remove();
    }
  });

  it("navigates to a job and selects its namespace within the panel's cluster", async () => {
    startCluster();
    serveWorkloadsView('ops');
    await openJobsTab([makeJob({ name: 'nightly', namespace: 'ops' })]);

    const name = requireReactElement<{
      onClick: (event: {
        altKey: boolean;
        preventDefault: () => void;
        stopPropagation: () => void;
      }) => void;
    }>(column('name').render(firstRow()), 'expected the Job name link');
    await activate(() =>
      name.props.onClick({ altKey: true, preventDefault: vi.fn(), stopPropagation: vi.fn() })
    );

    const owners = view.owners();
    expect(owners.viewState?.viewType).toBe('namespace');
    expect(owners.viewState?.activeNamespaceTab).toBe('workloads');
    expect(owners.namespace.selectedNamespace).toBe('ops');
  });

  it('selects the job namespace from its namespace link', async () => {
    startCluster();
    serveWorkloadsView('ops');
    await openJobsTab([makeJob({ name: 'nightly', namespace: 'ops' })]);

    const namespace = requireReactElement<{ onClick: (event: { altKey: boolean }) => void }>(
      column('namespace').render(firstRow()),
      'expected the namespace link'
    );
    await activate(() => namespace.props.onClick({ altKey: false }));

    const owners = view.owners();
    expect(owners.viewState?.viewType).toBe('namespace');
    expect(owners.viewState?.activeNamespaceTab).toBe('workloads');
    expect(owners.namespace.selectedNamespace).toBe('ops');
  });

  it("opens the job's Map from its context menu", async () => {
    startCluster();
    const jobPanel = serveJob();
    const jobMapScope = requireValue(jobPanel.scopes.mapScope, 'expected the job map scope');
    // backend/refresh/snapshot/object_map.go: the job's map, seeded at the job.
    app.snapshots.serve('object-map', jobMapScope, {
      clusterId: dev.clusterId,
      clusterName: dev.clusterName,
      seed: { clusterId: dev.clusterId, ...nightlyJob },
      nodes: [],
      edges: [],
      maxNodes: 250,
      truncated: false,
    });
    await openJobsTab([makeJob({ name: 'nightly', namespace: 'ops' })]);

    const viewMap = requireValue(
      requireValue(jobsTable().getCustomContextMenuItems, 'expected a context menu')(
        firstRow(),
        'name'
      ).find((item) => item.actionId === OBJECT_ACTION_IDS.viewMap),
      'expected the View Map item'
    );
    await activate(() => viewMap.onClick?.());

    // The job's panel opens on its Map tab, which reads the job's map.
    expect(view.openPanels()).toContainEqual(inCluster(nightlyJob));
    expect(app.snapshots.reads('object-map').map((read) => read.scope)).toContain(jobMapScope);
    expect(document.querySelector('[data-testid="map-tab"]')).not.toBeNull();
  });
});
