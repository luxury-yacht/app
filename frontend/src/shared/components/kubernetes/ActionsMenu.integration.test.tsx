/**
 * frontend/src/shared/components/kubernetes/ActionsMenu.integration.test.tsx
 *
 * The permission pipeline behind an object panel's Actions menu, end to end:
 * the panel queries its namespace's permissions on open, and the menu looks
 * them up under the same keys. Pins the spec-emit ↔ lookup key agreement for
 * pod actions — the contract behind "pod Details menu is missing Port Forward
 * / Delete" regressions. Runs the full app with a real pod panel and the real
 * permission store over a faked backend (test-utils/appState).
 */

import { OBJECT_ACTION_IDS } from '@shared/actions/objectActionContract';
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { installAppStateHarness } from '@/test-utils/appState/harness';
import { objectDetailOf } from '@/test-utils/objectDetail';
import { requireValue } from '@/test-utils/requireValue';

const app = installAppStateHarness();

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
});
