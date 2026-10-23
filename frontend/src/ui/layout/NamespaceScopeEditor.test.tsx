/**
 * frontend/src/ui/layout/NamespaceScopeEditor.test.tsx
 *
 * The sidebar's inline "accessible namespaces" editor
 * (docs/architecture/namespace-scope.md). It loads the visible cluster's
 * scope from the backend, persists additions and removals through
 * SetClusterAllowedNamespaces without refetching ahead of the backend's
 * rebuild, keeps keyboard focus on its controls, validates names locally,
 * reports backend failures, keeps a save started in another cluster out of
 * the current one, and is the way in for an identity that cannot list
 * namespaces. Runs in the full app over a faked backend (test-utils/appState).
 */

import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildClusterRefreshScope } from '@/core/refresh/scopeSelector';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { makeErrorStatus } from '@/test-utils/errorStatusFixtures';
import { requireValue } from '@/test-utils/requireValue';

const app = installAppStateHarness();
let dev: TestCluster;
let view: MountedApp;
/** Each cluster's persisted scope, as GetClusterAllowedNamespaces answers it. */
const persistedScopes = new Map<string, string[]>();

const serveCluster = (cluster: TestCluster, namespaces: string[], scope: string[]) => {
  app.namespaces(cluster, namespaces);
  app.startScreen(cluster);
  persistedScopes.set(cluster.clusterId, scope);
};

const start = async () => {
  view = await app.mountApp();
};

const buttonNamed = (name: string) =>
  requireValue(
    Array.from(view.container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.trim() === name || button.getAttribute('aria-label') === name
    ),
    `expected the ${name} button`
  );
const addButton = () => buttonNamed('Add namespace');
const nameInput = () =>
  requireValue(
    view.container.querySelector<HTMLInputElement>('input[aria-label="Namespace name"]'),
    'expected the namespace name input'
  );
const scopeError = () => view.container.querySelector('.namespace-scope-error');
const namespaceToggles = () =>
  Array.from(
    view.container.querySelectorAll<HTMLElement>('[data-sidebar-target-kind="namespace-toggle"]'),
    (toggle) => toggle.textContent?.trim()
  );
const removeButton = (namespace: string) =>
  view.container
    .querySelector(`[data-namespace="${dev.clusterId}|${namespace}"]`)
    ?.parentElement?.querySelector<HTMLButtonElement>('.namespace-scope-remove') ?? null;

const press = async (key: string) => {
  const target = requireValue(document.activeElement, 'expected a focused control');
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  await act(async () => {
    target.dispatchEvent(event);
  });
  await app.settle();
  return event;
};

/** Opens the add row and types `name` into the input it focuses, as the user does. */
const typeName = async (name: string) => {
  await act(async () => addButton().click());
  const input = nameInput();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, name);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

const saves = () => app.backend.calls('SetClusterAllowedNamespaces');

beforeEach(() => {
  persistedScopes.clear();
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.backend.answer('GetClusterAllowedNamespaces', (clusterId) => [
    ...(persistedScopes.get(clusterId) ?? []),
  ]);
  // Mirrors backend/workspace_namespace_scope.go SetClusterAllowedNamespaces: it returns
  // the normalized scope.
  app.backend.answer('SetClusterAllowedNamespaces', (_clusterId, namespaces) => [
    ...(namespaces ?? []),
  ]);
});

describe('NamespaceScopeEditor', () => {
  it('persists an added namespace and lists it once the backend has rebuilt the cluster', async () => {
    serveCluster(dev, ['default'], ['default']);
    await start();
    app.snapshots.clearReads();

    await typeName('team-a');
    await press('Enter');

    expect(saves()).toEqual([[dev.clusterId, ['default', 'team-a']]]);
    expect(document.activeElement).toBe(addButton());
    // The backend rebuilds the cluster's subsystem after a save; a refetch now
    // would cache the pre-rebuild list (namespaceScope.ts saveNamespaceScope).
    expect(app.snapshots.reads('namespaces')).toEqual([]);

    app.namespaces(dev, ['default', 'team-a']);
    await act(async () => {
      app.events.emit('cluster:scope:changed', { clusterId: dev.clusterId });
    });
    await app.settle();

    expect(namespaceToggles()).toEqual(['All Namespaces', 'default', 'team-a']);
    expect(removeButton('team-a')).not.toBeNull();
  });

  it('removes a namespace from the scope and returns focus to the namespace selector', async () => {
    serveCluster(dev, ['default', 'team-a'], ['default', 'team-a']);
    await start();

    const remove = requireValue(removeButton('default'), 'expected the remove control');
    await act(async () => {
      remove.focus();
      remove.click();
    });
    await app.settle();

    expect(saves()).toEqual([[dev.clusterId, ['team-a']]]);
    expect(document.activeElement).toBe(buttonNamed('Select namespace'));
  });

  it('keeps Add namespace in the Tab order and returns focus to it after Escape or an empty entry', async () => {
    serveCluster(dev, ['default'], ['default']);
    await start();
    expect(addButton().tabIndex).toBe(0);

    await typeName('draft');
    expect(document.activeElement).toBe(nameInput());
    await press('Escape');
    expect(document.activeElement).toBe(addButton());

    await typeName('');
    await press('Enter');
    expect(document.activeElement).toBe(addButton());

    // The input leaves Tab to the sidebar's region navigation, which moves on
    // to the sidebar's next control.
    await typeName('');
    await press('Tab');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Resize sidebar');
    expect(saves()).toEqual([]);
  });

  it('rejects an invalid name locally without saving or reporting it', async () => {
    serveCluster(dev, ['default'], ['default']);
    await start();

    await typeName('Bad!');
    await press('Enter');

    expect(saves()).toEqual([]);
    expect(scopeError()).not.toBeNull();
    expect(document.activeElement).toBe(nameInput());
  });

  it('reports a save the backend refuses and keeps the persisted scope', async () => {
    serveCluster(dev, ['default'], ['default']);
    app.backend.answer('SetClusterAllowedNamespaces', () => {
      throw new Error('settings database is read-only');
    });
    await start();

    await typeName('team-a');
    await press('Enter');

    expect(scopeError()).not.toBeNull();
    expect(app.errors.take((record) => record.context?.action === 'saveNamespaceScope')).toEqual([
      expect.objectContaining({
        context: expect.objectContaining({ clusterId: dev.clusterId }),
      }),
    ]);
    expect(removeButton('default')).not.toBeNull();
  });

  it.each(['succeeds', 'fails'] as const)(
    'keeps a save that %s after a cluster switch out of the next cluster’s editor',
    async (outcome) => {
      const staging = app.cluster({ name: 'dev', context: 'staging' });
      serveCluster(dev, ['default'], ['default']);
      serveCluster(staging, ['payments'], ['payments']);
      if (outcome === 'fails') {
        app.backend.answer('SetClusterAllowedNamespaces', () => {
          throw new Error('dev cluster save failed');
        });
      }
      const release = app.backend.hold('SetClusterAllowedNamespaces');
      await start();
      await typeName('team-a');
      await press('Enter');
      expect(saves()).toEqual([[dev.clusterId, ['default', 'team-a']]]);

      await view.selectCluster(staging);
      await act(async () => release());
      await app.settle();

      expect(namespaceToggles()).toEqual(['All Namespaces', 'payments']);
      expect(
        view.container
          .querySelector(`[data-namespace="${staging.clusterId}|payments"]`)
          ?.parentElement?.querySelector('.namespace-scope-remove')
      ).not.toBeNull();
      expect(scopeError()).toBeNull();
    }
  );

  it('lets an identity that cannot list namespaces add the namespaces it may access', async () => {
    const scope = buildClusterRefreshScope('namespaces', dev.clusterId);
    const forbidden = makeErrorStatus('Forbidden', 'namespaces is forbidden');
    app.snapshots.fail('namespaces', scope, forbidden);
    app.snapshots.fail('namespace-metrics', scope, forbidden);
    app.startScreen(dev);
    persistedScopes.set(dev.clusterId, []);
    await start();

    expect(view.owners().namespace.namespacesPermissionDenied).toBe(true);
    expect(namespaceToggles()).toEqual([]);
    expect(buttonNamed('Select namespace')).toBeDefined();

    await typeName('team-a');
    await press('Enter');

    expect(saves()).toEqual([[dev.clusterId, ['team-a']]]);
  });
});
