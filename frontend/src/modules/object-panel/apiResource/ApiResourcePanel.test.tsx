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
import type { ClusterAPIResourceEntry } from '@/core/refresh/types';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { makeErrorStatus } from '@/test-utils/errorStatusFixtures';
import { requireValue } from '@/test-utils/requireValue';
import { panelTargetSnapshot } from '../panelTarget';

const app = installAppStateHarness();
let dev: TestCluster;
let view: MountedApp;

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

const deploymentKind = () => ({
  clusterId: dev.clusterId,
  group: 'apps',
  version: 'v1',
  kind: 'Deployment',
  resource: 'deployments',
});

const deploymentSchema = {
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

const start = async () => {
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['payments']);
  app.startScreen(dev);
  // The view's query and the opened kind panel's one-row query.
  app.serveTable(dev, 'cluster-api-resources', { rows: [deployments()] });
  app.backend.answer('ExplainKindSchema', () => deploymentSchema);
  app.backend.answer('ExplainKindField', (_target, path) => ({
    path,
    type: path === 'spec.strategy' ? 'DeploymentStrategy' : 'string',
    description: `About ${path}.`,
  }));
  view = await app.mountApp();
  await view.goTo({ clusterView: 'api-resources' });
};

const click = async (element: HTMLElement) => {
  await act(async () => element.click());
  await app.settle();
};

const openKindPanel = async () => {
  const row = requireValue(
    Array.from(view.container.querySelectorAll<HTMLElement>('.gridtable-row')).find((candidate) =>
      candidate.textContent?.includes('deployments')
    ),
    'expected the deployments row'
  );
  await click(
    requireValue(
      Array.from(row.querySelectorAll<HTMLButtonElement>('button')).find(
        (button) => button.textContent === 'deployments'
      ),
      'expected the deployments name link'
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

const field = (name: string) =>
  requireValue(
    Array.from(panel().querySelectorAll<HTMLButtonElement>('button[data-explain-field]')).find(
      (button) => button.dataset.explainField === name
    ),
    `expected the ${name} field`
  );

const fieldPaths = () =>
  Array.from(panel().querySelectorAll<HTMLButtonElement>('button[data-explain-field]')).map(
    (button) => button.dataset.explainField
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
    // Top-level fields are listed; nested fields appear when their parent opens.
    expect(fieldPaths()).toEqual(['apiVersion', 'spec']);
    expect(panel().textContent).toContain(
      'Deployment enables declarative updates for Pods and ReplicaSets.'
    );

    await click(field('spec'));
    expect(fieldPaths()).toEqual([
      'apiVersion',
      'spec',
      'spec.replicas',
      'spec.selector',
      'spec.strategy',
    ]);
    expect(field('spec').getAttribute('aria-expanded')).toBe('true');

    await click(field('spec.strategy'));
    const fieldReads = app.backend.calls('ExplainKindField');
    expect(fieldReads[fieldReads.length - 1]).toEqual([deploymentKind(), 'spec.strategy']);
    expect(field('spec.strategy').getAttribute('aria-current')).toBe('true');
    expect(panel().textContent).toContain('About spec.strategy.');

    // Selecting an open field again closes it and keeps it selected.
    await click(field('spec'));
    expect(fieldPaths()).toEqual(['apiVersion', 'spec']);
  });

  it('does not ask the cluster again for a field it has already explained', async () => {
    await start();
    await openKindPanel();
    await click(tab('Explain'));
    await click(field('spec'));

    await click(field('spec.replicas'));
    await click(field('spec.selector'));
    await click(field('spec.replicas'));

    expect(app.backend.calls('ExplainKindField').map(([, path]) => path)).toEqual([
      'spec',
      'spec.replicas',
      'spec.selector',
    ]);
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
      apiResourceRef: deploymentKind(),
    });
  });
});
