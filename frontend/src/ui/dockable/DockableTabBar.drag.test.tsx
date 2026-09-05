/**
 * frontend/src/ui/dockable/DockableTabBar.drag.test.tsx
 *
 * Provider-integrated drag/drop tests for DockableTabBar. Drives the
 * native HTML5 drag-and-drop lifecycle directly — dispatch `dragstart`
 * on a `[role="tab"]` source, `dragover` + `drop` on the target bar's
 * drop zone, and assert against `ctx.tabGroups`.
 */

import type React from 'react';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireValue } from '@/test-utils/requireValue';

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: vi.fn(() => ({
    selectedClusterId: 'cluster-a',
    selectedClusterIds: ['cluster-a'],
  })),
}));

import { TAB_DRAG_DATA_TYPE } from '@shared/components/tabs/dragCoordinator';
import { DockablePanelProvider, useDockablePanelContext } from './DockablePanelProvider';
import { DockableTabBar } from './DockableTabBar';

const renderWithProvider = async (
  ui: React.ReactElement,
  options: Omit<React.ComponentProps<typeof DockablePanelProvider>, 'children'> = {}
) => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = ReactDOM.createRoot(host);

  await act(async () => {
    root.render(<DockablePanelProvider {...options}>{ui}</DockablePanelProvider>);
    await Promise.resolve();
  });

  return {
    host,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      host.remove();
    },
  };
};

const setRect = (element: Element, left: number, right: number, top = 0, bottom = 28) => {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      x: left,
      y: top,
      left,
      right,
      top,
      bottom,
      width: right - left,
      height: bottom - top,
      toJSON: () => ({}),
    }),
  });
};

/**
 * Minimal DataTransfer polyfill: jsdom doesn't implement DataTransfer,
 * so we use a plain Map-backed stub that satisfies the shared drag
 * coordinator's `setData` / `getData` / `setDragImage` / `dropEffect`
 * calls. The coordinator never asks for anything else.
 */
function createDataTransfer(): DataTransfer {
  const store = new Map<string, string>();
  return {
    dropEffect: 'move',
    effectAllowed: 'move',
    files: [] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    get types() {
      return [...store.keys()];
    },
    setData: (format: string, data: string) => {
      store.set(format, data);
    },
    getData: (format: string) => store.get(format) ?? '',
    clearData: () => {
      store.clear();
    },
    setDragImage: () => undefined,
  } as unknown as DataTransfer;
}

function dispatchDragEvent(
  target: EventTarget,
  type: string,
  clientX: number,
  clientY: number,
  dataTransfer: DataTransfer
) {
  const event = new Event(type, { bubbles: true, cancelable: true }) as Event & {
    clientX: number;
    clientY: number;
    dataTransfer: DataTransfer;
  };
  Object.defineProperty(event, 'clientX', { value: clientX });
  Object.defineProperty(event, 'clientY', { value: clientY });
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  target.dispatchEvent(event);
  return event;
}

const registerDockedTab = async (
  ctx: ReturnType<typeof useDockablePanelContext>,
  panelId: string,
  title: string,
  position: 'right' | 'bottom'
) => {
  await act(async () => {
    ctx.registerPanel({ panelId, title, position });
    ctx.syncPanelGroup(panelId, position);
    await Promise.resolve();
  });
};

describe('DockableTabBar drag-and-drop (provider mode)', () => {
  beforeEach(() => {
    const contentEl = document.createElement('div');
    contentEl.className = 'content';
    document.body.appendChild(contentEl);
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it.each([
    ['compatible panel', 'workspace-A', 'cluster-A', true],
    ['unrelated workspace', 'workspace-B', 'cluster-A', false],
    ['different cluster', 'workspace-A', 'cluster-B', false],
    ['case-distinct owner', 'workspace-a', 'cluster-A', false],
  ])('only offers a cross-window drop for a %s', async (_case, owner, cluster, accepted) => {
    const tab = {
      kind: 'object',
      panelId: 'panel-a',
      activeView: 'details',
      objectRef: {
        clusterId: 'cluster-A',
        group: '',
        version: 'v1',
        kind: 'Pod',
        namespace: 'default',
        name: 'pod-a',
      },
    };
    const identity = {
      windowName: 'panel-source',
      ownerWindowName: 'workspace-A',
      clusterId: 'cluster-A',
      getTabSnapshot: () => tab,
    };
    const source = await renderWithProvider(
      <DockableTabBar
        tabs={[{ panelId: 'panel-a', title: 'Pod A' }]}
        activeTab="panel-a"
        onTabClick={() => undefined}
        groupKey="right"
      />,
      { tabDragIdentity: identity }
    );
    const onExternalTabDrop = vi.fn();
    const target = await renderWithProvider(
      <DockableTabBar tabs={[]} activeTab={null} onTabClick={() => undefined} groupKey="right" />,
      {
        tabDragIdentity: {
          ...identity,
          windowName: 'panel-target',
          ownerWindowName: String(owner),
          clusterId: String(cluster),
        },
        onExternalTabDrop,
      }
    );
    try {
      const transfer = createDataTransfer();
      const sourceTab = requireValue(source.host.querySelector('[role="tab"]'), 'source tab');
      const targetBar = requireValue(
        target.host.querySelector('.dockable-tab-bar-shell'),
        'target bar'
      );
      await act(async () => {
        dispatchDragEvent(sourceTab, 'dragstart', 20, 10, transfer);
      });
      // Native dragover exposes lower-cased MIME types, but cannot read their values.
      const protectedTransfer = {
        types: transfer.types.map((type) => type.toLowerCase()),
        getData: vi.fn(() => ''),
        dropEffect: 'none',
      };
      let over: Event | undefined;
      await act(async () => {
        dispatchDragEvent(
          targetBar,
          'dragenter',
          20,
          10,
          protectedTransfer as unknown as DataTransfer
        );
        over = dispatchDragEvent(
          targetBar,
          'dragover',
          20,
          10,
          protectedTransfer as unknown as DataTransfer
        );
      });
      expect(over?.defaultPrevented).toBe(accepted);
      expect(protectedTransfer.dropEffect).toBe(accepted ? 'move' : 'none');
      expect(protectedTransfer.getData).not.toHaveBeenCalled();
      await act(async () => {
        dispatchDragEvent(targetBar, 'drop', 20, 10, transfer);
      });
      expect(onExternalTabDrop).toHaveBeenCalledTimes(accepted ? 1 : 0);
    } finally {
      await source.unmount();
      await target.unmount();
    }
  });

  it('updates the drag preview label when a tab begins dragging', async () => {
    const ctxRef: { current: ReturnType<typeof useDockablePanelContext> | null } = {
      current: null,
    };

    const Harness: React.FC = () => {
      const ctx = useDockablePanelContext();
      ctxRef.current = ctx;
      const rightTabs = ctx.tabGroups.right.tabs.map((panelId) => ({
        panelId,
        title: ctx.panelRegistrations.get(panelId)?.title ?? panelId,
      }));
      return (
        <DockableTabBar
          tabs={rightTabs}
          activeTab={ctx.tabGroups.right.activeTab}
          onTabClick={() => undefined}
          groupKey="right"
        />
      );
    };

    const { host, unmount } = await renderWithProvider(<Harness />);

    await registerDockedTab(
      requireValue(ctxRef.current, 'expected test value in DockableTabBar.drag.test.tsx'),
      'p1',
      'Logs',
      'right'
    );

    const tab = host.querySelector('[role="tab"]') as HTMLElement;
    const dataTransfer = createDataTransfer();

    await act(async () => {
      dispatchDragEvent(tab, 'dragstart', 20, 10, dataTransfer);
    });

    // The preview element is always mounted. Its label should now
    // reflect the dragged tab's title (written by getDragImage).
    const preview = document.querySelector('.dockable-tab-drag-preview') as HTMLElement;
    expect(preview).toBeTruthy();
    const previewLabel = preview.querySelector('.dockable-tab-drag-preview__label');
    expect(previewLabel?.textContent).toBe('Logs');

    // The serialized payload should include the dockable-tab kind + the
    // panel id + the source group id.
    expect(dataTransfer.getData(TAB_DRAG_DATA_TYPE)).toContain('p1');
    expect(dataTransfer.getData(TAB_DRAG_DATA_TYPE)).toContain('right');

    await unmount();
  });

  it('reorders tabs within the same group on drop', async () => {
    const ctxRef: { current: ReturnType<typeof useDockablePanelContext> | null } = {
      current: null,
    };

    const Harness: React.FC = () => {
      const ctx = useDockablePanelContext();
      ctxRef.current = ctx;
      const bottomTabs = ctx.tabGroups.bottom.tabs.map((panelId) => ({
        panelId,
        title: ctx.panelRegistrations.get(panelId)?.title ?? panelId,
      }));
      return (
        <DockableTabBar
          tabs={bottomTabs}
          activeTab={ctx.tabGroups.bottom.activeTab}
          onTabClick={() => undefined}
          groupKey="bottom"
        />
      );
    };

    const { host, unmount } = await renderWithProvider(<Harness />);

    await registerDockedTab(
      requireValue(ctxRef.current, 'expected test value in DockableTabBar.drag.test.tsx'),
      'p1',
      'One',
      'bottom'
    );
    await registerDockedTab(
      requireValue(ctxRef.current, 'expected test value in DockableTabBar.drag.test.tsx'),
      'p2',
      'Two',
      'bottom'
    );
    await registerDockedTab(
      requireValue(ctxRef.current, 'expected test value in DockableTabBar.drag.test.tsx'),
      'p3',
      'Three',
      'bottom'
    );

    const bar = host.querySelector('.dockable-tab-bar-shell') as HTMLElement;
    const tabs = host.querySelectorAll('[role="tab"]');
    const draggedTab = tabs[0] as HTMLElement;
    setRect(tabs[0], 0, 120, 0, 24);
    setRect(tabs[1], 120, 240, 0, 24);
    setRect(tabs[2], 240, 360, 0, 24);

    const dataTransfer = createDataTransfer();

    await act(async () => {
      dispatchDragEvent(draggedTab, 'dragstart', 20, 10, dataTransfer);
      // Drop past the right edge of the last tab -> insertIndex = 3
      // (tabs.length). With shift compensation (source at index 0 <
      // insertIndex 3), adjustedInsert = 2 → final order ['p2','p3','p1'].
      dispatchDragEvent(bar, 'dragover', 330, 10, dataTransfer);
      dispatchDragEvent(bar, 'drop', 330, 10, dataTransfer);
      await Promise.resolve();
    });

    expect(
      requireValue(ctxRef.current, 'expected test value in DockableTabBar.drag.test.tsx').tabGroups
        .bottom.tabs
    ).toEqual(['p2', 'p3', 'p1']);

    await unmount();
  });

  it('moves a dragged tab to a different group on cross-group drop', async () => {
    const ctxRef: { current: ReturnType<typeof useDockablePanelContext> | null } = {
      current: null,
    };

    const Harness: React.FC = () => {
      const ctx = useDockablePanelContext();
      ctxRef.current = ctx;
      const bottomTabs = ctx.tabGroups.bottom.tabs.map((panelId) => ({
        panelId,
        title: ctx.panelRegistrations.get(panelId)?.title ?? panelId,
      }));
      const rightTabs = ctx.tabGroups.right.tabs.map((panelId) => ({
        panelId,
        title: ctx.panelRegistrations.get(panelId)?.title ?? panelId,
      }));
      return (
        <>
          <DockableTabBar
            tabs={bottomTabs}
            activeTab={ctx.tabGroups.bottom.activeTab}
            onTabClick={() => undefined}
            groupKey="bottom"
          />
          <DockableTabBar
            tabs={rightTabs}
            activeTab={ctx.tabGroups.right.activeTab}
            onTabClick={() => undefined}
            groupKey="right"
          />
        </>
      );
    };

    const { host, unmount } = await renderWithProvider(<Harness />);

    await registerDockedTab(
      requireValue(ctxRef.current, 'expected test value in DockableTabBar.drag.test.tsx'),
      'p1',
      'One',
      'bottom'
    );
    await registerDockedTab(
      requireValue(ctxRef.current, 'expected test value in DockableTabBar.drag.test.tsx'),
      'p2',
      'Two',
      'bottom'
    );
    await registerDockedTab(
      requireValue(ctxRef.current, 'expected test value in DockableTabBar.drag.test.tsx'),
      'r1',
      'Right One',
      'right'
    );

    const shells = host.querySelectorAll('.dockable-tab-bar-shell');
    const bottomShell = shells[0] as HTMLElement;
    const rightShell = shells[1] as HTMLElement;
    const bottomTabs = bottomShell.querySelectorAll('[role="tab"]');
    const rightTabs = rightShell.querySelectorAll('[role="tab"]');

    setRect(bottomTabs[0], 0, 120, 0, 24);
    setRect(bottomTabs[1], 120, 240, 0, 24);
    setRect(rightTabs[0], 400, 520, 0, 24);

    const dataTransfer = createDataTransfer();

    await act(async () => {
      dispatchDragEvent(bottomTabs[0] as HTMLElement, 'dragstart', 20, 10, dataTransfer);
      dispatchDragEvent(rightShell, 'dragover', 500, 10, dataTransfer);
      dispatchDragEvent(rightShell, 'drop', 500, 10, dataTransfer);
      await Promise.resolve();
    });

    expect(
      requireValue(ctxRef.current, 'expected test value in DockableTabBar.drag.test.tsx').tabGroups
        .bottom.tabs
    ).toEqual(['p2']);
    expect(
      requireValue(ctxRef.current, 'expected test value in DockableTabBar.drag.test.tsx').tabGroups
        .right.tabs
    ).toEqual(['r1', 'p1']);

    await unmount();
  });
});
