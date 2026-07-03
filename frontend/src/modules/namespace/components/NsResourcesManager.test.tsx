/**
 * frontend/src/modules/namespace/components/NsResourcesManager.test.tsx
 *
 * Test suite for NsResourcesManager.
 * The manager publishes the active tab to NsResourcesContext and renders the
 * views — nothing else. Each tab's table owns its data via the query-backed
 * grid, so there are no context resource handles to load or cancel.
 */

import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { NamespaceResourcesManager } from '@modules/namespace/components/NsResourcesManager';

const { setActiveResourceTypeMock, viewPropsRef } = vi.hoisted(() => ({
  setActiveResourceTypeMock: vi.fn(),
  viewPropsRef: { current: null as any },
}));

vi.mock('@modules/namespace/contexts/NsResourcesContext', () => ({
  useNamespaceResources: () => ({
    setActiveResourceType: setActiveResourceTypeMock,
  }),
}));

vi.mock('@modules/namespace/components/NsResourcesViews', () => ({
  __esModule: true,
  default: (props: any) => {
    viewPropsRef.current = props;
    return <div data-testid="namespace-resources-view" />;
  },
}));

describe('NamespaceResourcesManager', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    setActiveResourceTypeMock.mockReset();
    viewPropsRef.current = null;
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const renderManager = async (activeTab: string) => {
    await act(async () => {
      root.render(<NamespaceResourcesManager namespace="team-a" activeTab={activeTab as any} />);
      await Promise.resolve();
    });
  };

  it('publishes the active tab to the context and renders the views', async () => {
    await renderManager('network');

    expect(setActiveResourceTypeMock).toHaveBeenCalledWith('network');
    const props = viewPropsRef.current;
    expect(props).toBeTruthy();
    expect(props.namespace).toBe('team-a');
    expect(props.activeTab).toBe('network');
  });

  it('defaults the rendered tab to workloads when none is provided', async () => {
    await act(async () => {
      root.render(<NamespaceResourcesManager namespace="team-a" />);
      await Promise.resolve();
    });

    expect(viewPropsRef.current?.activeTab).toBe('workloads');
    expect(setActiveResourceTypeMock).not.toHaveBeenCalled();
  });
});
