import { TAB_DRAG_DATA_TYPE } from '@shared/components/tabs/dragCoordinator';
import {
  tabDragKindDataType,
  tabDragScopeDataType,
} from '@shared/components/tabs/dragCoordinator/types';
import type { ComponentProps, ReactNode } from 'react';
import { act } from 'react';
import { flushSync } from 'react-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installAppStateHarness, type MountedApp } from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';
import DockablePanel from './DockablePanel';
import {
  DockablePanelLayer,
  DockablePanelProvider,
  useDockablePanelContext,
} from './DockablePanelProvider';
import type { PanelLayoutStore } from './panelLayoutStore';
import { usePanelLayoutStoreContext } from './panelLayoutStoreContext';

// The dock renders inside the production shell with a real open cluster
// (test-utils/appState). Drag scopes carry that cluster's id, or the id of a
// second, known cluster for cross-cluster cases.
const app = installAppStateHarness();
const clusterIds = { open: '', other: '' };

const objectTab = () => ({
  kind: 'object',
  panelId: 'obj:a',
  activeView: 'logs',
  objectRef: {
    clusterId: clusterIds.open,
    group: '',
    version: 'v1',
    kind: 'Pod',
    namespace: 'default',
    name: 'a',
  },
});
const dragPayload = (clusterId = clusterIds.open) => ({
  kind: 'dockable-tab' as const,
  panelId: 'obj:a',
  sourceGroupId: 'right',
  sourceWindowName: 'workspace-source',
  clusterId,
  tab: objectTab(),
});

function createTransfer() {
  const data = new Map<string, string>();
  return {
    get types() {
      return [...data.keys()];
    },
    setData: (type: string, value: string) => data.set(type, value),
    getData: (type: string) => data.get(type) ?? '',
    setDragImage: vi.fn(),
    dropEffect: 'none',
    effectAllowed: 'move',
  } as unknown as DataTransfer;
}

function protectedTransfer(kind = 'dockable-tab', clusterId = clusterIds.open) {
  return {
    types: [
      TAB_DRAG_DATA_TYPE,
      tabDragKindDataType(kind as 'dockable-tab' | 'cluster-tab'),
      tabDragScopeDataType({ clusterId }),
    ],
    getData: vi.fn(() => ''),
    dropEffect: 'none',
  } as unknown as DataTransfer;
}

async function drag(target: EventTarget, type: string, dataTransfer: DataTransfer) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    dataTransfer: { value: dataTransfer },
    clientX: { value: 100 },
    clientY: { value: 100 },
    relatedTarget: { value: null },
  });
  await act(async () => {
    target.dispatchEvent(event);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return event;
}

describe('empty dock destinations', () => {
  let view: MountedApp;
  let host: HTMLElement;
  let context: ReturnType<typeof useDockablePanelContext>;
  let layoutStore: PanelLayoutStore;
  function Capture() {
    context = useDockablePanelContext();
    layoutStore = usePanelLayoutStoreContext();
    return null;
  }
  const target = (edge: 'right' | 'bottom') =>
    host.querySelector(`[data-dock-drop-target="${edge}"]`);
  const render = async (
    children?: ReactNode,
    props: Partial<ComponentProps<typeof DockablePanelProvider>> = {}
  ) => {
    await view.show(
      <DockablePanelProvider
        tabDragIdentity={{
          windowName: 'workspace-target',
          clusterId: clusterIds.open,
          getTabSnapshot: objectTab,
        }}
        {...props}
      >
        <Capture />
        <div className="content">
          <div className="content-body" />
          <DockablePanelLayer />
        </div>
        {children}
      </DockablePanelProvider>
    );
    requireValue(host.querySelector('.content'), 'content bounds').getBoundingClientRect = () =>
      DOMRect.fromRect({ width: 1200, height: 900 });
  };

  beforeEach(async () => {
    const dev = app.cluster({ name: 'dev', context: 'alpha' });
    const other = app.cluster({ name: 'dev', context: 'beta', open: false });
    clusterIds.open = dev.clusterId;
    clusterIds.other = other.clusterId;
    app.namespaces(dev, ['default']);
    view = await app.render(null);
    host = view.container;
  });

  it.each(['right', 'bottom'] as const)('moves a local tab into an empty %s dock', async (edge) => {
    const source = edge === 'right' ? 'bottom' : 'right';
    await render(
      <DockablePanel panelId="obj:a" title="Pod A" defaultPosition={source}>
        <input aria-label="Panel content" defaultValue="Pod A content" />
      </DockablePanel>
    );
    expect(target(edge)).toBeNull();
    const transfer = createTransfer();
    const sourceTab = requireValue(host.querySelector('[role="tab"]'), 'source tab');
    await drag(sourceTab, 'dragstart', transfer);
    expect(target(source)).toBeNull();
    const destination = requireValue(target(edge), 'empty dock destination');
    expect((await drag(destination, 'dragover', transfer)).defaultPrevented).toBe(true);
    await drag(destination, 'drop', transfer);
    expect(context.tabGroups[edge]).toEqual({ tabs: ['obj:a'], activeTab: 'obj:a' });
    expect(context.tabGroups[source].tabs).toEqual([]);
    expect(host.querySelector(`.dockable-panel--${edge} input`)?.getAttribute('value')).toBe(
      'Pod A content'
    );
    expect(target(source)).toBeNull();
    expect(target(edge)).toBeNull();
  });

  it.each(['right', 'bottom'] as const)(
    'previews the remembered %s size without changing it, then docks at that size',
    async (edge) => {
      await render(
        <DockablePanel panelId="obj:a" defaultPosition={edge === 'right' ? 'bottom' : 'right'}>
          Pod A
        </DockablePanel>
      );
      await act(async () => {
        layoutStore.updateGroupLayout(edge, {
          rightSize: { width: 740, height: 300 },
          bottomSize: { width: 400, height: 360 },
          isInitialized: true,
        });
      });
      const before = layoutStore.getGroupLayout(edge);
      const transfer = createTransfer();
      await drag(
        requireValue(host.querySelector('[role="tab"]'), 'source tab'),
        'dragstart',
        transfer
      );
      const destination = requireValue(target(edge), 'empty dock destination');
      await drag(destination, 'dragenter', transfer);
      const preview = requireValue(
        host.querySelector<HTMLElement>(`[data-dock-preview="${edge}"]`),
        'destination footprint'
      );
      const size = preview.style.getPropertyValue('--dock-preview-size');
      expect(size).toBe(edge === 'right' ? '740px' : '360px');
      expect(layoutStore.getGroupLayout(edge)).toEqual(before);
      await drag(destination, 'drop', transfer);
      const panel = requireValue(
        host.querySelector<HTMLElement>(`.dockable-panel--${edge}`),
        'resulting dock'
      );
      expect(edge === 'right' ? panel.style.width : panel.style.height).toBe(size);
    }
  );

  it('previews a utility tab’s first-use size without initializing the empty dock', async () => {
    await render(
      <DockablePanel panelId="logs" defaultPosition="bottom" defaultSize={{ width: 820 }}>
        Logs
      </DockablePanel>
    );
    const transfer = createTransfer();
    await drag(
      requireValue(host.querySelector('[role="tab"]'), 'source tab'),
      'dragstart',
      transfer
    );
    const destination = requireValue(target('right'), 'empty right dock');
    await drag(destination, 'dragenter', transfer);
    const preview = requireValue(
      host.querySelector<HTMLElement>('[data-dock-preview="right"]'),
      'destination footprint'
    );
    expect(preview.style.getPropertyValue('--dock-preview-size')).toBe('820px');
    expect(layoutStore.getGroupLayout('right').isInitialized).toBe(false);
    await drag(destination, 'drop', transfer);
    expect(host.querySelector<HTMLElement>('.dockable-panel--right')?.style.width).toBe('820px');
  });

  it.each([
    { hasSibling: false, isMaximized: false },
    { hasSibling: true, isMaximized: false },
    { hasSibling: true, isMaximized: true },
  ])(
    'matches bottom occupancy after docking right (sibling: $hasSibling, maximized: $isMaximized)',
    async ({ hasSibling, isMaximized }) => {
      await render(
        <>
          <DockablePanel panelId="obj:a" defaultPosition="bottom">
            Pod A
          </DockablePanel>
          {hasSibling ? (
            <DockablePanel panelId="obj:b" defaultPosition="bottom">
              Pod B
            </DockablePanel>
          ) : null}
        </>
      );
      await act(async () => {
        layoutStore.updateGroupLayout('bottom', { isMaximized });
      });
      const transfer = createTransfer();
      await drag(
        requireValue(host.querySelector('[data-panel-id="obj:a"]'), 'source tab'),
        'dragstart',
        transfer
      );
      const destination = requireValue(target('right'), 'empty right dock');
      await drag(destination, 'dragenter', transfer);
      const preview = requireValue(
        host.querySelector<HTMLElement>('[data-dock-preview="right"]'),
        'destination footprint'
      );
      expect(preview.style.getPropertyValue('--dock-preview-bottom-offset')).toBe(
        hasSibling && !isMaximized
          ? `${layoutStore.getGroupLayout('bottom').bottomSize.height}px`
          : '0px'
      );
      await drag(destination, 'drop', transfer);
      expect(context.tabGroups.bottom.tabs).toEqual(hasSibling ? ['obj:b'] : []);
      expect(
        host.querySelector<HTMLElement>('.content')?.style.getPropertyValue('--dock-bottom-offset')
      ).toBe(preview.style.getPropertyValue('--dock-preview-bottom-offset'));
    }
  );

  it.each(['right', 'bottom'] as const)(
    'offers an empty %s dock to a protected external drag and requests its transfer',
    async (edge) => {
      const onExternalTabDrop = vi.fn();
      await render(undefined, { onExternalTabDrop });
      const protectedData = protectedTransfer();
      await drag(host, 'dragenter', protectedData);
      expect(protectedData.getData).not.toHaveBeenCalled();
      expect(target('right')).not.toBeNull();
      expect(target('bottom')).not.toBeNull();
      const destination = requireValue(target(edge), 'empty external dock destination');
      expect((await drag(destination, 'dragover', protectedData)).defaultPrevented).toBe(true);
      const transfer = createTransfer();
      transfer.setData(TAB_DRAG_DATA_TYPE, JSON.stringify(dragPayload()));
      await drag(destination, 'drop', transfer);
      expect(onExternalTabDrop).toHaveBeenCalledWith(dragPayload(), edge, 0);
      // Admission requests transfer; membership waits for the existing acknowledgement flow.
      expect(context.tabGroups[edge].tabs).toEqual([]);
      expect(target('right')).toBeNull();
      expect(target('bottom')).toBeNull();
    }
  );

  it.each([
    ['dockable-tab', 'other'],
    ['cluster-tab', 'open'],
    ['Files', 'open'],
  ] as const)('does not offer destinations for %s from the %s cluster', async (kind, cluster) => {
    await render();
    await drag(host, 'dragenter', protectedTransfer(kind, clusterIds[cluster]));
    expect(target('right')).toBeNull();
    expect(target('bottom')).toBeNull();
  });

  it('validates the drop payload even after accepting its protected markers', async () => {
    const onExternalTabDrop = vi.fn();
    await render(undefined, { onExternalTabDrop });
    await drag(host, 'dragenter', protectedTransfer());
    const destination = requireValue(target('right'), 'empty dock destination');
    const transfer = createTransfer();
    transfer.setData(TAB_DRAG_DATA_TYPE, JSON.stringify(dragPayload(clusterIds.other)));
    expect((await drag(destination, 'drop', transfer)).defaultPrevented).toBe(false);
    expect(onExternalTabDrop).not.toHaveBeenCalled();
  });

  it('keeps the destination alive through native drop propagation', async () => {
    const onExternalTabDrop = vi.fn();
    await render(undefined, { onExternalTabDrop });
    await drag(host, 'dragenter', protectedTransfer());
    const destination = requireValue(target('right'), 'empty dock destination');
    const transfer = createTransfer();
    transfer.setData(TAB_DRAG_DATA_TYPE, JSON.stringify(dragPayload()));
    // Native events let React commit between document capture and target listeners.
    // jsdom dispatch inside act normally batches both phases together.
    const commitCaptureUpdates = () => flushSync(() => undefined);
    document.addEventListener('drop', commitCaptureUpdates, true);
    try {
      await drag(destination, 'drop', transfer);
      expect(onExternalTabDrop).toHaveBeenCalledWith(dragPayload(), 'right', 0);
    } finally {
      document.removeEventListener('drop', commitCaptureUpdates, true);
    }
  });

  it.each(['dragleave', 'dragend', 'drop'])('clears destinations on document %s', async (end) => {
    await render();
    const transfer = protectedTransfer();
    await drag(host, 'dragenter', transfer);
    expect(target('right')).not.toBeNull();
    // Native dragenter precedes dragleave when moving between child elements.
    const child = requireValue(host.querySelector('.content-body'), 'content');
    await drag(child, 'dragenter', transfer);
    await drag(host, 'dragleave', transfer);
    expect(target('right')).not.toBeNull();
    await drag(child, end, transfer);
    expect(target('right')).toBeNull();
    expect(target('bottom')).toBeNull();
  });

  it('does not add workspace edge destinations to native panel windows', async () => {
    await render(undefined, { nativeWindowMode: true });
    await drag(host, 'dragenter', protectedTransfer());
    expect(target('right')).toBeNull();
    expect(target('bottom')).toBeNull();
  });

  it('does not offer destinations when the source guard refuses the drag', async () => {
    await render(<DockablePanel panelId="obj:a">Unsaved content</DockablePanel>, {
      canStartTabDrag: () => false,
    });
    const sourceTab = requireValue(host.querySelector('[role="tab"]'), 'source tab');
    expect((await drag(sourceTab, 'dragstart', createTransfer())).defaultPrevented).toBe(true);
    expect(target('bottom')).toBeNull();
  });
});
