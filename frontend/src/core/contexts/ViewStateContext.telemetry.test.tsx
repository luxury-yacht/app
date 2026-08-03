import type React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const telemetryMocks = vi.hoisted(() => ({
  setActiveViewContext: vi.fn(),
}));

const refreshMocks = vi.hoisted(() => ({
  updateContext: vi.fn(),
}));

const contextMocks = vi.hoisted(() => ({
  kubeconfig: {
    selectedClusterId: 'cluster-a',
    selectedClusterIds: ['cluster-a'],
  },
  modal: {},
  objectPanel: { showObjectPanel: false },
  sidebar: { setSidebarSelection: vi.fn() },
}));

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => contextMocks.kubeconfig,
}));

vi.mock('@modules/object-panel/contexts/ObjectPanelStateContext', () => ({
  ObjectPanelStateProvider: ({ children }: { children: React.ReactNode }) => children,
  useObjectPanelState: () => contextMocks.objectPanel,
}));

vi.mock('./SidebarStateContext', () => ({
  SidebarStateProvider: ({ children }: { children: React.ReactNode }) => children,
  useSidebarState: () => contextMocks.sidebar,
}));

vi.mock('./ModalStateContext', () => ({
  ModalStateProvider: ({ children }: { children: React.ReactNode }) => children,
  useModalState: () => contextMocks.modal,
}));

vi.mock('@/core/refresh', () => ({
  refreshOrchestrator: refreshMocks,
}));

vi.mock('@/core/telemetry/sentry', () => telemetryMocks);

import { ViewStateProvider } from './ViewStateContext';

describe('ViewStateProvider telemetry synchronization', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    telemetryMocks.setActiveViewContext.mockReset();
    refreshMocks.updateContext.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('publishes the active workspace from the navigation owner', () => {
    act(() => {
      root.render(
        <ViewStateProvider>
          <div>child</div>
        </ViewStateProvider>
      );
    });

    expect(telemetryMocks.setActiveViewContext).toHaveBeenCalledWith({
      view: 'overview',
      clusterId: 'cluster-a',
      objectPanelOpen: false,
    });
  });
});
