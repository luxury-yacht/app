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
}: Readonly<{
  rows: ObjectActionData[];
  scopeKey?: string;
  allowedActions?: readonly BatchObjectActionId[];
}>) {
  const batch = useBatchObjectActions<ObjectActionData>({ getObject, scopeKey, allowedActions });
  return (
    <>
      <GridTable<ObjectActionData>
        data={rows}
        columns={[{ key: 'name', header: 'Name', render: (row) => row.name }]}
        keyExtractor={keyOf}
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
        target: { clusterId, group: '', version: 'v1', kind: 'Pod', namespace: 'team-a', name },
      }))
    );
    expect(modal()).toBeNull();
    expect(view.container.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    expect(toolbarButton('Batch select')).not.toBeNull();
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
      expect.objectContaining({ target: expect.objectContaining({ name: 'b' }) }),
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
          target: expect.objectContaining({ name, kind: 'Deployment', group: 'apps' }),
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
});
