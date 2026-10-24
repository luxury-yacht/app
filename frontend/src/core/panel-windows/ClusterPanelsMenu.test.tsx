/**
 * frontend/src/core/panel-windows/ClusterPanelsMenu.test.tsx
 *
 * The cluster tab menu closes, opens, or moves a cluster's view. The menu
 * reads the real cluster selection and window identity inside the production
 * shell; window commands reach the faked backend (test-utils/appState).
 */

import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { installAppStateHarness, type TestCluster } from '@/test-utils/appState/harness';
import { ClusterPanelsMenu } from './ClusterPanelsMenu';

const app = installAppStateHarness();

type Scenario = 'menu cluster alone' | 'menu cluster and another' | 'menu cluster not open';

const setup = async (scenario: Scenario) => {
  const production = app.cluster({
    name: 'dev',
    context: 'production',
    open: scenario !== 'menu cluster not open',
  });
  const opened = [production];
  if (scenario !== 'menu cluster alone') {
    opened.push(app.cluster({ name: 'dev', context: 'staging' }));
  }
  if (scenario === 'menu cluster not open') {
    opened.push(app.cluster({ name: 'dev', context: 'development' }));
  }
  for (const cluster of opened) {
    app.namespaces(cluster, ['default']);
  }
  app.backend.answer('OpenClusterWindow', () => undefined);
  app.backend.answer('RequestClusterTabTransfer', () => undefined);
  const view = await app.render(null);
  const onClose = vi.fn();
  const onCloseCluster = vi.fn();
  await view.show(
    <ClusterPanelsMenu
      clusterId={production.clusterId}
      position={{ x: 10, y: 10 }}
      onClose={onClose}
      onCloseCluster={onCloseCluster}
    />
  );
  return { production, onClose, onCloseCluster };
};

// The context menu renders in a portal on the document body.
const menuItem = (label: string) =>
  Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
    (item) => item.textContent === label
  );

const choose = async (label: string) => {
  const item = menuItem(label);
  if (!item) {
    throw new Error(`the menu has no "${label}" item`);
  }
  await act(async () => item.click());
  await app.settle();
  return item;
};

const transferOf = (cluster: TestCluster) =>
  expect.objectContaining({
    clusterId: cluster.clusterId,
    sourceWindowName: app.windowName,
    targetWindowName: '',
  });

it('closes the requested cluster through its supplied close action and dismisses the menu', async () => {
  const { onClose, onCloseCluster } = await setup('menu cluster alone');

  await choose('Close');

  expect(onCloseCluster).toHaveBeenCalledOnce();
  expect(onClose).toHaveBeenCalledOnce();
  expect(app.backend.calls('RequestClusterTabTransfer')).toEqual([]);
  expect(app.backend.calls('OpenClusterWindow')).toEqual([]);
});

describe.each([
  { scenario: 'menu cluster alone', disabled: false },
  { scenario: 'menu cluster and another', disabled: false },
  { scenario: 'menu cluster not open', disabled: true },
] as const)('with the $scenario', ({ scenario, disabled }) => {
  it('opens another view without a transfer', async () => {
    const { production, onClose, onCloseCluster } = await setup(scenario);

    const open = await choose('Open in new window');

    expect(open.getAttribute('aria-disabled')).toBe(String(disabled));
    expect(app.backend.calls('OpenClusterWindow')).toEqual(
      disabled ? [] : [[app.windowName, production.clusterId]]
    );
    expect(onClose).toHaveBeenCalledTimes(disabled ? 0 : 1);
    expect(app.backend.calls('RequestClusterTabTransfer')).toEqual([]);
    expect(onCloseCluster).not.toHaveBeenCalled();
  });

  it('moves through the existing transfer lifecycle', async () => {
    const { production } = await setup(scenario);

    const move = await choose('Move to new window');

    expect(move.getAttribute('aria-disabled')).toBe(String(disabled));
    expect(app.backend.calls('RequestClusterTabTransfer')).toEqual(
      disabled ? [] : [[app.windowName, transferOf(production)]]
    );
  });
});

it.each([
  { label: 'Open in new window', method: 'OpenClusterWindow', action: 'open-cluster-window' },
  {
    label: 'Move to new window',
    method: 'RequestClusterTabTransfer',
    action: 'move-cluster-window',
  },
] as const)(
  'reports a failed $label without closing the source',
  async ({ label, method, action }) => {
    const { production, onCloseCluster } = await setup('menu cluster alone');
    const error = new Error('native window unavailable');
    app.backend.answer(method, () => {
      throw error;
    });

    await choose(label);

    expect(
      app.errors
        .take((record) => record.error === error)
        .map(({ kinds, context }) => ({
          kinds,
          context,
        }))
    ).toEqual([
      {
        kinds: ['operational'],
        context: { source: 'ClusterPanelsMenu', action, clusterId: production.clusterId },
      },
    ]);
    expect(onCloseCluster).not.toHaveBeenCalled();
  }
);
