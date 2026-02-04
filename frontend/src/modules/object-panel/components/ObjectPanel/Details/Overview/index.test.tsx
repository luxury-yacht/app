/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/index.test.tsx
 *
 * Test suite for index.
 * Covers key behaviors and edge cases for index.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Overview from './index';

const setSectionExpandedMock = vi.fn();
const useDetailsSectionContextMock = vi.fn();

vi.mock('@/core/contexts/ObjectPanelDetailsSectionContext', () => ({
  useDetailsSectionContext: (...args: unknown[]) => useDetailsSectionContextMock(...args),
}));

const renderComponentMock = vi.fn();
const getResourceCapabilitiesMock = vi.fn();

vi.mock('./registry', () => ({
  overviewRegistry: {
    renderComponent: (props: unknown) => renderComponentMock(props),
  },
  getResourceCapabilities: (kind: unknown) => getResourceCapabilitiesMock(kind),
}));

const actionsMenuMock = vi.fn((props: unknown) => {
  void props;
  return <div data-testid="actions-menu" />;
});

vi.mock('@shared/components/kubernetes/ActionsMenu', () => ({
  ActionsMenu: (props: unknown) => actionsMenuMock(props),
}));

// Mock useObjectPanel to avoid needing ObjectPanelStateProvider
vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => ({
    objectData: { clusterId: 'test-cluster', clusterName: 'Test Cluster' },
    isOpen: true,
    setOpen: vi.fn(),
    openWithObject: vi.fn(),
    close: vi.fn(),
    navigate: vi.fn(),
  }),
}));

describe('Overview component', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  const renderComponent = async (props: React.ComponentProps<typeof Overview>) => {
    await act(async () => {
      root.render(<Overview {...props} />);
      await Promise.resolve();
    });
  };

  beforeEach(() => {
    setSectionExpandedMock.mockReset();
    useDetailsSectionContextMock.mockReset();
    renderComponentMock.mockReset();
    getResourceCapabilitiesMock.mockReset();
    actionsMenuMock.mockClear();

    useDetailsSectionContextMock.mockReturnValue({
      sectionStates: { overview: true },
      setSectionExpanded: setSectionExpandedMock,
    });

    renderComponentMock.mockReturnValue(<div data-testid="overview-content">Overview body</div>);
    getResourceCapabilitiesMock.mockReturnValue({ restart: true, scale: false, delete: true });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('renders overview content and passes object data to ActionsMenu', async () => {
    await renderComponent({
      kind: 'Deployment',
      objectKind: 'deployment',
      name: 'demo',
      desiredReplicas: 5,
      actionLoading: false,
    });

    expect(renderComponentMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'Deployment', name: 'demo' })
    );
    expect(container.querySelector('[data-testid="overview-content"]')).not.toBeNull();

    expect(actionsMenuMock).toHaveBeenCalledTimes(1);
    const calls = actionsMenuMock.mock.calls as Array<[Record<string, unknown>]>;
    const firstCall = calls[0];
    if (!firstCall) {
      throw new Error('ActionsMenu was not called');
    }
    const actionProps = firstCall[0];
    // ActionsMenu now receives object prop with kind/name/namespace
    expect(actionProps).toMatchObject({
      object: expect.objectContaining({
        kind: 'Deployment',
        name: 'demo',
      }),
      currentReplicas: 5,
    });
  });

  it('passes callbacks to ActionsMenu for action handling', async () => {
    const onRestart = vi.fn();
    const onScale = vi.fn();
    const onDelete = vi.fn();

    await renderComponent({
      kind: 'StatefulSet',
      objectKind: 'statefulset',
      name: 'stateful-1',
      onRestart,
      onScale,
      onDelete,
    });

    expect(actionsMenuMock).toHaveBeenCalledTimes(1);
    const calls = actionsMenuMock.mock.calls as Array<[Record<string, unknown>]>;
    const actionMenuArgs = calls[0];
    if (!actionMenuArgs) {
      throw new Error('ActionsMenu was not called');
    }
    const actionMenuProps = actionMenuArgs[0];
    // ActionsMenu receives callbacks and object data
    expect(actionMenuProps).toMatchObject({
      object: expect.objectContaining({
        kind: 'StatefulSet',
        name: 'stateful-1',
      }),
      onRestart,
      onScale,
      onDelete,
    });
  });

  it('toggles overview section when header is clicked and hides content when collapsed', async () => {
    useDetailsSectionContextMock.mockReturnValue({
      sectionStates: { overview: false },
      setSectionExpanded: setSectionExpandedMock,
    });

    await renderComponent({ kind: 'Pod', objectKind: 'pod', name: 'api' });

    expect(container.querySelector('[data-testid="overview-content"]')).toBeNull();

    const headerToggle = container.querySelector('.object-panel-section-title');
    expect(headerToggle).not.toBeNull();
    act(() => {
      headerToggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(setSectionExpandedMock).toHaveBeenCalledWith('overview', true);
  });
});
