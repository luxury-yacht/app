/**
 * frontend/src/shared/components/kubernetes/ActionsMenu.test.tsx
 *
 * Test suite for ActionsMenu. After F1 the menu delegates execution + modals to
 * the shared object action controller, so these tests drive the real controller
 * (mocking only the backend objectActionClient) and assert the run* calls plus
 * the panel lifecycle callbacks (onAfterDelete / onAfterAction).
 */

import { OBJECT_ACTION_IDS } from '@shared/actions/objectActionContract';
import type { ObjectActionData } from '@shared/hooks/useObjectActions';
import type React from 'react';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventBus } from '@/core/events';
import { requireValue } from '@/test-utils/requireValue';
import { ActionsMenu } from './ActionsMenu';

const openWithObjectMock = vi.hoisted(() => vi.fn());

// Backend action client spies. The controller calls these to execute actions;
// asserting them proves the menu now runs actions through the shared path.
const runObjectRestartMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const runObjectDeleteMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const runObjectScaleMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const runCronJobTriggerMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const runCronJobSuspendMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@shared/actions/objectActionClient', () => ({
  buildObjectActionTarget: (object: ObjectActionData, action: string) => ({
    clusterId: object.clusterId,
    group: object.group ?? '',
    version: object.version ?? 'v1',
    kind: object.kind,
    namespace: object.namespace,
    name: object.name,
    action,
  }),
  runObjectRestart: (...args: unknown[]) => runObjectRestartMock(...args),
  runObjectDelete: (...args: unknown[]) => runObjectDeleteMock(...args),
  runObjectScale: (...args: unknown[]) => runObjectScaleMock(...args),
  runCronJobTrigger: (...args: unknown[]) => runCronJobTriggerMock(...args),
  runCronJobSuspend: (...args: unknown[]) => runCronJobSuspendMock(...args),
}));

// Spy-backed permission mock so tests can assert that getPermissionKey is
// called with the full GVK (regression: PR #139 made the backend reject
// queries without apiVersion, and CRD lookups in the shared action path
// silently missed the permission map when group/version weren't threaded through).
const getPermissionKeySpy = vi.fn(
  (
    kind: string,
    verb: string,
    namespace?: string | null,
    subresource?: string | null,
    _clusterId?: string | null,
    group?: string | null,
    version?: string | null
  ) => `${group ?? ''}/${version ?? ''}|${kind}:${verb}:${namespace ?? ''}:${subresource ?? ''}`
);

vi.mock('@/core/capabilities', () => ({
  useUserPermissions: () => {
    // Return a map that grants all permissions by default
    const map = new Map();
    map.get = () => ({ allowed: true, pending: false });
    return map;
  },
  getPermissionKey: (...args: Parameters<typeof getPermissionKeySpy>) =>
    getPermissionKeySpy(...args),
  queryKindPermissions: vi.fn(),
}));

vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => ({
    openWithObject: openWithObjectMock,
  }),
}));

vi.mock('@core/contexts/ZoomContext', () => ({
  useZoom: () => ({ zoomLevel: 100 }),
}));

vi.mock('@shared/hooks/useNavigateToView', () => ({
  useNavigateToView: () => ({ navigateToView: vi.fn() }),
}));

// Mock keyboard shortcuts for ConfirmationModal
vi.mock('@ui/shortcuts', () => ({
  useShortcut: vi.fn(),
  useKeyboardSurface: vi.fn(),
  useKeyboardContext: () => ({
    registerShortcut: vi.fn(),
    unregisterShortcut: vi.fn(),
    getAvailableShortcuts: vi.fn(() => []),
    isShortcutAvailable: vi.fn(() => false),
    setEnabled: vi.fn(),
    isEnabled: true,
    registerSurface: vi.fn(),
    unregisterSurface: vi.fn(),
    updateSurface: vi.fn(),
    dispatchNativeAction: vi.fn(() => false),
    hasActiveBlockingSurface: vi.fn(() => false),
  }),
}));

const openMenu = (container: HTMLElement) => {
  const trigger = container.querySelector<HTMLButtonElement>('.actions-menu-button');
  act(() => {
    requireValue(trigger, 'expected actions menu trigger').dispatchEvent(
      new MouseEvent('click', { bubbles: true })
    );
  });
};

const clickMenuItem = (_container: HTMLElement, text: string) => {
  const items = Array.from(document.body.querySelectorAll<HTMLElement>('.context-menu-item'));
  const item = items.find((entry) => entry.textContent?.includes(text));
  act(() => {
    requireValue(item, `expected menu item "${text}"`).dispatchEvent(
      new MouseEvent('click', { bubbles: true })
    );
  });
};

// Confirm a portaled ConfirmationModal by its exact button text.
const confirmModal = async (buttonText: string) => {
  const modal = document.querySelector<HTMLElement>('.confirmation-modal');
  const confirmationModal = requireValue(modal, `expected confirmation modal for "${buttonText}"`);
  const button = Array.from(confirmationModal.querySelectorAll<HTMLButtonElement>('button')).find(
    (entry) => entry.textContent === buttonText
  );
  await act(async () => {
    requireValue(button, `expected confirm button "${buttonText}"`).dispatchEvent(
      new MouseEvent('click', { bubbles: true })
    );
    await Promise.resolve();
  });
};

const makeObject = (kind: string, overrides?: Partial<ObjectActionData>): ObjectActionData => ({
  kind,
  name: 'test-resource',
  namespace: 'default',
  clusterId: 'cluster-1',
  ...overrides,
});

describe('ActionsMenu', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  const renderMenu = async (props: React.ComponentProps<typeof ActionsMenu>) => {
    await act(async () => {
      root.render(<ActionsMenu {...props} />);
      await Promise.resolve();
    });
  };

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    getPermissionKeySpy.mockClear();
    openWithObjectMock.mockClear();
    runObjectRestartMock.mockClear();
    runObjectDeleteMock.mockClear();
    runObjectScaleMock.mockClear();
    runCronJobTriggerMock.mockClear();
    runCronJobSuspendMock.mockClear();
  });

  afterEach(() => {
    eventBus.clear();
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('renders available actions as native menu buttons', async () => {
    await renderMenu({ object: makeObject('Deployment', { group: 'apps', version: 'v1' }) });

    openMenu(container);

    const menu = document.body.querySelector('[role="menu"]');
    const items = document.body.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]');
    expect(menu).toBeTruthy();
    expect(items.length).toBeGreaterThan(0);
    expect(Array.from(items).every((item) => item.type === 'button')).toBe(true);
  });

  it('renders the open menu outside the panel scroll container', async () => {
    await renderMenu({ object: makeObject('Node') });

    openMenu(container);

    const menu = document.body.querySelector<HTMLElement>('.context-menu');
    expect(menu).toBeTruthy();
    expect(container.contains(menu)).toBe(false);
  });

  it('does not render when object is null', async () => {
    await renderMenu({ object: null });
    expect(container.innerHTML).toBe('');
  });

  it('threads group/version into the delete permission lookup for CRDs', async () => {
    // Regression: PR #139 made permission keys include group/version. CRD
    // kinds aren't in the auto-resolve table, so the hook MUST forward
    // group/version on the descriptor or the lookup key won't match the
    // spec-emit key from queryKindPermissions and the Delete menu item
    // silently disappears for CRDs.
    await renderMenu({
      object: makeObject('DBInstance', {
        group: 'rds.services.k8s.aws',
        version: 'v1alpha1',
      }),
    });

    const deleteCalls = getPermissionKeySpy.mock.calls.filter(
      (call) => call[0] === 'DBInstance' && call[1] === 'delete'
    );
    expect(deleteCalls.length).toBeGreaterThan(0);
    for (const call of deleteCalls) {
      // 6th and 7th positional args are group and version.
      expect(call[5]).toBe('rds.services.k8s.aws');
      expect(call[6]).toBe('v1alpha1');
    }

    // Sanity check: the Pod portforward lookup is hardcoded to core/v1
    // regardless of the surrounding object's GVK.
    const portForwardCalls = getPermissionKeySpy.mock.calls.filter(
      (call) => call[0] === 'Pod' && call[3] === 'portforward'
    );
    for (const call of portForwardCalls) {
      expect(call[5]).toBe('');
      expect(call[6]).toBe('v1');
    }
  });

  it('confirms restart through the controller and runs the backend restart', async () => {
    const onAfterAction = vi.fn();

    await renderMenu({
      object: makeObject('Deployment', { group: 'apps', version: 'v1' }),
      onAfterAction,
    });

    openMenu(container);
    clickMenuItem(container, 'Restart');
    await confirmModal('Restart');

    expect(runObjectRestartMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'Deployment', name: 'test-resource', action: 'restart' })
    );
    expect(onAfterAction).toHaveBeenCalled();
  });

  it('confirms delete through the controller, runs the backend delete, and signals close', async () => {
    const onAfterDelete = vi.fn();

    await renderMenu({ object: makeObject('Deployment'), onAfterDelete });

    openMenu(container);
    const deleteItem = document.body.querySelector<HTMLElement>('.context-menu-item.danger');
    expect(deleteItem).toBeTruthy();
    act(() => {
      deleteItem?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await confirmModal('Delete');

    expect(runObjectDeleteMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'Deployment', name: 'test-resource', action: 'delete' })
    );
    expect(onAfterDelete).toHaveBeenCalled();
  });

  it('opens the scale modal, updates replicas, and applies the change', async () => {
    const onAfterAction = vi.fn();

    await renderMenu({
      object: makeObject('Deployment', { group: 'apps', version: 'v1', hpaManaged: false }),
      currentReplicas: 3,
      onAfterAction,
    });

    openMenu(container);
    clickMenuItem(container, 'Scale');

    const modal = document.querySelector('.scale-modal');
    expect(modal).toBeTruthy();
    const input = modal?.querySelector<HTMLInputElement>('[id$="-scale-replicas"]');
    expect(input?.value).toBe('3');

    const onChange = (() => {
      if (!input) {
        return undefined;
      }
      const fiberKey = Object.keys(input).find((key) => key.startsWith('__reactFiber$'));
      const fiber = fiberKey
        ? (input as HTMLInputElement & Record<string, unknown>)[fiberKey]
        : undefined;
      return (fiber as { memoizedProps?: { onChange?: (event: unknown) => void } } | undefined)
        ?.memoizedProps?.onChange;
    })();
    expect(typeof onChange).toBe('function');

    await act(async () => {
      requireValue(input, 'expected test value in ActionsMenu.test.tsx').value = '7';
      onChange?.({ target: { value: '7' } });
      await Promise.resolve();
    });

    const scaleButton = modal?.querySelector<HTMLButtonElement>('.button.warning');
    await act(async () => {
      scaleButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(runObjectScaleMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'Deployment', action: 'scale' }),
      7
    );
    expect(onAfterAction).toHaveBeenCalled();
  });

  it('opens the scale modal with the row desired replica count when no explicit count is passed', async () => {
    await renderMenu({
      object: makeObject('Deployment', { ready: '2/6', hpaManaged: false }),
    });

    openMenu(container);
    clickMenuItem(container, 'Scale');

    const input = document.querySelector<HTMLInputElement>('[id$="-scale-replicas"]');
    expect(input?.value).toBe('6');
  });

  it('confirms before scaling HPA-managed workloads to zero from the menu', async () => {
    await renderMenu({
      object: makeObject('Deployment', { ready: '2/4', hpaManaged: true }),
    });

    openMenu(container);
    const items = Array.from(document.body.querySelectorAll<HTMLElement>('.context-menu-item'));
    const scaleToZeroItem = items.find((item) => item.textContent?.includes('Scale to 0'));
    expect(scaleToZeroItem).toBeTruthy();
    expect(items.some((item) => item.textContent?.includes('Resume from 0'))).toBe(false);

    act(() => {
      scaleToZeroItem?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(runObjectScaleMock).not.toHaveBeenCalled();
    expect(document.querySelector('.scale-modal')).toBeNull();
    const confirmation = document.querySelector<HTMLElement>('.confirmation-modal');
    expect(confirmation?.textContent).toContain('Scale to 0');

    await confirmModal('Scale to 0');

    expect(runObjectScaleMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'Deployment', action: 'scale' }),
      0
    );
  });

  it('shows only Scale to 0 for HPA-managed workloads above zero', async () => {
    await renderMenu({
      object: makeObject('Deployment', { ready: '2/4', hpaManaged: true }),
    });

    openMenu(container);
    const items = Array.from(document.body.querySelectorAll<HTMLElement>('.context-menu-item'));

    expect(items.some((item) => item.textContent?.includes('Scale to 0'))).toBe(true);
    expect(items.some((item) => item.textContent?.includes('Resume from 0'))).toBe(false);
  });

  it('confirms before scaling a regular workload to zero from the scale modal', async () => {
    await renderMenu({
      object: makeObject('Deployment', { ready: '2/4', hpaManaged: false }),
    });

    openMenu(container);
    clickMenuItem(container, 'Scale');

    const scaleToZeroButton = Array.from(
      document.querySelectorAll<HTMLButtonElement>('button')
    ).find((button) => button.textContent === 'Scale to 0');

    act(() => {
      scaleToZeroButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(runObjectScaleMock).not.toHaveBeenCalled();
    const confirmation = document.querySelector<HTMLElement>('.confirmation-modal');
    expect(confirmation?.textContent).toContain('Scale to 0');

    await confirmModal('Scale to 0');

    expect(runObjectScaleMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'Deployment', action: 'scale' }),
      0
    );
  });

  it('resumes HPA-managed workloads from zero from the menu', async () => {
    await renderMenu({
      object: makeObject('Deployment', { ready: '0/0', hpaManaged: true }),
    });

    openMenu(container);
    const items = Array.from(document.body.querySelectorAll<HTMLElement>('.context-menu-item'));
    const resumeItem = items.find((item) => item.textContent?.includes('Resume from 0'));
    expect(resumeItem).toBeTruthy();
    expect(items.some((item) => item.textContent?.includes('Scale to 0'))).toBe(false);

    await act(async () => {
      resumeItem?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(runObjectScaleMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'Deployment', action: 'scale' }),
      1
    );
  });

  it('uses currentReplicas when choosing the HPA-managed menu action', async () => {
    await renderMenu({
      object: makeObject('Deployment', { hpaManaged: true }),
      currentReplicas: 4,
    });

    openMenu(container);
    const items = Array.from(document.body.querySelectorAll<HTMLElement>('.context-menu-item'));

    expect(items.some((item) => item.textContent?.includes('Scale to 0'))).toBe(true);
    expect(items.some((item) => item.textContent?.includes('Resume from 0'))).toBe(false);
  });

  it('shows Resume from 0 when currentReplicas is zero', async () => {
    await renderMenu({
      object: makeObject('Deployment', { ready: '0/4', hpaManaged: true }),
      currentReplicas: 0,
    });

    openMenu(container);
    const items = Array.from(document.body.querySelectorAll<HTMLElement>('.context-menu-item'));

    expect(items.some((item) => item.textContent?.includes('Resume from 0'))).toBe(true);
    expect(items.some((item) => item.textContent?.includes('Scale to 0'))).toBe(false);
  });

  it('closes the menu when clicking outside', async () => {
    await renderMenu({
      object: makeObject('Deployment'),
    });

    openMenu(container);
    expect(document.body.querySelector('.context-menu')).toBeTruthy();

    act(() => {
      document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });

    expect(document.body.querySelector('.context-menu')).toBeNull();
  });

  it('does not show Scale while HPA ownership is unknown', async () => {
    await renderMenu({
      object: makeObject('Deployment', { ready: '2/4' }),
    });

    openMenu(container);
    const items = Array.from(document.body.querySelectorAll<HTMLElement>('.context-menu-item'));

    expect(items.some((item) => item.textContent === 'Scale')).toBe(false);
    expect(items.some((item) => item.textContent?.includes('Scale to 0'))).toBe(false);
    expect(items.some((item) => item.textContent?.includes('Resume from 0'))).toBe(false);
  });

  it('shows port forward action for Pod', async () => {
    await renderMenu({
      object: makeObject('Pod'),
    });

    openMenu(container);
    const items = Array.from(document.body.querySelectorAll<HTMLElement>('.context-menu-item'));
    const portForwardItem = items.find((item) => item.textContent?.includes('Port Forward'));
    expect(portForwardItem).toBeTruthy();
  });

  it('renders port forward as disabled when the target is unavailable', async () => {
    await renderMenu({
      object: makeObject('Pod', {
        clusterId: undefined,
      }),
    });

    openMenu(container);
    const items = Array.from(document.body.querySelectorAll<HTMLElement>('.context-menu-item'));
    const portForwardItem = items.find((item) => item.textContent?.includes('Port Forward'));
    expect(portForwardItem).toBeTruthy();
    expect(portForwardItem?.className).toContain('disabled');
    expect(portForwardItem?.textContent).toContain('Port Forward');
  });

  it('renders port forward as disabled when the target has no forwardable ports', async () => {
    await renderMenu({
      object: makeObject('Pod', {
        portForwardAvailable: false,
      }),
    });

    openMenu(container);
    const items = Array.from(document.body.querySelectorAll<HTMLElement>('.context-menu-item'));
    const portForwardItem = items.find((item) => item.textContent?.includes('Port Forward'));
    expect(portForwardItem).toBeTruthy();
    expect(portForwardItem?.className).toContain('disabled');
    expect(portForwardItem?.textContent).toContain('Port Forward');
  });

  it('shows Diff in the actions menu and emits an object-diff request', async () => {
    await renderMenu({
      object: makeObject('Deployment', {
        group: 'apps',
        version: 'v1',
      }),
    });

    let payload: unknown;
    const unsubscribe = eventBus.on('view:open-object-diff', (next) => {
      payload = next;
    });

    openMenu(container);
    const items = Array.from(document.body.querySelectorAll<HTMLElement>('.context-menu-item'));
    const diffItem = items.find((item) => item.textContent?.includes('Diff'));
    expect(diffItem).toBeTruthy();

    act(() => {
      diffItem?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    unsubscribe();

    expect(payload).toMatchObject({
      left: {
        clusterId: 'cluster-1',
        namespace: 'default',
        group: 'apps',
        version: 'v1',
        kind: 'Deployment',
        name: 'test-resource',
      },
    });
  });

  it('shows the map panel action for supported objects and opens the map tab', async () => {
    await renderMenu({
      object: makeObject('ConfigMap', {
        group: '',
        version: 'v1',
      }),
    });

    openMenu(container);
    const objectMapItem = document.body.querySelector<HTMLElement>(
      `[data-context-action-id="${OBJECT_ACTION_IDS.viewMap}"]`
    );
    expect(objectMapItem).toBeTruthy();

    act(() => {
      objectMapItem?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(openWithObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'ConfigMap',
        name: 'test-resource',
        namespace: 'default',
        clusterId: 'cluster-1',
        group: '',
        version: 'v1',
      }),
      { initialTab: 'map' }
    );
    expect(document.body.querySelector('.context-menu')).toBeNull();
  });

  describe('CronJob actions', () => {
    it('shows trigger and suspend actions for CronJob', async () => {
      await renderMenu({
        object: makeObject('CronJob'),
      });

      openMenu(container);
      const items = Array.from(document.body.querySelectorAll<HTMLElement>('.context-menu-item'));

      const triggerItem = items.find((item) => item.textContent?.includes('Trigger Now'));
      const suspendItem = items.find((item) => item.textContent?.includes('Suspend'));

      expect(triggerItem).toBeTruthy();
      expect(suspendItem).toBeTruthy();
    });

    it('shows Resume instead of Suspend when status is Suspended', async () => {
      await renderMenu({
        object: makeObject('CronJob', { status: 'Suspended' }),
      });

      openMenu(container);
      const items = Array.from(document.body.querySelectorAll<HTMLElement>('.context-menu-item'));

      const resumeItem = items.find((item) => item.textContent?.includes('Resume'));
      const suspendItem = items.find((item) => item.textContent?.includes('Suspend'));

      expect(resumeItem).toBeTruthy();
      expect(suspendItem).toBeFalsy();
    });

    it('disables trigger when CronJob is suspended', async () => {
      await renderMenu({
        object: makeObject('CronJob', { status: 'Suspended' }),
      });

      openMenu(container);
      const items = Array.from(document.body.querySelectorAll<HTMLElement>('.context-menu-item'));
      const triggerItem = items.find((item) => item.textContent?.includes('Trigger Now'));
      expect(triggerItem?.classList.contains('disabled')).toBe(true);
    });

    it('runs the backend suspend when suspend is clicked', async () => {
      const onAfterAction = vi.fn();

      await renderMenu({
        object: makeObject('CronJob', { group: 'batch', version: 'v1' }),
        onAfterAction,
      });

      openMenu(container);
      clickMenuItem(container, 'Suspend');

      await act(async () => {
        await Promise.resolve();
      });

      expect(runCronJobSuspendMock).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'CronJob', action: 'suspend' }),
        true
      );
      expect(onAfterAction).toHaveBeenCalled();
    });

    it('shows trigger confirmation modal and runs the backend trigger when confirmed', async () => {
      const onAfterAction = vi.fn();

      await renderMenu({
        object: makeObject('CronJob', { group: 'batch', version: 'v1' }),
        onAfterAction,
      });

      openMenu(container);
      clickMenuItem(container, 'Trigger Now');

      // Modal is portaled to document.body, not the container
      const modal = document.querySelector('.modal-container');
      expect(modal).toBeTruthy();

      const confirmBtn = modal?.querySelector<HTMLButtonElement>('.button:not(.cancel)');
      await act(async () => {
        confirmBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await Promise.resolve();
      });

      expect(runCronJobTriggerMock).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'CronJob', action: 'trigger' })
      );
      expect(onAfterAction).toHaveBeenCalled();
    });
  });
});
