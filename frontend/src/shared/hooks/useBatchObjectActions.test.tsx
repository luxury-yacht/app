/**
 * frontend/src/shared/hooks/useBatchObjectActions.test.tsx
 *
 * Running one action over the rows picked in batch-select mode, on the real
 * GridTable and the real permission store over a faked backend: each action
 * counts only the rows it can act on, every object goes to the backend with
 * its complete identity, and a partial failure keeps exactly the failed rows
 * selected so they can be retried.
 */

import { OBJECT_ACTIONS } from '@shared/actions/objectActionContract';
import type { ObjectActionData } from '@shared/actions/objectActionPolicy';
import GridTable from '@shared/components/tables/GridTable';
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { installAppStateHarness, type MountedApp } from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';
import { type BatchObjectActionId, useBatchObjectActions } from './useBatchObjectActions';

const app = installAppStateHarness();
const getObject = (row: ObjectActionData) => row;
const keyOf = (row: ObjectActionData) =>
  [row.clusterId, row.namespace, row.kind, row.name].join('|');

function BatchTable({
  rows,
  scopeKey = 'scope-a',
  allowedActions,
  rowKey = keyOf,
}: Readonly<{
  rows: ObjectActionData[];
  scopeKey?: string;
  allowedActions?: readonly BatchObjectActionId[];
  rowKey?: (row: ObjectActionData) => string;
}>) {
  const batch = useBatchObjectActions<ObjectActionData>({ getObject, scopeKey, allowedActions });
  return (
    <>
      <GridTable<ObjectActionData>
        data={rows}
        columns={[{ key: 'name', header: 'Name', render: (row) => row.name }]}
        keyExtractor={rowKey}
        filters={{ enabled: true }}
        virtualization={{ enabled: false }}
        batchSelection={batch.batchSelection}
      />
      {batch.modals}
    </>
  );
}

const devCluster = () => {
  const cluster = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(cluster, ['team-a', 'team-b', 'locked']);
  app.startScreen(cluster);
  return cluster;
};

const makeRow = (
  clusterId: string,
  kind: string,
  group: string,
  name: string,
  extra: Partial<ObjectActionData> = {}
): ObjectActionData => ({
  clusterId,
  kind,
  group,
  version: 'v1',
  name,
  namespace: 'team-a',
  uid: `uid-${name}`,
  ...extra,
});

let view: MountedApp;

const mount = async (ui: React.ReactElement) => {
  view = await app.render(ui);
  await app.settle();
};

const click = async (element: Element) => {
  await act(async () => {
    (element as HTMLElement).click();
  });
  await app.settle();
};

const toolbarButton = (label: string) =>
  view.container.querySelector<HTMLButtonElement>(`.icon-bar-button[aria-label="${label}"]`);
const requireToolbarButton = (label: string) =>
  requireValue(toolbarButton(label), `toolbar button ${label}`);
const batchLabels = () =>
  Array.from(view.container.querySelectorAll('.gridtable-batch-action-label')).map(
    (label) => label.textContent
  );
const batchAction = (label: string) =>
  requireValue(
    Array.from(view.container.querySelectorAll<HTMLButtonElement>('.gridtable-batch-action')).find(
      (button) => button.querySelector('.gridtable-batch-action-label')?.textContent === label
    ),
    `batch action ${label}`
  );

const selectAllRows = async () => {
  await click(requireToolbarButton('Batch select'));
  await click(
    requireValue(view.container.querySelector('thead input[type="checkbox"]'), 'header checkbox')
  );
};

const modal = () => document.body.querySelector<HTMLElement>('.confirmation-modal');
const modalTitle = () => document.body.querySelector('#confirmation-modal-title')?.textContent;
const modalButton = (name: string) =>
  requireValue(
    Array.from(
      requireValue(modal(), 'confirmation modal').querySelectorAll<HTMLButtonElement>(
        '.confirmation-modal-footer button'
      )
    ).find((button) => button.textContent === name),
    `modal button ${name}`
  );
const selectedRowNames = () =>
  Array.from(view.container.querySelectorAll<HTMLElement>('.gridtable-row'))
    .filter((row) => row.dataset.rowSelected === 'true')
    .map((row) => row.textContent?.trim());
const actionCalls = () => app.backend.calls('RunObjectAction').map(([request]) => request);

describe('useBatchObjectActions', () => {
  it('counts each action by the rows it can act on', async () => {
    const { clusterId } = devCluster();
    await mount(
      <BatchTable
        rows={[
          makeRow(clusterId, 'Deployment', 'apps', 'manual', { hpaManaged: false }),
          makeRow(clusterId, 'Deployment', 'apps', 'autoscaled', { hpaManaged: true }),
          makeRow(clusterId, 'DaemonSet', 'apps', 'agent', { hpaManaged: false }),
          makeRow(clusterId, 'CronJob', 'batch', 'active-job', { status: 'Active' }),
          makeRow(clusterId, 'CronJob', 'batch', 'paused-job', { status: 'Suspended' }),
        ]}
      />
    );

    await selectAllRows();

    expect(batchLabels()).toEqual([
      'Restart 3 of 5',
      'Scale 1 of 5',
      'Suspend 1 of 5',
      'Resume 1 of 5',
      'Delete 5',
    ]);
  });

  it('leaves out rows the user has no permission to act on', async () => {
    const { clusterId } = devCluster();
    app.permissions((query) => !(query.verb === 'delete' && query.namespace === 'locked'));
    await mount(
      <BatchTable
        rows={[
          makeRow(clusterId, 'Pod', '', 'open'),
          makeRow(clusterId, 'Pod', '', 'guarded', { namespace: 'locked' }),
        ]}
      />
    );

    await selectAllRows();

    expect(batchLabels()).toEqual(['Delete 1 of 2']);
  });

  it('offers only the actions the view allows', async () => {
    const { clusterId } = devCluster();
    await mount(
      <BatchTable
        allowedActions={['cordon', 'uncordon']}
        rows={[
          makeRow(clusterId, 'Node', '', 'node-a', { namespace: '' }),
          makeRow(clusterId, 'Node', '', 'node-b', { namespace: '', unschedulable: true }),
        ]}
      />
    );

    await selectAllRows();

    expect(batchLabels()).toEqual(['Cordon 1 of 2', 'Uncordon 1 of 2']);
  });

  it('sends every object with its complete identity, then leaves the mode', async () => {
    const { clusterId } = devCluster();
    app.backend.answer('RunObjectAction', () => ({}));
    await mount(
      <BatchTable rows={[makeRow(clusterId, 'Pod', '', 'a'), makeRow(clusterId, 'Pod', '', 'b')]} />
    );
    await selectAllRows();

    await click(batchAction('Delete 2'));
    expect(modalTitle()).toBe('Delete 2 Pods');
    expect(modal()?.textContent).toContain('team-a');

    await click(modalButton('Delete 2'));

    expect(actionCalls()).toEqual(
      ['a', 'b'].map((name) => ({
        action: OBJECT_ACTIONS.delete,
        target: {
          clusterId,
          group: '',
          version: 'v1',
          kind: 'Pod',
          namespace: 'team-a',
          name,
          uid: `uid-${name}`,
        },
      }))
    );
    expect(modal()).toBeNull();
    expect(view.container.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    expect(toolbarButton('Batch select')).not.toBeNull();
  });

  it('stamps a restart once, so retrying a lost response is not a second rollout', async () => {
    const { clusterId } = devCluster();
    let failing = true;
    app.backend.answer('RunObjectAction', () => {
      if (failing) {
        throw new Error('connection reset');
      }
      return {};
    });
    await mount(
      <BatchTable
        allowedActions={['restart']}
        rows={[makeRow(clusterId, 'Deployment', 'apps', 'a', { hpaManaged: false })]}
      />
    );
    await selectAllRows();
    await click(batchAction('Restart 1'));
    await click(modalButton('Restart 1'));

    failing = false;
    await click(modalButton('Retry 1'));

    const [first, retry] = actionCalls();
    expect(first.target).toEqual(expect.objectContaining({ name: 'a', uid: 'uid-a' }));
    expect(first.restartedAt).toEqual(expect.any(String));
    expect(retry.restartedAt).toBe(first.restartedAt);
  });

  it('deletes a custom kind that shares a built-in name as itself', async () => {
    const { clusterId } = devCluster();
    app.backend.answer('RunObjectAction', () => ({}));
    await mount(<BatchTable rows={[makeRow(clusterId, 'Pod', 'custom.example.com', 'a')]} />);
    await selectAllRows();

    await click(batchAction('Delete 1'));
    await click(modalButton('Delete 1'));

    expect(actionCalls()).toEqual([
      expect.objectContaining({
        target: expect.objectContaining({ group: 'custom.example.com', kind: 'Pod', name: 'a' }),
      }),
    ]);
  });

  it('leaves a row with no UID out of its actions, since a write could not be tied to that object', async () => {
    const { clusterId } = devCluster();
    await mount(
      <BatchTable
        rows={[makeRow(clusterId, 'Pod', '', 'a'), makeRow(clusterId, 'Pod', '', 'b', { uid: '' })]}
      />
    );
    await selectAllRows();

    expect(batchLabels()).toEqual(['Delete 1 of 2']);
  });

  it('keeps only the failed rows selected and retries just those', async () => {
    const { clusterId } = devCluster();
    let blocked = true;
    app.backend.answer('RunObjectAction', (request) => {
      if (blocked && (request as { target: { name: string } }).target.name === 'b') {
        throw new Error('denied by admission webhook');
      }
      return {};
    });
    await mount(
      <BatchTable rows={[makeRow(clusterId, 'Pod', '', 'a'), makeRow(clusterId, 'Pod', '', 'b')]} />
    );
    await selectAllRows();
    await click(batchAction('Delete 2'));
    await click(modalButton('Delete 2'));

    expect(modalTitle()).toBe('Deleted 1 of 2 Pods');
    expect(modal()?.textContent).toContain('denied by admission webhook');
    expect(selectedRowNames()).toEqual(['b']);

    blocked = false;
    const callsBeforeRetry = actionCalls().length;
    await click(modalButton('Retry 1'));

    expect(actionCalls().slice(callsBeforeRetry)).toEqual([
      expect.objectContaining({ target: expect.objectContaining({ name: 'b', uid: 'uid-b' }) }),
    ]);
    expect(modal()).toBeNull();
    expect(toolbarButton('Batch select')).not.toBeNull();
  });

  it('asks for one replica count, confirms, and scales every eligible workload', async () => {
    const { clusterId } = devCluster();
    app.backend.answer('RunObjectAction', () => ({}));
    await mount(
      <BatchTable
        rows={[
          makeRow(clusterId, 'Deployment', 'apps', 'a', { hpaManaged: false }),
          makeRow(clusterId, 'Deployment', 'apps', 'b', { hpaManaged: false }),
        ]}
      />
    );
    await selectAllRows();

    await click(batchAction('Scale 2'));
    const input = requireValue(
      document.body.querySelector<HTMLInputElement>('.scale-input'),
      'replica input'
    );
    await act(async () => {
      const setValue = requireValue(
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set,
        'value setter'
      );
      setValue.call(input, '3');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(
      requireValue(
        Array.from(
          document.body.querySelectorAll<HTMLButtonElement>('.scale-modal-footer button')
        ).find((button) => button.textContent === 'Scale'),
        'Scale button'
      )
    );

    expect(actionCalls()).toEqual([]);
    expect(modalTitle()).toBe('Scale 2 Deployments');
    await click(modalButton('Scale 2'));

    expect(actionCalls()).toEqual(
      ['a', 'b'].map((name) =>
        expect.objectContaining({
          action: OBJECT_ACTIONS.scale,
          replicas: 3,
          target: expect.objectContaining({
            name,
            kind: 'Deployment',
            group: 'apps',
            uid: `uid-${name}`,
          }),
        })
      )
    );
  });

  it('cannot run twice while a batch is in flight', async () => {
    const { clusterId } = devCluster();
    app.backend.answer('RunObjectAction', () => ({}));
    const release = app.backend.hold('RunObjectAction');
    await mount(
      <BatchTable rows={[makeRow(clusterId, 'Pod', '', 'a'), makeRow(clusterId, 'Pod', '', 'b')]} />
    );
    await selectAllRows();
    await click(batchAction('Delete 2'));

    const confirm = modalButton('Delete 2');
    await click(confirm);
    expect(modalButton('Delete 2').disabled).toBe(true);
    await click(modalButton('Delete 2'));
    expect(actionCalls()).toHaveLength(2);

    await act(async () => {
      release();
    });
    await app.settle();
    expect(actionCalls()).toHaveLength(2);
    expect(modal()).toBeNull();
  });

  it('names the cluster and namespace count when a selection mixes kinds', async () => {
    const { clusterId, clusterName } = devCluster();
    await mount(
      <BatchTable
        rows={[
          makeRow(clusterId, 'Deployment', 'apps', 'web', { hpaManaged: false }),
          makeRow(clusterId, 'CronJob', 'batch', 'nightly', { namespace: 'team-b' }),
        ]}
      />
    );
    await selectAllRows();

    await click(batchAction('Delete 2'));

    expect(modalTitle()).toBe('Delete 2 Objects');
    expect(modal()?.textContent).toContain(`2 namespaces on cluster ${clusterName}`);
  });

  const detailColumns = () =>
    Array.from(modal()?.querySelectorAll('thead th') ?? [], (cell) => cell.textContent);
  const detailRows = () =>
    Array.from(modal()?.querySelectorAll('tbody tr') ?? [], (row) =>
      Array.from(row.querySelectorAll('td'), (cell) => cell.textContent)
    );
  const collidingDatabases = (clusterId: string) => [
    makeRow(clusterId, 'DBInstance', 'rds.services.k8s.aws', 'orders', { version: 'v1alpha1' }),
    makeRow(clusterId, 'DBInstance', 'kinda.rocks', 'orders', { version: 'v1beta1' }),
  ];
  const databaseKey = (row: ObjectActionData) => `${row.group}/${row.version}/${row.kind}`;

  it('tells same-named kinds from different API groups apart before deleting them', async () => {
    const { clusterId } = devCluster();
    await mount(<BatchTable rows={collidingDatabases(clusterId)} rowKey={databaseKey} />);
    await selectAllRows();

    await click(batchAction('Delete 2'));

    // The two kinds must not collapse into one group's badge and a plural count.
    expect(modalTitle()).toBe('Delete 2 Objects');
    expect(modal()?.querySelector('.confirmation-modal-target')).toBeNull();
    expect(detailColumns()).toEqual(['Kind', 'API Version', 'Name']);
    expect(detailRows()).toEqual([
      ['DBInstance', 'rds.services.k8s.aws/v1alpha1', 'orders'],
      ['DBInstance', 'kinda.rocks/v1beta1', 'orders'],
    ]);
  });

  it('keeps the API version on a failed row so the retry names the right object', async () => {
    const { clusterId } = devCluster();
    app.backend.answer('RunObjectAction', (request) => {
      if ((request as { target: { group: string } }).target.group === 'kinda.rocks') {
        throw new Error('denied by admission webhook');
      }
      return {};
    });
    await mount(<BatchTable rows={collidingDatabases(clusterId)} rowKey={databaseKey} />);
    await selectAllRows();
    await click(batchAction('Delete 2'));
    await click(modalButton('Delete 2'));

    expect(modalTitle()).toBe('Deleted 1 of 2 Objects');
    expect(detailColumns()).toEqual(['Kind', 'API Version', 'Failed']);
    expect(detailRows()).toEqual([['DBInstance', 'kinda.rocks/v1beta1', 'orders']]);
  });

  it('shows no API version when the kind names already tell the rows apart', async () => {
    const { clusterId } = devCluster();
    await mount(
      <BatchTable
        rows={[
          makeRow(clusterId, 'Deployment', 'apps', 'web', { hpaManaged: false }),
          makeRow(clusterId, 'CronJob', 'batch', 'nightly'),
        ]}
      />
    );
    await selectAllRows();

    await click(batchAction('Delete 2'));

    expect(detailColumns()).toEqual(['Kind', 'Name']);
  });

  it('leaves batch mode when the table moves to another scope', async () => {
    const { clusterId } = devCluster();
    const rows = [makeRow(clusterId, 'Pod', '', 'a')];
    await mount(<BatchTable rows={rows} scopeKey="scope-a" />);
    await click(requireToolbarButton('Batch select'));
    expect(view.container.querySelectorAll('.gridtable-row input[type="checkbox"]')).toHaveLength(
      1
    );

    await view.show(<BatchTable rows={rows} scopeKey="scope-b" />);

    expect(view.container.querySelectorAll('.gridtable-row input[type="checkbox"]')).toHaveLength(
      0
    );
    expect(toolbarButton('Batch select')).not.toBeNull();
  });

  it('drops a row from the selection when its object is replaced under the same name', async () => {
    const { clusterId } = devCluster();
    await mount(<BatchTable rows={[makeRow(clusterId, 'Pod', '', 'a')]} />);
    await selectAllRows();
    expect(batchLabels()).toEqual(['Delete 1']);

    // Same row key, different object: the user never checked this one.
    await view.show(<BatchTable rows={[makeRow(clusterId, 'Pod', '', 'a', { uid: 'uid-new' })]} />);

    expect(batchLabels()).toEqual([]);
    expect(selectedRowNames()).toEqual([]);
  });

  it('keeps a row selected when a refresh brings back the same object', async () => {
    const { clusterId } = devCluster();
    await mount(<BatchTable rows={[makeRow(clusterId, 'Pod', '', 'a')]} />);
    await selectAllRows();

    await view.show(
      <BatchTable rows={[makeRow(clusterId, 'Pod', '', 'a', { status: 'Running' })]} />
    );

    expect(batchLabels()).toEqual(['Delete 1']);
    expect(selectedRowNames()).toEqual(['a']);
  });

  it('does not bring back an earlier selection when the table returns to its scope', async () => {
    const { clusterId } = devCluster();
    const rows = [makeRow(clusterId, 'Pod', '', 'a')];
    await mount(<BatchTable rows={rows} scopeKey="scope-a" />);
    await selectAllRows();
    expect(batchLabels()).toEqual(['Delete 1']);

    await view.show(<BatchTable rows={rows} scopeKey="scope-b" />);
    await view.show(<BatchTable rows={rows} scopeKey="scope-a" />);

    expect(view.container.querySelectorAll('.gridtable-row input[type="checkbox"]')).toHaveLength(
      0
    );
    expect(batchLabels()).toEqual([]);
  });

  it('closes a confirmation for the old scope when the table moves on', async () => {
    const { clusterId } = devCluster();
    const rows = [makeRow(clusterId, 'Pod', '', 'a')];
    await mount(<BatchTable rows={rows} scopeKey="scope-a" />);
    await selectAllRows();
    await click(batchAction('Delete 1'));
    expect(modal()).not.toBeNull();

    await view.show(<BatchTable rows={rows} scopeKey="scope-b" />);

    expect(modal()).toBeNull();
  });

  it('leaves the new scope alone when a batch from the old scope finishes', async () => {
    const { clusterId } = devCluster();
    app.backend.answer('RunObjectAction', () => ({}));
    const release = app.backend.hold('RunObjectAction');
    const rows = [makeRow(clusterId, 'Pod', '', 'a')];
    await mount(<BatchTable rows={rows} scopeKey="scope-a" />);
    await selectAllRows();
    await click(batchAction('Delete 1'));
    await click(modalButton('Delete 1'));

    await view.show(<BatchTable rows={rows} scopeKey="scope-b" />);
    await click(requireToolbarButton('Batch select'));
    await act(async () => {
      release();
    });
    await app.settle();

    expect(toolbarButton('Exit batch select')).not.toBeNull();
  });

  const nodeRow = (clusterId: string, name: string, extra: Partial<ObjectActionData> = {}) =>
    makeRow(clusterId, 'Node', '', name, { namespace: '', ...extra });
  const modalWarning = () => document.body.querySelector('.confirmation-modal-warning');
  const drainStart = () =>
    requireValue(
      document.body.querySelector<HTMLButtonElement>('[data-test="batch-drain-start"]'),
      'batch drain start'
    );
  const drainOption = (name: string) =>
    requireValue(
      document.body.querySelector<HTMLInputElement>(`[data-test="drain-modal-${name}"]`),
      `drain option ${name}`
    );

  it('warns about workload pods on every node delete, however drained the nodes look', async () => {
    const { clusterId } = devCluster();
    await mount(
      <BatchTable
        allowedActions={['delete']}
        rows={[
          nodeRow(clusterId, 'schedulable'),
          nodeRow(clusterId, 'cordoned', { unschedulable: true }),
        ]}
      />
    );
    await selectAllRows();

    await click(batchAction('Delete 2'));

    expect(modalTitle()).toBe('Delete 2 Nodes');
    expect(modalWarning()).not.toBeNull();
  });

  it('shows no node warning when deleting something else', async () => {
    const { clusterId } = devCluster();
    await mount(<BatchTable rows={[makeRow(clusterId, 'Pod', '', 'a')]} />);
    await selectAllRows();

    await click(batchAction('Delete 1'));

    expect(modalWarning()).toBeNull();
  });

  it('asks again, with the warning, before retrying a failed node delete', async () => {
    const { clusterId } = devCluster();
    let failing = true;
    app.backend.answer('RunObjectAction', () => {
      if (failing) {
        throw new Error('etcd timeout');
      }
      return {};
    });
    await mount(<BatchTable allowedActions={['delete']} rows={[nodeRow(clusterId, 'a')]} />);
    await selectAllRows();
    await click(batchAction('Delete 1'));
    await click(modalButton('Delete 1'));
    expect(modalTitle()).toBe('Deleted 0 of 1 Node');

    failing = false;
    const callsBeforeRetry = actionCalls().length;
    await click(modalButton('Retry 1'));

    expect(actionCalls()).toHaveLength(callsBeforeRetry);
    expect(modalTitle()).toBe('Delete 1 Node');
    expect(modalWarning()).not.toBeNull();

    await click(modalButton('Delete 1'));
    expect(actionCalls().slice(callsBeforeRetry)).toEqual([
      expect.objectContaining({ target: expect.objectContaining({ name: 'a', uid: 'uid-a' }) }),
    ]);
  });

  it('drains every selected node with the one set of options chosen', async () => {
    const { clusterId } = devCluster();
    app.backend.answer('RunObjectAction', () => ({}));
    await mount(
      <BatchTable
        allowedActions={['drain']}
        rows={[nodeRow(clusterId, 'a'), nodeRow(clusterId, 'b')]}
      />
    );
    await selectAllRows();

    await click(batchAction('Drain 2'));
    expect(document.body.querySelector('#batch-drain-title')?.textContent).toBe('Drain 2 Nodes');
    expect(actionCalls()).toEqual([]);

    await click(drainOption('force'));
    await click(drainStart());

    expect(actionCalls()).toEqual(
      ['a', 'b'].map((name) => ({
        action: OBJECT_ACTIONS.startDrain,
        target: {
          clusterId,
          group: '',
          version: 'v1',
          kind: 'Node',
          namespace: '',
          name,
          uid: `uid-${name}`,
        },
        drainOptions: expect.objectContaining({
          force: true,
          ignoreDaemonSets: true,
          deleteEmptyDirData: true,
        }),
      }))
    );
    expect(document.body.querySelector('.drain-node-modal')).toBeNull();
    expect(toolbarButton('Batch select')).not.toBeNull();
  });

  it('blocks the drain when the chosen drain mode is not permitted', async () => {
    const { clusterId } = devCluster();
    app.permissions((query) => !(query.verb === 'delete' && query.resourceKind === 'Pod'));
    await mount(<BatchTable allowedActions={['drain']} rows={[nodeRow(clusterId, 'a')]} />);
    await selectAllRows();
    await click(batchAction('Drain 1'));
    expect(drainStart().disabled).toBe(false);

    await click(drainOption('disable-eviction'));

    expect(drainStart().disabled).toBe(true);
    expect(
      document.body.querySelector('[data-test="drain-modal-permission-reason"]')?.textContent
    ).toContain('permission to delete Pods');
  });

  it('reports a node whose drain could not start and retries it with the same options', async () => {
    const { clusterId } = devCluster();
    let refused = true;
    app.backend.answer('RunObjectAction', (request) => {
      if (refused && (request as { target: { name: string } }).target.name === 'b') {
        throw new Error('drain already running for node b');
      }
      return {};
    });
    await mount(
      <BatchTable
        allowedActions={['drain']}
        rows={[nodeRow(clusterId, 'a'), nodeRow(clusterId, 'b')]}
      />
    );
    await selectAllRows();
    await click(batchAction('Drain 2'));
    await click(drainOption('force'));
    await click(drainStart());

    expect(modalTitle()).toBe('Started draining 1 of 2 Nodes');
    expect(modal()?.textContent).toContain('drain already running for node b');
    expect(selectedRowNames()).toEqual(['b']);

    refused = false;
    const callsBeforeRetry = actionCalls().length;
    await click(modalButton('Retry 1'));

    expect(actionCalls().slice(callsBeforeRetry)).toEqual([
      expect.objectContaining({
        target: expect.objectContaining({ name: 'b' }),
        drainOptions: expect.objectContaining({ force: true }),
      }),
    ]);
  });
});
