import { act, useState } from 'react';
import { createPortal } from 'react-dom';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ClusterClosePreparation } from '@/modules/kubernetes/config/KubeconfigContext';
import { requireValue } from '@/test-utils/requireValue';
import {
  PanelLifecycleClusterSurface,
  PanelLifecycleGuardProvider,
  usePanelLifecycleGuard,
} from './panelLifecycleGuards';
import { WorkspacePanelLifecycle } from './WorkspacePanelLifecycle';

const mocks = vi.hoisted(() => ({
  close: vi.fn(async () => false),
  flush: vi.fn<() => Promise<void>>(async () => undefined),
  preflight: null as null | ((clusterId: string) => Promise<ClusterClosePreparation | null>),
  resume: vi.fn(),
  focus: vi.fn(async () => undefined),
  windowClose: vi.fn(async () => undefined),
  quit: vi.fn(async () => undefined),
  handlers: {} as Record<string, (event: never) => void>,
}));
vi.mock('./index', () => {
  const on = (name: string) => (handler: (event: never) => void) => {
    mocks.handlers[name] = handler;
    return () => undefined;
  };
  return {
    closeClusterView: mocks.close,
    acknowledgeWorkspaceWindowClose: mocks.windowClose,
    acknowledgeApplicationQuitPreflight: mocks.quit,
    onWorkspaceCloseRequested: on('windowClose'),
    onApplicationQuitPreflightRequested: on('quit'),
    onApplicationQuitPreflightSettled: on('quitSettled'),
  };
});
vi.mock('./WorkspacePanelSync', () => ({
  usePanelWorkspaceSync: () => ({
    flush: mocks.flush,
    quiesceCluster: async () => {
      await mocks.flush();
      return mocks.resume;
    },
  }),
}));
vi.mock('@/core/desktop-runtime', () => ({
  getWindowIdentity: () => 'app-a',
  focusWindow: mocks.focus,
}));
vi.mock('@/modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({
    selectedClusterIds: ['production'],
    registerClusterClosePreflight: (
      preflight: (clusterId: string) => Promise<ClusterClosePreparation | null>
    ) => {
      mocks.preflight = preflight;
      return () => undefined;
    },
  }),
}));
vi.mock('@/modules/object-panel/contexts/ObjectPanelStateContext', () => ({
  useObjectPanelState: () => ({
    panelIdsForCluster: () => ['pod'],
    getOwnedPanel: () => ({ nativeLocation: null }),
  }),
}));
vi.mock('@/ui/dockable', () => ({ useDockablePanelContext: () => ({ focusPanel: vi.fn() }) }));

function EditablePanel() {
  const [edits, setEdits] = useState(0);
  usePanelLifecycleGuard('pod', () =>
    edits ? { reason: 'unsaved-yaml', focus: () => undefined } : null
  );
  return (
    <PanelLifecycleClusterSurface clusterId="production">
      <button type="button" onClick={() => setEdits((value) => value + 1)}>
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

let root: ReactDOM.Root;
let container: HTMLDivElement;
beforeEach(async () => {
  vi.resetAllMocks();
  mocks.close.mockResolvedValue(false);
  mocks.flush.mockResolvedValue(undefined);
  container = document.createElement('div');
  document.body.append(container);
  root = ReactDOM.createRoot(container);
  await act(async () =>
    root.render(
      <PanelLifecycleGuardProvider>
        <WorkspacePanelLifecycle />
        <EditablePanel />
      </PanelLifecycleGuardProvider>
    )
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

it('closes a cluster without a full-window overlay or blocking unrelated input', async () => {
  let publish: () => void = () => undefined;
  mocks.flush.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        publish = resolve;
      })
  );
  const unrelated = document.createElement('button');
  unrelated.dataset.panelLifecycleCluster = 'staging';
  const click = vi.fn();
  unrelated.addEventListener('click', click);
  container.append(unrelated);
  let closing = Promise.resolve<ClusterClosePreparation | null>(null);
  act(() => {
    closing = requireValue(mocks.preflight, 'Close must be registered')('production');
  });
  unrelated.click();
  const overlay = container.querySelector('.panel-transfer-status');
  await act(async () => {
    publish();
    await closing;
  });
  expect(overlay).toBeNull();
  expect(click).toHaveBeenCalledOnce();
});

it('blocks edits during publication and releases input when cluster close is denied', async () => {
  let publish: () => void = () => undefined;
  mocks.flush.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        publish = resolve;
      })
  );
  const preflight = requireValue(mocks.preflight, 'Cluster preflight must be registered');
  let closing = Promise.resolve<ClusterClosePreparation | null>(null);
  act(() => {
    closing = preflight('production');
  });
  const edit = requireValue(container.querySelector('button'), 'Editable panel must be mounted');
  await act(async () => edit.click());
  const portal = requireValue(
    document.querySelector<HTMLButtonElement>('[data-testid="portal-edit"]'),
    'Portal editor must exist'
  );
  await act(async () => portal.click());
  const editsDuringPublication = edit.textContent;
  await act(async () => {
    publish();
    expect(await closing).toBeNull();
  });
  expect(editsDuringPublication).toBe('0');
  await act(async () => edit.click());
  expect(edit.textContent).toBe('1');
});

it('keeps the affected cluster guarded after native approval until the selection lease releases', async () => {
  mocks.close.mockResolvedValueOnce(true);
  let preparation: ClusterClosePreparation | null = null;
  await act(async () => {
    preparation = await requireValue(mocks.preflight, 'Close must be registered')('production');
  });
  const edit = requireValue(container.querySelector('button'), 'Editable panel must be mounted');
  await act(async () => edit.click());
  expect(edit.textContent).toBe('0');
  expect(mocks.resume).not.toHaveBeenCalled();
  expect(container.querySelector('.panel-transfer-status')).toBeNull();
  await act(async () =>
    requireValue(preparation, 'Approved close must return its lease').release()
  );
  expect(mocks.resume).toHaveBeenCalledWith(true);
  await act(async () => edit.click());
  expect(edit.textContent).toBe('1');
});

it('releases input when publication fails without requesting native closure', async () => {
  const failure = new Error('publication failed');
  mocks.flush.mockRejectedValueOnce(failure);
  await act(async () => {
    await expect(
      requireValue(mocks.preflight, 'Cluster preflight must be registered')('production')
    ).rejects.toThrow(failure);
  });
  expect(mocks.close).not.toHaveBeenCalled();
  const edit = requireValue(container.querySelector('button'), 'Editable panel must be mounted');
  await act(async () => edit.click());
  expect(edit.textContent).toBe('1');
});

it.each(['windowClose', 'quit'])('blocks edits while %s waits for publication', async (action) => {
  let publish: () => void = () => undefined;
  mocks.flush.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        publish = resolve;
      })
  );
  act(() => mocks.handlers[action]({ windowName: 'app-a', transactionId: 'quit-1' } as never));
  const edit = requireValue(container.querySelector('button'), 'Editable panel must be mounted');
  await act(async () => edit.click());
  const edits = edit.textContent;
  await act(async () => {
    publish();
  });
  expect(edits).toBe('0');
});

it('keeps quit approval frozen until the backend settles all renderers', async () => {
  const event = { windowName: 'app-a', transactionId: 'quit-1' };
  await act(async () => mocks.handlers.quit(event as never));
  expect(mocks.quit).toHaveBeenCalledWith('app-a', 'quit-1', true);
  const edit = requireValue(container.querySelector('button'), 'Editable panel must be mounted');
  await act(async () => edit.click());
  const editsBeforeSettlement = edit.textContent;
  await act(async () => mocks.handlers.quitSettled?.(event as never));
  await act(async () => edit.click());
  expect(editsBeforeSettlement).toBe('0');
  expect(edit.textContent).toBe('1');
});

it('keeps existing unsaved edits open without publishing or closing', async () => {
  const edit = requireValue(container.querySelector('button'), 'Editable panel must be mounted');
  await act(async () => edit.click());
  await act(async () => {
    expect(
      await requireValue(mocks.preflight, 'Cluster preflight must be registered')('production')
    ).toBeNull();
  });
  expect(mocks.flush).not.toHaveBeenCalled();
  expect(mocks.close).not.toHaveBeenCalled();
  expect(edit.textContent).toBe('1');
});

it('releases input after a rejected quit acknowledgement', async () => {
  mocks.quit.mockRejectedValueOnce(new Error('acknowledgement failed'));
  await act(async () =>
    mocks.handlers.quit({ windowName: 'app-a', transactionId: 'quit-1' } as never)
  );
  const edit = requireValue(container.querySelector('button'), 'Editable panel must be mounted');
  await act(async () => edit.click());
  expect(edit.textContent).toBe('1');
});

it('ignores a delayed quit request that already settled', async () => {
  const event = { windowName: 'app-a', transactionId: 'quit-1' };
  await act(async () => mocks.handlers.quitSettled(event as never));
  await act(async () => mocks.handlers.quit(event as never));
  expect(mocks.quit).not.toHaveBeenCalled();
  expect(mocks.flush).not.toHaveBeenCalled();
});

it('settles a quit during publication without sending a stale approval', async () => {
  let publish: () => void = () => undefined;
  mocks.flush.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        publish = resolve;
      })
  );
  const event = { windowName: 'app-a', transactionId: 'quit-1' };
  act(() => mocks.handlers.quit(event as never));
  await act(async () => mocks.handlers.quitSettled(event as never));
  const edit = requireValue(container.querySelector('button'), 'Editable panel must be mounted');
  await act(async () => edit.click());
  await act(async () => {
    publish();
  });
  expect(edit.textContent).toBe('1');
  expect(mocks.quit).not.toHaveBeenCalled();
});

it('ignores another window’s quit request and settlement', async () => {
  await act(async () =>
    mocks.handlers.quit({ windowName: 'app-b', transactionId: 'quit-1' } as never)
  );
  expect(mocks.quit).not.toHaveBeenCalled();
  await act(async () =>
    mocks.handlers.quit({ windowName: 'app-a', transactionId: 'quit-1' } as never)
  );
  await act(async () =>
    mocks.handlers.quitSettled({ windowName: 'app-b', transactionId: 'quit-1' } as never)
  );
  const edit = requireValue(container.querySelector('button'), 'Editable panel must be mounted');
  await act(async () => edit.click());
  expect(edit.textContent).toBe('0');
});
