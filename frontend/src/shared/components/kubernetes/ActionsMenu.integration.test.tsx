/**
 * frontend/src/shared/components/kubernetes/ActionsMenu.integration.test.tsx
 *
 * The permission pipeline behind an object panel's Actions menu, end to end:
 * the panel queries its namespace's permissions on open, and the menu looks
 * them up under the same keys. Pins the spec-emit ↔ lookup key agreement for
 * pod actions — the contract behind "pod Details menu is missing Port Forward
 * / Delete" regressions — and the Helm release rollback the menu leads to.
 * Runs the full app with real panels and the real permission store over a
 * faked backend (test-utils/appState).
 */

import { OBJECT_ACTION_IDS } from '@shared/actions/objectActionContract';
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { installAppStateHarness } from '@/test-utils/appState/harness';
import { objectDetailOf } from '@/test-utils/objectDetail';
import { requireValue } from '@/test-utils/requireValue';

const app = installAppStateHarness();

const buttonNamed = (scope: ParentNode, name: string): HTMLButtonElement =>
  requireValue(
    Array.from(scope.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.trim() === name
    ),
    `expected a ${name} button`
  );

describe('ActionsMenu + real permission store', () => {
  it('offers an enabled Port Forward and Delete for a pod once its namespace permissions load', async () => {
    const dev = app.cluster({ name: 'dev', context: 'alpha' });
    app.namespaces(dev, ['team-a']);
    app.startScreen(dev);
    const pod = app.servePanel(
      dev,
      { group: '', version: 'v1', kind: 'Pod', namespace: 'team-a', name: 'api-123' },
      objectDetailOf('pod', {
        name: 'api-123',
        namespace: 'team-a',
        status: 'Running',
        ready: '1/1',
        containers: [{ name: 'api', image: 'api:1', ports: ['8080/TCP'] }],
      })
    );
    const view = await app.mountApp();
    await act(async () => {
      view.owners().objectPanel.openWithObject(pod.ref);
    });
    await app.settle();

    expect(
      app.backend.calls('QueryPermissions').flatMap(([queries]) => queries ?? [])
    ).toContainEqual(expect.objectContaining({ clusterId: dev.clusterId, namespace: 'team-a' }));
    await act(async () => {
      requireValue(
        view.container.querySelector<HTMLButtonElement>('.object-panel-body .actions-menu-button'),
        'expected the panel’s Actions menu'
      ).click();
    });
    const item = (id: string) =>
      requireValue(
        document.body.querySelector<HTMLButtonElement>(
          `[role="menu"] .context-menu-item[data-context-action-id="${id}"]`
        ),
        `expected the ${id} menu item`
      );

    expect(item(OBJECT_ACTION_IDS.portForward).disabled).toBe(false);
    expect(item(OBJECT_ACTION_IDS.delete).disabled).toBe(false);
  });

  // Helm releases roll back as workloads do: the release panel's Actions menu
  // offers Rollback, the dialog diffs the chosen revision's manifest, and
  // confirming sends the rollback for the release's helm.sh/v3 identity.
  it('rolls a Helm release back to the revision chosen from its Actions menu', async () => {
    const dev = app.cluster({ name: 'dev', context: 'alpha' });
    app.namespaces(dev, ['team-a']);
    app.startScreen(dev);
    const release = app.servePanel(
      dev,
      { group: 'helm.sh', version: 'v3', kind: 'HelmRelease', namespace: 'team-a', name: 'shop' },
      objectDetailOf('helmrelease', { name: 'shop', namespace: 'team-a', revision: 3 })
    );
    const deployedAt = (hoursAgo: number) =>
      new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
    app.backend.answer('GetRevisionHistory', () => [
      {
        revision: 3,
        createdAt: deployedAt(1),
        changeCause: 'Upgrade complete',
        current: true,
        content: 'image: shop:3',
      },
      {
        revision: 2,
        createdAt: deployedAt(5),
        changeCause: 'Upgrade complete',
        current: false,
        content: 'image: shop:2',
      },
    ]);
    app.backend.answer('RunObjectAction', () => ({}));
    const view = await app.mountApp();
    await act(async () => {
      view.owners().objectPanel.openWithObject(release.ref);
    });
    await app.settle();

    await act(async () => {
      requireValue(
        view.container.querySelector<HTMLButtonElement>('.object-panel-body .actions-menu-button'),
        'expected the release panel’s Actions menu'
      ).click();
    });
    await act(async () => {
      requireValue(
        document.body.querySelector<HTMLButtonElement>(
          `[role="menu"] .context-menu-item[data-context-action-id="${OBJECT_ACTION_IDS.rollback}"]`
        ),
        'expected the Rollback menu item'
      ).click();
    });
    await app.settle();

    const dialog = requireValue(
      document.body.querySelector('.rollback-modal'),
      'expected the rollback dialog'
    );
    expect(dialog.querySelector('.rollback-diff-content')?.textContent).toContain('image: shop:2');
    await act(async () => {
      buttonNamed(dialog, 'Rollback to Revision 2').click();
    });
    await act(async () => {
      buttonNamed(
        requireValue(
          document.body.querySelector('.confirmation-modal'),
          'expected the confirmation'
        ),
        'Rollback'
      ).click();
    });
    await app.settle();

    const releaseIdentity = {
      clusterId: dev.clusterId,
      group: 'helm.sh',
      version: 'v3',
      kind: 'HelmRelease',
      namespace: 'team-a',
      name: 'shop',
    };
    expect(app.backend.calls('GetRevisionHistory')).not.toHaveLength(0);
    for (const [target] of app.backend.calls('GetRevisionHistory')) {
      expect(target).toEqual(expect.objectContaining(releaseIdentity));
    }
    expect(app.backend.calls('RunObjectAction')).toEqual([
      [
        expect.objectContaining({
          action: 'rollback',
          target: expect.objectContaining(releaseIdentity),
          revision: 2,
        }),
      ],
    ]);
  });
});
