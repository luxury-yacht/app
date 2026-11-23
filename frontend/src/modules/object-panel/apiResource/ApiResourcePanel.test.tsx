/**
 * frontend/src/modules/object-panel/apiResource/ApiResourcePanel.test.tsx
 *
 * An opened kind panel: Details shows what API discovery says about the kind,
 * read from the API Resources domain, and Explain shows the kind's schema as a
 * field tree with the selected field's `kubectl explain` description. Runs the
 * full app (the panel is hosted as the workspace window hosts it) over a faked
 * backend (test-utils/appState).
 */

import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { buildRefreshScope, CLUSTER_SELECTOR } from '@/core/refresh/scopeSelector';
import type { ClusterAPIResourceEntry } from '@/core/refresh/types';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { statusResponse } from '@/test-utils/appState/transport';
import { makeErrorStatus } from '@/test-utils/errorStatusFixtures';
import { requireValue } from '@/test-utils/requireValue';
import { panelTargetSnapshot } from '../panelTarget';

const app = installAppStateHarness();
let dev: TestCluster;
let view: MountedApp;
// Stops the kinds served at start, so a test can serve the cluster's next answer.
let stopServingKinds: () => void = () => undefined;

const deployments = (): ClusterAPIResourceEntry => ({
  clusterId: dev.clusterId,
  kind: 'Deployment',
  group: 'apps',
  version: 'v1',
  apiVersion: 'apps/v1',
  versions: ['v1', 'v1beta2'],
  resource: 'deployments',
  singular: 'deployment',
  scope: 'Namespaced',
  shortNames: ['deploy'],
  verbs: ['create', 'delete', 'get', 'list', 'patch', 'update', 'watch'],
  categories: ['all'],
  type: 'Built-in',
});

// The kind as Explain reads it: at the version the kind's row currently prefers.
const deploymentKind = (version = 'v1') => ({
  clusterId: dev.clusterId,
  group: 'apps',
  version,
  kind: 'Deployment',
  resource: 'deployments',
});

const deploymentSchema = {
  revision: 'original-revision',
  group: 'apps',
  version: 'v1',
  kind: 'Deployment',
  description: 'Deployment enables declarative updates for Pods and ReplicaSets.',
  fields: [
    { name: 'apiVersion', type: 'string' },
    {
      name: 'spec',
      type: 'DeploymentSpec',
      fields: [
        { name: 'replicas', type: 'integer' },
        { name: 'selector', type: 'LabelSelector', required: true },
        {
          name: 'strategy',
          type: 'DeploymentStrategy',
          fields: [{ name: 'type', type: 'string' }],
        },
      ],
    },
  ],
};

const start = async (...kindRows: Array<() => ClusterAPIResourceEntry>) => {
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['payments']);
  app.startScreen(dev);
  const rows = kindRows.length > 0 ? kindRows : [deployments];
  // The view's query and the opened kind panel's one-row query.
  stopServingKinds = app.serveTable(dev, 'cluster-api-resources', {
    rows: rows.map((row) => row()),
  });
  app.backend.answer('ExplainKindSchema', () => deploymentSchema);
  app.backend.answer('ExplainKindField', (_target, path) => ({
    path,
    type: path?.join('.') === 'spec.strategy' ? 'DeploymentStrategy' : 'string',
    description: `About ${path?.join(' > ')}.`,
  }));
  view = await app.mountApp();
  await view.goTo({ clusterView: 'api-resources' });
};

const click = async (element: HTMLElement) => {
  await act(async () => element.click());
  await app.settle();
};

/** The cluster signals that its kinds changed, and the app has acted on it. */
const ringKindsChanged = async (version: string) => {
  await act(async () => {
    app.streams.ring(
      'cluster-api-resources',
      buildRefreshScope('cluster-api-resources', {
        clusterId: dev.clusterId,
        selector: CLUSTER_SELECTOR,
      }),
      'catalog',
      version
    );
    // Signals apply after the stream's 150 ms coalescing window
    // (resourceStreamManager.ts UPDATE_COALESCE_MS).
    await new Promise((resolve) => setTimeout(resolve, 200));
  });
  await app.settle();
};

/** Whether a read is the deployments panel's read of its one row. */
const isDeploymentsRead = (read: { domain: string; scope: string }) =>
  read.domain === 'cluster-api-resources' &&
  new URLSearchParams(read.scope.split('?')[1]).get('predicate.resource') === 'deployments.apps';

const deploymentsReads = () => app.snapshots.reads().filter(isDeploymentsRead).length;

/** From here the cluster answers the deployments panel's read with `answer`. */
const answerDeploymentsRead = (answer: () => Response | Promise<Response>) =>
  app.snapshots.respond((request) => (isDeploymentsRead(request) ? answer() : undefined));

const discoveryUnavailable = () =>
  statusResponse(makeErrorStatus('InternalError', 'discovery is unavailable'));

const statefulSets = (): ClusterAPIResourceEntry => ({
  ...deployments(),
  kind: 'StatefulSet',
  resource: 'statefulsets',
  singular: 'statefulset',
  shortNames: ['sts'],
});

const frontDockTab = async (resource: string) => {
  await click(
    requireValue(
      Array.from(
        document.body.querySelectorAll<HTMLElement>('.dockable-tab-bar [role="tab"]')
      ).find((candidate) => candidate.textContent?.includes(resource)),
      `expected the ${resource} panel tab`
    )
  );
};

const openKindPanel = async (resource = 'deployments') => {
  await click(
    requireValue(
      Array.from(view.container.querySelectorAll<HTMLButtonElement>('.gridtable-row button')).find(
        (button) => button.textContent === resource
      ),
      `expected the ${resource} name link`
    )
  );
};

const panel = () =>
  requireValue(
    document.body.querySelector<HTMLElement>('.object-panel-body'),
    'expected the kind panel'
  );

const tab = (label: string) =>
  requireValue(
    Array.from(panel().querySelectorAll<HTMLElement>('[role="tab"]')).find(
      (candidate) => candidate.textContent?.trim().toLowerCase() === label.toLowerCase()
    ),
    `expected the ${label} tab`
  );

/** The panel's notice that the details it shows may be out of date. */
const staleNotice = () => document.body.querySelector<HTMLElement>('.object-panel-dockable output');

// A field is addressed by its name under each ancestor, one segment per level.
const field = (...segments: string[]) =>
  requireValue(
    Array.from(panel().querySelectorAll<HTMLButtonElement>('button[data-explain-path]')).find(
      (button) => button.dataset.explainPath === JSON.stringify(segments)
    ),
    `expected the ${segments.join(' > ')} field`
  );

const fieldPaths = () =>
  Array.from(panel().querySelectorAll<HTMLButtonElement>('button[data-explain-path]')).map(
    (button) => (JSON.parse(button.dataset.explainPath ?? '[]') as string[]).join(' > ')
  );

describe('ApiResourcePanel', () => {
  it('shows what discovery reports about the kind and offers only Details and Explain', async () => {
    await start();
    await openKindPanel();

    const text = panel().textContent ?? '';
    for (const fact of ['Namespaced', 'apps', 'v1, v1beta2', 'deployments', 'deploy', 'all']) {
      expect(text).toContain(fact);
    }
    expect(text).toContain('create, delete, get, list, patch, update, watch');
    expect(
      Array.from(panel().querySelectorAll('[role="tab"]')).map((candidate) =>
        candidate.textContent?.trim().toLowerCase()
      )
    ).toEqual(['details', 'explain']);
  });

  it('explains the kind as a field tree and describes the field the user selects', async () => {
    await start();
    await openKindPanel();

    await click(tab('Explain'));

    expect(app.backend.calls('ExplainKindSchema')).toEqual([[deploymentKind()]]);
    expect(panel().textContent).toContain('apps/v1');
    // Top-level fields are listed; nested fields appear when their parent opens.
    expect(fieldPaths()).toEqual(['apiVersion', 'spec']);
    expect(panel().textContent).toContain(
      'Deployment enables declarative updates for Pods and ReplicaSets.'
    );

    await click(field('spec'));
    expect(fieldPaths()).toEqual([
      'apiVersion',
      'spec',
      'spec > replicas',
      'spec > selector',
      'spec > strategy',
    ]);
    expect(field('spec').getAttribute('aria-expanded')).toBe('true');

    await click(field('spec', 'strategy'));
    const fieldReads = app.backend.calls('ExplainKindField');
    expect(fieldReads[fieldReads.length - 1]).toEqual([
      deploymentKind(),
      ['spec', 'strategy'],
      deploymentSchema.revision,
    ]);
    expect(field('spec', 'strategy').getAttribute('aria-current')).toBe('true');
    expect(panel().textContent).toContain('About spec > strategy.');

    // Selecting an open field again closes it and keeps it selected.
    await click(field('spec'));
    expect(fieldPaths()).toEqual(['apiVersion', 'spec']);
  });

  it('does not ask the cluster again for a field it has already explained', async () => {
    await start();
    await openKindPanel();
    await click(tab('Explain'));
    await click(field('spec'));

    await click(field('spec', 'replicas'));
    await click(field('spec', 'selector'));
    await click(field('spec', 'replicas'));

    expect(app.backend.calls('ExplainKindField').map(([, path]) => path)).toEqual([
      ['spec'],
      ['spec', 'replicas'],
      ['spec', 'selector'],
    ]);
  });

  it('replaces the tree and field descriptions when the served schema changes in place', async () => {
    await start();
    await openKindPanel();
    await click(tab('Explain'));
    await click(field('apiVersion'));
    expect(panel().textContent).toContain('About apiVersion.');

    app.backend.answer('ExplainKindSchema', () => ({
      ...deploymentSchema,
      revision: 'updated-revision',
      fields: [
        { name: 'apiVersion', type: 'string' },
        { name: 'status', type: 'object' },
      ],
    }));
    app.backend.answer('ExplainKindField', (_target, path, revision) => {
      if (revision === deploymentSchema.revision) {
        const message = 'The OpenAPI document changed';
        throw Object.assign(new Error(message), { cause: makeErrorStatus('Conflict', message) });
      }
      return { path, description: 'New schema description.' };
    });
    await click(field('spec'));

    expect(fieldPaths()).toEqual(['apiVersion', 'status']);
    expect(panel().querySelector('[role="alert"]')).toBeNull();
    await click(field('apiVersion'));
    expect(panel().textContent).toContain('New schema description.');
  });

  it('says so when the cluster publishes no schema for the kind', async () => {
    await start();
    const missing = 'the cluster publishes no schema for apps/v1';
    app.backend.answer('ExplainKindSchema', () => {
      throw Object.assign(new Error(missing), { cause: makeErrorStatus('NotFound', missing) });
    });
    await openKindPanel();

    await click(tab('Explain'));

    expect(panel().querySelector('[role="alert"]')).toBeNull();
    expect(panel().textContent).toContain('No schema is published for this kind');
    expect(fieldPaths()).toEqual([]);
  });

  it('reports a failure to read the schema as an error', async () => {
    await start();
    app.backend.answer('ExplainKindSchema', () => {
      throw Object.assign(new Error('boom'), { cause: makeErrorStatus('InternalError', 'boom') });
    });
    await openKindPanel();

    await click(tab('Explain'));

    expect(panel().querySelector('[role="alert"]')?.textContent).toContain('boom');
    const reports = app.errors.take((record) => record.kinds.includes('inline'));
    expect(reports.map((record) => record.context)).toEqual([
      { action: 'loadKindSchema', source: 'ExplainTab', clusterId: dev.clusterId },
    ]);
  });

  it.each(['NotFound', 'InternalError'] as const)(
    'retries the schema in the open Explain tab after %s',
    async (reason) => {
      await start();
      app.backend.answer('ExplainKindSchema', () => {
        throw Object.assign(new Error('schema unavailable'), {
          cause: makeErrorStatus(reason, 'schema unavailable'),
        });
      });
      await openKindPanel();
      await click(tab('Explain'));
      expect(fieldPaths()).toEqual([]);
      expect(app.errors.take((record) => record.context?.action === 'loadKindSchema')).toHaveLength(
        reason === 'InternalError' ? 1 : 0
      );

      app.backend.answer('ExplainKindSchema', () => deploymentSchema);
      const retry = Array.from(panel().querySelectorAll('button')).find(
        (button) => button.textContent?.trim() === 'Retry'
      );
      await click(requireValue(retry, 'expected the schema retry control'));

      expect(app.backend.calls('ExplainKindSchema')).toEqual([
        [deploymentKind()],
        [deploymentKind()],
      ]);
      expect(fieldPaths()).toContain('spec');
    }
  );

  it('keeps the Explain view when the panel moves to another window', async () => {
    await start();
    await openKindPanel();
    await click(tab('Explain'));

    const [target] = Array.from(view.owners().objectPanels.openPanels.entries());
    const [panelId, ref] = requireValue(target, 'expected the open kind panel');
    const owned = requireValue(
      view.owners().objectPanels.getOwnedPanel(dev.clusterId, panelId),
      'expected the owned kind panel'
    );

    expect(panelTargetSnapshot(panelId, ref, owned.activeView)).toEqual({
      kind: 'api-resource',
      panelId,
      activeView: 'explain',
      // The reference names the kind, not a version of it.
      apiResourceRef: {
        clusterId: dev.clusterId,
        group: 'apps',
        kind: 'Deployment',
        resource: 'deployments',
      },
    });
  });

  // A schema may name a property with a dot. That field and a nested path that
  // spells the same are different fields: each is selected and explained on
  // its own.
  it('tells a field whose name contains a dot from a nested field', async () => {
    await start();
    app.backend.answer('ExplainKindSchema', () => ({
      ...deploymentSchema,
      fields: [
        { name: 'a.b', type: 'string' },
        { name: 'a', type: 'Object', fields: [{ name: 'b', type: 'string' }] },
      ],
    }));
    await openKindPanel();
    await click(tab('Explain'));

    await click(field('a.b'));
    expect(field('a.b').getAttribute('aria-current')).toBe('true');
    expect(panel().textContent).toContain('About a.b.');

    await click(field('a'));
    await click(field('a', 'b'));
    expect(field('a', 'b').getAttribute('aria-current')).toBe('true');
    expect(field('a.b').getAttribute('aria-current')).toBeNull();
    expect(panel().textContent).toContain('About a > b.');
    expect(app.backend.calls('ExplainKindField').map(([, path]) => path)).toEqual([
      ['a.b'],
      ['a'],
      ['a', 'b'],
    ]);
  });

  // The panel belongs to the kind, not to one version of it: its reference
  // names no version, and Explain reads the version the kind's row prefers.
  it('explains the version the kind currently prefers', async () => {
    await start(() => ({
      ...deployments(),
      version: 'v2',
      apiVersion: 'apps/v2',
      versions: ['v2', 'v1'],
    }));
    await openKindPanel();

    await click(tab('Explain'));

    expect(app.backend.calls('ExplainKindSchema')).toEqual([[deploymentKind('v2')]]);
    expect(view.openPanels()).toEqual([
      {
        targetType: 'api-resource',
        clusterId: dev.clusterId,
        group: 'apps',
        kind: 'Deployment',
        resource: 'deployments',
      },
    ]);
  });

  // Panels share a dock group as tabs, and only the front one reads its data.
  // Bringing the kind panel back to the front must show Explain as it was left:
  // the same fields open, the same field selected, and no second schema read.
  it('keeps the Explain tree while another panel is in front', async () => {
    await start(deployments, statefulSets);
    await openKindPanel();
    await click(tab('Explain'));
    await click(field('spec'));
    await click(field('spec', 'strategy'));

    // The second kind panel joins the group and takes the front.
    await openKindPanel('statefulsets');
    await frontDockTab('deployments');

    expect(field('spec').getAttribute('aria-expanded')).toBe('true');
    expect(field('spec', 'strategy').getAttribute('aria-current')).toBe('true');
    expect(
      app.backend.calls('ExplainKindSchema').filter(([target]) => target.resource === 'deployments')
    ).toHaveLength(1);
  });

  // Coming back to the front, the panel reads its kind again. If that read
  // fails the cluster has not said the kind is gone, so what the panel showed
  // stays: Explain keeps its open fields rather than turning into an error.
  it('keeps the Explain tree when the read on returning to the front fails', async () => {
    await start(deployments, statefulSets);
    await openKindPanel();
    await click(tab('Explain'));
    await click(field('spec'));
    await openKindPanel('statefulsets');

    answerDeploymentsRead(discoveryUnavailable);
    await frontDockTab('deployments');

    expect(field('spec').getAttribute('aria-expanded')).toBe('true');
    expect(panel().querySelector('[role="alert"]')).toBeNull();

    // The cluster signals a change and the panel reads again, which also fails.
    const readsBeforeSignal = deploymentsReads();
    await ringKindsChanged('v2');
    expect(deploymentsReads()).toBeGreaterThan(readsBeforeSignal);
    expect(field('spec').getAttribute('aria-expanded')).toBe('true');
    expect(panel().querySelector('[role="alert"]')).toBeNull();
    // The failed reads are still reported, as toasts.
    expect(app.errors.take((record) => record.kinds.includes('toast')).length).toBeGreaterThan(0);

    // The cluster answers again: the same tree is still there, read once.
    app.snapshots.respond(null);
    await ringKindsChanged('v3');
    expect(field('spec').getAttribute('aria-expanded')).toBe('true');
    expect(
      app.backend.calls('ExplainKindSchema').filter(([kind]) => kind.resource === 'deployments')
    ).toHaveLength(1);
  });

  // The kind can be removed while its panel sits behind another one. Back in
  // front, the cluster's answer is that it has no such kind, and the panel
  // says so rather than showing what it last read.
  it('says so when the kind was removed while another panel was in front', async () => {
    await start(deployments, statefulSets);
    await openKindPanel();
    await click(tab('Explain'));
    await click(field('spec'));
    await openKindPanel('statefulsets');

    stopServingKinds();
    app.serveTable(dev, 'cluster-api-resources', { rows: [] });
    await frontDockTab('deployments');

    expect(panel().textContent).toContain('no longer serves this kind');
    expect(panel().querySelector('button[data-explain-path]')).toBeNull();
  });

  // Discovery can fail to read an API group (an aggregated API that is down),
  // or fail outright. A kind in that group then has no row, which is not the
  // cluster saying the kind is gone: the panel says what it could not read,
  // and shows the kind again when discovery recovers.
  it.each([
    ['could not read the kind’s group', { unreadGroups: ['apps'] }],
    ['failed outright', { discoveryFailed: true }],
  ])('does not call the kind gone when discovery %s', async (_case, discovery) => {
    await start();
    stopServingKinds();
    stopServingKinds = app.serveTable(dev, 'cluster-api-resources', { rows: [], ...discovery });
    await openKindPanel();

    expect(panel().textContent).not.toContain('no longer serves this kind');
    expect(panel().textContent).toContain('could not be read');

    stopServingKinds();
    app.serveTable(dev, 'cluster-api-resources', { rows: [deployments()] });
    await ringKindsChanged('v2');
    expect(panel().textContent).toContain('Namespaced');
  });

  // The core group has no name: discovery reports it as "", and a core kind's
  // panel must recognise its own group in that.
  it('does not call a core kind gone when discovery could not read the core group', async () => {
    await start(() => ({
      ...deployments(),
      kind: 'Pod',
      group: '',
      apiVersion: 'v1',
      resource: 'pods',
      singular: 'pod',
      shortNames: ['po'],
    }));
    stopServingKinds();
    app.serveTable(dev, 'cluster-api-resources', { rows: [], unreadGroups: [''] });
    await openKindPanel('pods');

    expect(panel().textContent).not.toContain('no longer serves this kind');
    expect(panel().textContent).toContain('could not be read');
  });

  // An unread group in another part of the API says nothing about this kind:
  // discovery read the kind's own group and found no such kind.
  it('calls the kind gone when discovery read its group but not another', async () => {
    await start();
    stopServingKinds();
    app.serveTable(dev, 'cluster-api-resources', { rows: [], unreadGroups: ['metrics.k8s.io'] });
    await openKindPanel();

    expect(panel().textContent).toContain('no longer serves this kind');
  });

  // The panel keeps what it was showing while the kind's group is unreadable.
  it('keeps the Explain tree while discovery cannot read the kind’s group', async () => {
    await start();
    await openKindPanel();
    await click(tab('Explain'));
    await click(field('spec'));

    expect(staleNotice()).toBeNull();

    stopServingKinds();
    stopServingKinds = app.serveTable(dev, 'cluster-api-resources', {
      rows: [],
      unreadGroups: ['apps'],
    });
    await ringKindsChanged('v2');

    expect(field('spec').getAttribute('aria-expanded')).toBe('true');
    // What is shown was read before the group became unreadable: say so.
    expect(staleNotice()).not.toBeNull();

    stopServingKinds();
    app.serveTable(dev, 'cluster-api-resources', { rows: [deployments()] });
    await ringKindsChanged('v3');
    expect(staleNotice()).toBeNull();
  });

  // Discovery keeps the last kinds of a group it can no longer read, so the
  // cluster can still answer with the kind's row. Those details may be out of
  // date, on either tab, and the panel says so while showing them.
  it.each([
    ['could not read the kind’s group', { unreadGroups: ['apps'] }],
    ['failed outright', { discoveryFailed: true }],
  ])(
    'marks the kind’s details as possibly out of date when discovery %s',
    async (_case, discovery) => {
      await start();
      stopServingKinds();
      app.serveTable(dev, 'cluster-api-resources', { rows: [deployments()], ...discovery });
      await openKindPanel();

      expect(panel().textContent).toContain('Namespaced');
      expect(staleNotice()).not.toBeNull();
      await click(tab('Explain'));
      expect(staleNotice()).not.toBeNull();
    }
  );

  // Coming back to the front, the panel reads its kind again. Until that read
  // answers, what it shows is still the possibly out-of-date row, so the
  // notice stays rather than dropping out and pushing the content back down.
  it('keeps the out-of-date notice while a panel brought back to the front reads again', async () => {
    const pods = (): ClusterAPIResourceEntry => ({
      ...deployments(),
      kind: 'Pod',
      group: '',
      apiVersion: 'v1',
      resource: 'pods',
      singular: 'pod',
      shortNames: ['po'],
    });
    await start(deployments, pods);
    stopServingKinds();
    app.serveTable(dev, 'cluster-api-resources', {
      rows: [deployments(), pods()],
      unreadGroups: ['apps'],
    });
    await openKindPanel();
    expect(staleNotice()).not.toBeNull();
    await openKindPanel('pods');

    answerDeploymentsRead(() => new Promise<Response>(() => undefined));
    await frontDockTab('deployments');

    expect(staleNotice()).not.toBeNull();
  });

  // A panel whose first read failed has nothing to show. While its next read
  // is out the cluster has not answered, so the panel must not claim the kind
  // is gone.
  it('does not call the kind gone while a read after a failed one is still out', async () => {
    await start();
    answerDeploymentsRead(discoveryUnavailable);
    await openKindPanel();
    expect(panel().querySelector('[role="alert"]')?.textContent).toContain(
      'discovery is unavailable'
    );
    // The failed read is reported in the panel and as a toast.
    expect(app.errors.take(() => true).length).toBeGreaterThan(0);

    answerDeploymentsRead(() => new Promise<Response>(() => undefined));
    await ringKindsChanged('v2');

    expect(panel().textContent).not.toContain('no longer serves this kind');
    expect(panel().textContent).toContain('Loading kind details');
  });

  // A kind can stop being served while its panel is open (its
  // CustomResourceDefinition or API service is removed). The panel then says
  // so instead of explaining a kind the cluster no longer has.
  it('says so when the cluster stops serving the kind', async () => {
    await start();
    await openKindPanel();
    await click(tab('Explain'));
    await click(field('spec'));

    stopServingKinds();
    app.serveTable(dev, 'cluster-api-resources', { rows: [] });
    await ringKindsChanged('v2');

    expect(panel().textContent).toContain('no longer serves this kind');
    expect(panel().querySelector('button[data-explain-path]')).toBeNull();
  });

  // The cluster can start preferring another version of a kind while its panel
  // is open (an upgrade, or a CustomResourceDefinition change). The panel
  // follows it, and it is still the one panel for that kind.
  it('follows the kind when the cluster starts preferring another version', async () => {
    await start();
    await openKindPanel();
    await click(tab('Explain'));
    expect(app.backend.calls('ExplainKindSchema')).toEqual([[deploymentKind('v1')]]);

    stopServingKinds();
    app.serveTable(dev, 'cluster-api-resources', {
      rows: [{ ...deployments(), version: 'v2', apiVersion: 'apps/v2', versions: ['v2', 'v1'] }],
    });
    await ringKindsChanged('v2');

    const schemaReads = app.backend.calls('ExplainKindSchema');
    expect(schemaReads[schemaReads.length - 1]).toEqual([deploymentKind('v2')]);

    await openKindPanel();
    expect(view.openPanels()).toHaveLength(1);
  });
});
