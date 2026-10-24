/**
 * frontend/src/shared/components/ObjectPanelLink.test.tsx
 *
 * A plain click on an object link opens its object's panel; Alt+click
 * navigates the workspace to the view that lists it instead. A `navigateRef`
 * redirects Alt+click (the namespace field reveals the HOST object, not the
 * Namespace kind), and in a panel window, which has no workspace navigation,
 * Alt+click opens the object. Runs inside the production shell with the real
 * object-panel, view-state, and namespace owners over a faked backend
 * (test-utils/appState).
 */

import { act } from 'react';
import { describe, expect, it } from 'vitest';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';
import type { KubernetesObjectReference } from '@/types/view-state';
import { ObjectPanelLink } from './ObjectPanelLink';

const app = installAppStateHarness();
let dev: TestCluster;
let view: MountedApp;

const namespaceRef = () => ({
  clusterId: dev.clusterId,
  clusterName: dev.clusterName,
  group: '',
  version: 'v1',
  kind: 'Namespace',
  namespace: '',
  name: 'shop',
});
const hostPod = () => ({
  clusterId: dev.clusterId,
  clusterName: dev.clusterName,
  group: '',
  version: 'v1',
  kind: 'Pod',
  namespace: 'shop',
  name: 'web-5',
});

const setUp = () => {
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['default', 'shop']);
};

const showLink = async (navigateRef?: KubernetesObjectReference) => {
  await view.show(
    <ObjectPanelLink objectRef={namespaceRef()} navigateRef={navigateRef}>
      shop
    </ObjectPanelLink>
  );
  return requireValue(
    view.container.querySelector<HTMLElement>('.object-panel-link'),
    'expected the object link'
  );
};

const click = async (link: HTMLElement, altKey: boolean) => {
  await act(async () => {
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, altKey }));
  });
  await app.settle();
};

const workspaceView = () => {
  const { viewState, namespace } = view.owners();
  return {
    view: viewState?.viewType,
    namespaceTab: viewState?.activeNamespaceTab,
    clusterTab: viewState?.activeClusterTab,
    namespace: namespace.selectedNamespace,
  };
};

describe('ObjectPanelLink', () => {
  it('opens its object’s panel on a plain click without navigating', async () => {
    setUp();
    view = await app.render(null);
    const before = workspaceView();

    await click(await showLink(), false);

    expect(view.openPanels()).toEqual([namespaceRef()]);
    expect(workspaceView()).toEqual(before);
  });

  it('navigates to its object’s view on Alt+click without opening a panel', async () => {
    setUp();
    view = await app.render(null);

    await click(await showLink(), true);

    expect(workspaceView()).toMatchObject({ view: 'cluster', clusterTab: 'namespaces' });
    expect(view.openPanels()).toEqual([]);
  });

  it('navigates to the navigateRef on Alt+click, while a plain click still opens its object', async () => {
    setUp();
    view = await app.render(null);
    const link = await showLink(hostPod());

    await click(link, true);
    // The host pod's view, with its namespace selected, not Cluster → Namespaces.
    expect(workspaceView()).toMatchObject({
      view: 'namespace',
      namespaceTab: 'pods',
      namespace: 'shop',
    });
    expect(view.openPanels()).toEqual([]);

    await click(link, false);
    expect(view.openPanels()).toEqual([namespaceRef()]);
  });

  it('opens its object on Alt+click in a panel window, which has no workspace navigation', async () => {
    setUp();
    // A panel window renders every panel it opens; the namespace panel reads its own data.
    app.servePanel(dev, {
      group: '',
      version: 'v1',
      kind: 'Namespace',
      namespace: '',
      name: 'shop',
    });
    app.panelWindow(dev);
    view = await app.render(null);

    await click(await showLink(hostPod()), true);

    expect(view.owners().viewState).toBeFalsy();
    expect(view.openPanels()).toEqual([namespaceRef()]);
  });
});
