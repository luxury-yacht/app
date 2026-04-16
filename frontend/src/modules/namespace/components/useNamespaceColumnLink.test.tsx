import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { useNamespaceColumnLink } from '@modules/namespace/components/useNamespaceColumnLink';

const viewStateMock = vi.hoisted(() => ({
  setViewType: vi.fn(),
  setActiveNamespaceTab: vi.fn(),
}));

const sidebarStateMock = vi.hoisted(() => ({
  setSidebarSelection: vi.fn(),
}));

const namespaceMock = vi.hoisted(() => ({
  setSelectedNamespace: vi.fn(),
}));

vi.mock('@/core/contexts/ViewStateContext', () => ({
  useViewState: () => viewStateMock,
}));

vi.mock('@/core/contexts/SidebarStateContext', () => ({
  useSidebarState: () => sidebarStateMock,
}));

vi.mock('@modules/namespace/contexts/NamespaceContext', () => ({
  useNamespace: () => namespaceMock,
}));

const renderHook = <T,>(hook: () => T) => {
  const result: { current: T | undefined } = { current: undefined };

  const TestComponent: React.FC = () => {
    result.current = hook();
    return null;
  };

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);

  act(() => {
    root.render(<TestComponent />);
  });

  return {
    get() {
      if (result.current === undefined) {
        throw new Error('Hook result not set');
      }
      return result.current;
    },
    cleanup() {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
};

describe('useNamespaceColumnLink', () => {
  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    viewStateMock.setViewType.mockReset();
    viewStateMock.setActiveNamespaceTab.mockReset();
    sidebarStateMock.setSidebarSelection.mockReset();
    namespaceMock.setSelectedNamespace.mockReset();
  });

  it('navigates to the requested namespace tab for the clicked namespace', () => {
    const hook = renderHook(() =>
      useNamespaceColumnLink<{ namespace: string; clusterId: string }>('autoscaling')
    );
    const options = hook.get();

    options.onClick({
      namespace: 'team-a',
      clusterId: 'alpha:ctx',
    });

    expect(namespaceMock.setSelectedNamespace).toHaveBeenCalledWith('team-a', 'alpha:ctx');
    expect(viewStateMock.setViewType).toHaveBeenCalledWith('namespace');
    expect(sidebarStateMock.setSidebarSelection).toHaveBeenCalledWith({
      type: 'namespace',
      value: 'team-a',
    });
    expect(viewStateMock.setActiveNamespaceTab).toHaveBeenCalledWith('autoscaling');

    hook.cleanup();
  });

  it('supports a custom namespace accessor', () => {
    const hook = renderHook(() =>
      useNamespaceColumnLink<{ namespace?: string; objectNamespace?: string }>(
        'events',
        (item) => item.objectNamespace ?? item.namespace
      )
    );
    const options = hook.get();

    options.onClick({
      namespace: 'ignored',
      objectNamespace: 'team-b',
    });

    expect(namespaceMock.setSelectedNamespace).toHaveBeenCalledWith('team-b', undefined);
    expect(viewStateMock.setActiveNamespaceTab).toHaveBeenCalledWith('events');

    hook.cleanup();
  });
});
