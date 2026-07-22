import { useNamespaceColumnLink } from '@modules/namespace/components/useNamespaceColumnLink';
import type React from 'react';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeResourceRef } from '@/test-utils/makeResourceRef';

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
  beforeEach(() => {
    viewStateMock.setViewType.mockReset();
    viewStateMock.setActiveNamespaceTab.mockReset();
    sidebarStateMock.setSidebarSelection.mockReset();
    namespaceMock.setSelectedNamespace.mockReset();
  });

  it('navigates to the requested namespace tab for the clicked namespace', () => {
    const hook = renderHook(() =>
      useNamespaceColumnLink<{ ref: ReturnType<typeof makeResourceRef> }>('autoscaling')
    );
    const options = hook.get();

    options.onClick({
      ref: makeResourceRef({
        clusterId: 'alpha:ctx',
        kind: 'Pod',
        resource: 'pods',
        namespace: 'team-a',
        name: 'api-1',
      }),
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
      useNamespaceColumnLink<{
        ref: ReturnType<typeof makeResourceRef>;
        namespace?: string;
        objectNamespace?: string;
      }>('events', (item) => item.objectNamespace ?? item.namespace)
    );
    const options = hook.get();

    options.onClick({
      ref: makeResourceRef({
        clusterId: 'alpha:ctx',
        kind: 'Event',
        resource: 'events',
        namespace: 'ignored',
        name: 'event-1',
      }),
      namespace: 'ignored',
      objectNamespace: 'team-b',
    });

    expect(namespaceMock.setSelectedNamespace).toHaveBeenCalledWith('team-b', 'alpha:ctx');
    expect(viewStateMock.setActiveNamespaceTab).toHaveBeenCalledWith('events');

    hook.cleanup();
  });
});
