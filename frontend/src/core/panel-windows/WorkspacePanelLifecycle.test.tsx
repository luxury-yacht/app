/**
 * frontend/src/core/panel-windows/WorkspacePanelLifecycle.test.tsx
 *
 * Closing a cluster tab, closing the window, or quitting freezes the affected
 * panels while their placement is published, refuses while a panel has
 * unsaved edits, and releases input however the request ends. Runs in the
 * full app: its own WorkspacePanelLifecycle, publication queue, guard registry,
 * object-panel state, and kubeconfig owner, with an open pod panel docked by
 * its layout. Only the backend boundary is faked (test-utils/appState);
 * `backend.hold` keeps a call in flight to observe the app meanwhile.
 */

import { act, useState } from 'react';
import { createPortal } from 'react-dom';
import { beforeEach, expect, it } from 'vitest';
import { objectPanelId } from '@/modules/object-panel/objectPanelRef';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';
import { useDockablePanelContext } from '@/ui/dockable';
import { getGroupForPanel } from '@/ui/dockable/tabGroupState';
import { PanelLifecycleClusterSurface, usePanelLifecycleGuard } from './panelLifecycleGuards';

const app = installAppStateHarness();
let view: MountedApp;
let production: TestCluster;
let staging: TestCluster;
let dock: ReturnType<typeof useDockablePanelContext> | undefined;

const podRef = () => ({
  clusterId: production.clusterId,
  group: '',
  version: 'v1',
  kind: 'Pod',
  namespace: 'default',
  name: 'pod',
});
const podPanelId = () => objectPanelId(podRef());

// A panel whose edits are unsaved once the user has made one.
function EditablePanel() {
  const [edits, setEdits] = useState(0);
  usePanelLifecycleGuard(podPanelId(), () =>
    edits ? { reason: 'unsaved-yaml', focus: () => undefined } : null
  );
  return (
    <PanelLifecycleClusterSurface clusterId={production.clusterId}>
      <button type="button" data-testid="edit" onClick={() => setEdits((value) => value + 1)}>
        {edits}
      </button>
      {createPortal(
        <button
          type="button"
          data-testid="portal-edit"
          onClick={() => setEdits((value) => value + 1)}
        >
          Edit in menu
        </button>,
        document.body
      )}
    </PanelLifecycleClusterSurface>
  );
}

function DockProbe() {
  dock = useDockablePanelContext();
  return null;
}

const editButton = () =>
  requireValue(document.querySelector<HTMLButtonElement>('[data-testid="edit"]'), 'pod panel');

const click = async (element: HTMLElement) => {
  await act(async () => element.click());
};

/** Moves the docked pod panel to the other edge, so the window has a placement to publish. */
const rearrange = async () => {
  const dockContext = requireValue(dock, 'dock');
  const edge =
    getGroupForPanel(dockContext.tabGroups, podPanelId()) === 'bottom' ? 'right' : 'bottom';
  await act(async () => dockContext.requestTabMove(podPanelId(), edge));
};

const closeProductionTab = () => {
  let closing!: Promise<void>;
  act(() => {
    closing = view.owners().kubeconfig.closeKubeconfig(production.selection);
  });
  return closing;
};

const finish = async (closing: Promise<unknown>) => {
  await act(async () => {
    await closing;
  });
  await app.settle();
};

const emitToThisWindow = async (name: string, payload: object, sender = app.windowName) => {
  await act(async () => {
    app.events.emit(name, payload, { sender });
  });
  await app.settle();
};

const quitEvent = { windowName: '', transactionId: 'quit-1' };
const requestQuit = (sender?: string) =>
  emitToThisWindow(
    'panel-window:application-quit-preflight-requested',
    { ...quitEvent, windowName: sender ?? app.windowName },
    sender
  );
const settleQuit = (sender?: string) =>
  emitToThisWindow(
    'panel-window:application-quit-preflight-settled',
    { ...quitEvent, windowName: sender ?? app.windowName },
    sender
  );

beforeEach(async () => {
  production = app.cluster({ name: 'dev', context: 'production' });
  staging = app.cluster({ name: 'dev', context: 'staging' });
  for (const cluster of [production, staging]) {
    app.namespaces(cluster, ['default']);
    app.startScreen(cluster);
  }
  const { clusterId: _clusterId, ...pod } = podRef();
  app.servePanel(production, pod);
  app.backend.answer('CloseClusterView', () => false);
  app.backend.answer('AcknowledgeWorkspaceWindowClose', () => undefined);
  app.backend.answer('AcknowledgeApplicationQuitPreflight', () => undefined);
  view = await app.mountApp(
    <>
      <DockProbe />
      <EditablePanel />
    </>
  );
  await act(async () => {
    view.owners().objectPanel.openWithObject(podRef());
  });
  await app.settle();
});

it('guards panels immediately but waits for tab admission before native close', async () => {
  const later = app.cluster({ name: 'dev', context: 'later', open: false });
  app.namespaces(later, ['default']);
  // The user opens another cluster tab; its admission is still in flight.
  const admit = app.backend.hold('ApplyClusterWorkspace');
  act(() => {
    void view.owners().kubeconfig.openKubeconfig(later.selection);
  });
  const closing = closeProductionTab();
  await app.settle();

  await click(editButton());
  expect(editButton().textContent).toBe('0');
  expect(app.backend.calls('CloseClusterView')).toEqual([]);

  await act(async () => admit());
  await finish(closing);

  expect(app.backend.calls('CloseClusterView')).toEqual([[app.windowName, production.clusterId]]);
  // The backend kept the cluster open, so its panel accepts input again.
  expect(view.owners().kubeconfig.managedClusterIds).toContain(production.clusterId);
  await click(editButton());
  expect(editButton().textContent).toBe('1');
});

it('closes a cluster without a full-window overlay or blocking unrelated input', async () => {
  const unrelated = document.createElement('button');
  unrelated.dataset.panelLifecycleCluster = staging.clusterId;
  let unrelatedClicks = 0;
  unrelated.addEventListener('click', () => {
    unrelatedClicks += 1;
  });
  view.container.append(unrelated);
  const publish = app.backend.hold('PublishDockedPanels');

  const closing = closeProductionTab();
  await app.settle();
  unrelated.click();
  const overlay = document.querySelector('.panel-transfer-status');
  await act(async () => publish());
  await finish(closing);

  expect(overlay).toBeNull();
  expect(unrelatedClicks).toBe(1);
});

it('blocks edits during publication and releases input when cluster close is denied', async () => {
  const publish = app.backend.hold('PublishDockedPanels');

  const closing = closeProductionTab();
  await app.settle();
  await click(editButton());
  await click(
    requireValue(
      document.querySelector<HTMLButtonElement>('[data-testid="portal-edit"]'),
      'menu edit'
    )
  );
  const editsDuringPublication = editButton().textContent;
  await act(async () => publish());
  await finish(closing);

  expect(editsDuringPublication).toBe('0');
  expect(app.backend.calls('CloseClusterView')).toEqual([[app.windowName, production.clusterId]]);
  expect(view.owners().kubeconfig.managedClusterIds).toContain(production.clusterId);
  await click(editButton());
  expect(editButton().textContent).toBe('1');
});

it('keeps the affected cluster guarded through native approval until the tab closes', async () => {
  app.backend.answer('CloseClusterView', () => true);
  const approve = app.backend.hold('CloseClusterView');

  const closing = closeProductionTab();
  await app.settle();
  expect(app.backend.calls('CloseClusterView')).toHaveLength(1);
  await click(editButton());
  expect(editButton().textContent).toBe('0');
  expect(document.querySelector('.panel-transfer-status')).toBeNull();

  await act(async () => approve());
  await finish(closing);

  expect(view.owners().kubeconfig.managedClusterIds).toEqual([staging.clusterId]);
  await click(editButton());
  expect(editButton().textContent).toBe('1');
});

it('releases input when publication fails without requesting native closure', async () => {
  await rearrange();
  app.backend.answer('PublishDockedPanels', () => {
    throw new Error('publication failed');
  });
  await rearrange();

  await finish(closeProductionTab().catch(() => undefined));

  expect(app.backend.calls('CloseClusterView')).toEqual([]);
  // Every report is the refused publication: logged per attempt, and shown
  // to the user once as the close's failure.
  const reports = app.errors.take(() => true);
  expect(reports.every(({ error }) => (error as Error).message === 'publication failed')).toBe(
    true
  );
  expect(reports.filter(({ kinds }) => kinds.includes('toast'))).toHaveLength(1);
  await click(editButton());
  expect(editButton().textContent).toBe('1');
});

it.each([
  [
    'window close',
    () => emitToThisWindow('workspace-window:close-requested', { windowName: app.windowName }),
    'AcknowledgeWorkspaceWindowClose',
  ],
  ['quit', () => requestQuit(), 'AcknowledgeApplicationQuitPreflight'],
] as const)(
  'blocks edits and holds the answer while %s waits for publication',
  async (_request, request, answer) => {
    const publish = app.backend.hold('PublishDockedPanels');
    await rearrange();

    await request();
    await click(editButton());
    const edits = editButton().textContent;
    const answeredBeforePublication = app.backend.calls(answer).length;
    await act(async () => publish());
    await app.settle();

    expect(edits).toBe('0');
    expect(answeredBeforePublication).toBe(0);
    expect(app.backend.calls(answer)).toHaveLength(1);
  }
);

it('denies quit and keeps the window open when publication fails', async () => {
  await rearrange();
  app.backend.answer('PublishDockedPanels', () => {
    throw new Error('publication failed');
  });
  await rearrange();

  await requestQuit();

  expect(app.backend.calls('AcknowledgeApplicationQuitPreflight')).toEqual([
    [app.windowName, 'quit-1', false],
  ]);
  expect(app.backend.calls('AcknowledgeWorkspaceWindowClose')).toEqual([]);
  const reports = app.errors.take(() => true);
  expect(reports.every(({ error }) => (error as Error).message === 'publication failed')).toBe(
    true
  );
  await click(editButton());
  expect(editButton().textContent).toBe('1');
});

it('keeps quit approval frozen until the backend settles all renderers', async () => {
  await requestQuit();

  expect(app.backend.calls('AcknowledgeApplicationQuitPreflight')).toEqual([
    [app.windowName, 'quit-1', true],
  ]);
  await click(editButton());
  const editsBeforeSettlement = editButton().textContent;
  await settleQuit();
  await click(editButton());

  expect(editsBeforeSettlement).toBe('0');
  expect(editButton().textContent).toBe('1');
});

it('keeps existing unsaved edits open without publishing or closing', async () => {
  await click(editButton());
  const publishedBefore = app.backend.calls('PublishDockedPanels').length;

  await finish(closeProductionTab());

  expect(app.backend.calls('PublishDockedPanels')).toHaveLength(publishedBefore);
  expect(app.backend.calls('CloseClusterView')).toEqual([]);
  expect(view.owners().kubeconfig.managedClusterIds).toContain(production.clusterId);
  expect(editButton().textContent).toBe('1');
  // The user is taken to the blocking panel and told why.
  expect(app.focusedWindows()).toEqual([app.windowName]);
  expect(
    app.errors.take((record) => record.kinds.includes('warning')).map(({ kinds }) => kinds)
  ).toEqual([['warning']]);
});

it('releases input after a rejected quit acknowledgement', async () => {
  app.backend.answer('AcknowledgeApplicationQuitPreflight', () => {
    throw new Error('acknowledgement failed');
  });

  await requestQuit();
  await click(editButton());

  expect(editButton().textContent).toBe('1');
  expect(
    app.errors
      .take((record) => record.kinds.includes('operational'))
      .map(({ context }) => context?.action)
  ).toEqual(['acknowledge']);
});

it('ignores a delayed quit request that already settled', async () => {
  const publishedBefore = app.backend.calls('PublishDockedPanels').length;

  await settleQuit();
  await requestQuit();

  expect(app.backend.calls('AcknowledgeApplicationQuitPreflight')).toEqual([]);
  expect(app.backend.calls('PublishDockedPanels')).toHaveLength(publishedBefore);
});

it('settles a quit during publication without sending a stale approval', async () => {
  const publish = app.backend.hold('PublishDockedPanels');
  await rearrange();

  await requestQuit();
  await settleQuit();
  await click(editButton());
  await act(async () => publish());
  await app.settle();

  expect(editButton().textContent).toBe('1');
  expect(app.backend.calls('AcknowledgeApplicationQuitPreflight')).toEqual([]);
});

it('ignores quit requests and settlements addressed to another window', async () => {
  await requestQuit('workspace-2');
  expect(app.backend.calls('AcknowledgeApplicationQuitPreflight')).toEqual([]);

  await requestQuit();
  await settleQuit('workspace-2');
  await click(editButton());

  expect(editButton().textContent).toBe('0');
});
