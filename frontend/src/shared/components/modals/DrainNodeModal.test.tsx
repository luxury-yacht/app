/**
 * frontend/src/shared/components/modals/DrainNodeModal.test.tsx
 *
 * The node drain workflow: the modal reads the node's maintenance state from
 * its cluster, starts a drain with the node's complete identity and the
 * options the user chose, refreshes that state afterward, reports its
 * mutation boundary to its owner, explains a permission that blocks the
 * drain, shows a running drain instead of the options, retries after a failed
 * drain and reports a refused one, and cancels a running drain. Runs inside
 * the production shell (refresh, data access, keyboard) over a faked backend
 * (test-utils/appState); the drain RPCs are the backend's RunObjectAction and
 * CancelDrainNodeJob.
 */

import { act, type ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildRefreshScope } from '@/core/refresh/scopeSelector';
import type { NodeMaintenanceDrainJob } from '@/core/refresh/types';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';
import DrainNodeModal from './DrainNodeModal';

const app = installAppStateHarness();
let dev: TestCluster;
let view: MountedApp;
let maintenanceScope: string;

const drainJob = (status: NodeMaintenanceDrainJob['status']): NodeMaintenanceDrainJob => ({
  clusterId: dev.clusterId,
  id: 'drain-1',
  nodeName: 'node-a',
  status,
  startedAt: 1_700_000_000_000,
  options: {
    ignoreDaemonSets: true,
    deleteEmptyDirData: true,
    force: false,
    disableEviction: false,
    skipWaitForPodsToTerminate: false,
  },
  events: [],
});

/** The node's maintenance snapshot (backend/refresh/snapshot/object_maintenance.go). */
const serveDrains = (drains: NodeMaintenanceDrainJob[]) => {
  app.snapshots.serve('object-maintenance', maintenanceScope, {
    clusterId: dev.clusterId,
    clusterName: dev.clusterName,
    drains,
  });
};

const showModal = async (props: Partial<ComponentProps<typeof DrainNodeModal>> = {}) => {
  view = await app.render(null);
  await view.show(
    <DrainNodeModal
      isOpen
      clusterId={dev.clusterId}
      clusterName={dev.clusterName}
      nodeName="node-a"
      onClose={() => undefined}
      {...props}
    />
  );
};

const control = <E extends HTMLElement>(selector: string) =>
  requireValue(document.querySelector<E>(selector), `expected ${selector}`);
const startButton = () =>
  document.querySelector<HTMLButtonElement>('[data-test="drain-modal-start"]');

const clickControl = async (selector: string) => {
  await act(async () => control(selector).click());
  await app.settle();
};

const maintenanceReads = () =>
  app.snapshots.reads('object-maintenance').filter((read) => read.scope === maintenanceScope);

const drainTarget = () => ({
  clusterId: dev.clusterId,
  group: '',
  version: 'v1',
  kind: 'Node',
  namespace: '',
  name: 'node-a',
});

beforeEach(() => {
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['default']);
  maintenanceScope = buildRefreshScope('object-maintenance', {
    clusterId: dev.clusterId,
    selector: { kind: 'node', node: 'node-a' },
  });
  serveDrains([]);
  app.backend.answer('RunObjectAction', () => ({}));
});

describe('DrainNodeModal', () => {
  it('reads the node’s maintenance state in its cluster and offers to start a drain', async () => {
    await showModal();

    expect(maintenanceReads()).not.toEqual([]);
    expect(startButton()?.disabled).toBe(false);
  });

  it('explains the eviction permission the drain needs and does not start it', async () => {
    await showModal({
      permissions: {
        nodeMutation: { allowed: true, pending: false },
        podEvictionCreate: { allowed: false, pending: false },
        podDelete: { allowed: true, pending: false },
      },
    });

    expect(startButton()?.disabled).toBe(true);
    expect(control('[data-test="drain-modal-permission-reason"]').textContent).toContain(
      'Pod evictions'
    );
    await clickControl('[data-test="drain-modal-start"]');
    expect(app.backend.calls('RunObjectAction')).toEqual([]);
  });

  it('starts a drain of the node with its complete identity, then refreshes its maintenance state', async () => {
    await showModal();
    const readsBefore = maintenanceReads().length;

    await clickControl('[data-test="drain-modal-start"]');

    expect(app.backend.calls('RunObjectAction')).toEqual([
      [
        {
          action: 'startDrain',
          target: drainTarget(),
          drainOptions: expect.objectContaining({
            ignoreDaemonSets: true,
            deleteEmptyDirData: true,
            force: false,
            disableEviction: false,
            skipWaitForPodsToTerminate: false,
          }),
        },
      ],
    ]);
    expect(maintenanceReads().length).toBeGreaterThan(readsBefore);
  });

  it('reports its mutation boundary while the drain request is in flight', async () => {
    const onMutationChange = vi.fn();
    await showModal({ onMutationChange });
    const release = app.backend.hold('RunObjectAction');

    await clickControl('[data-test="drain-modal-start"]');
    expect(onMutationChange).toHaveBeenLastCalledWith(true);

    await act(async () => release());
    await app.settle();
    expect(onMutationChange).toHaveBeenLastCalledWith(false);
  });

  it('sends the advanced options the user chose, normalized', async () => {
    await showModal();
    const changeNumber = async (input: HTMLInputElement, value: string) => {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
          input,
          value
        );
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    };

    for (const option of [
      'ignore-daemonsets',
      'delete-emptydir',
      'disable-eviction',
      'skip-wait',
      'force',
      'grace-toggle',
      'timeout-toggle',
    ]) {
      await clickControl(`[data-test="drain-modal-${option}"]`);
    }
    const [grace, timeout] = Array.from(
      document.querySelectorAll<HTMLInputElement>('.drain-node-modal-grace input[type="number"]')
    );
    await changeNumber(requireValue(grace, 'grace input'), '1200');
    await changeNumber(requireValue(timeout, 'timeout input'), '9.8');
    await clickControl('[data-test="drain-modal-start"]');

    expect(app.backend.calls('RunObjectAction')[0]?.[0]).toMatchObject({
      action: 'startDrain',
      target: drainTarget(),
      drainOptions: {
        ignoreDaemonSets: false,
        deleteEmptyDirData: false,
        disableEviction: true,
        skipWaitForPodsToTerminate: true,
        force: true,
        gracePeriodSeconds: 900,
        timeoutSeconds: 9,
      },
    });
  });

  it('offers a retry after a failed drain and reports a refused retry', async () => {
    serveDrains([drainJob('failed'), { ...drainJob('succeeded'), id: 'drain-older' }]);
    app.backend.answer('RunObjectAction', () => {
      throw new Error('drain rejected');
    });
    await showModal();
    expect(document.querySelectorAll('.drain-node-modal-history-entry')).toHaveLength(1);

    await clickControl('[data-test="drain-modal-retry"]');

    expect(control('.drain-node-modal-error').textContent).toContain('drain rejected');
    expect(app.errors.take((record) => record.context?.source === 'drain-modal')).toEqual([
      expect.objectContaining({
        context: expect.objectContaining({ context: { nodeName: 'node-a' } }),
      }),
    ]);
  });

  it('shows a running drain instead of the controls for starting another', async () => {
    serveDrains([drainJob('running')]);

    await showModal();

    expect(control('[data-test="drain-job-status"]').textContent).toBe('Running');
    expect(startButton()).toBeNull();
    expect(document.querySelector('[data-test="drain-modal-ignore-daemonsets"]')).toBeNull();
  });

  it('cancels the running drain in its cluster, then refreshes its maintenance state', async () => {
    serveDrains([drainJob('running')]);
    app.backend.answer('CancelDrainNodeJob', () => undefined);
    await showModal();
    const readsBefore = maintenanceReads().length;

    await clickControl('[data-maintenance-action="cancel-drain"]');

    expect(app.backend.calls('CancelDrainNodeJob')).toEqual([[dev.clusterId, 'drain-1']]);
    expect(maintenanceReads().length).toBeGreaterThan(readsBefore);
  });
});
