/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/index.test.tsx
 *
 * Tests for index.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Overview from './index';

const setSectionExpandedMock = vi.fn();
const useDetailsSectionContextMock = vi.fn();

vi.mock('@contexts/DetailsSectionContext', () => ({
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

  it('renders overview content and wires capabilities from registry defaults', async () => {
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
    expect(actionProps).toMatchObject({
      kind: 'Deployment',
      objectKind: 'deployment',
      canRestart: true,
      canScale: false,
      canDelete: true,
      currentReplicas: 5,
    });
    expect(actionProps?.restartDisabledReason).toBeUndefined();
    expect(actionProps?.scaleDisabledReason).toBeUndefined();
    expect(actionProps?.deleteDisabledReason).toBeUndefined();
  });

  it('prefers explicit capability flags and disabled reasons passed via props', async () => {
    getResourceCapabilitiesMock.mockReturnValue({ restart: true, scale: true, delete: true });

    await renderComponent({
      kind: 'StatefulSet',
      objectKind: 'statefulset',
      name: 'stateful-1',
      canRestart: false,
      canScale: true,
      canDelete: false,
      restartDisabledReason: 'blocked',
      scaleDisabledReason: 'scaling-disabled',
      deleteDisabledReason: 'no-permission',
    });

    expect(actionsMenuMock).toHaveBeenCalledTimes(1);
    const secondCalls = actionsMenuMock.mock.calls as Array<[Record<string, unknown>]>;
    const actionMenuArgs = secondCalls[0];
    if (!actionMenuArgs) {
      throw new Error('ActionsMenu was not called');
    }
    const actionMenuProps = actionMenuArgs[0];
    expect(actionMenuProps).toMatchObject({
      canRestart: false,
      canScale: true,
      canDelete: false,
      restartDisabledReason: 'blocked',
      scaleDisabledReason: undefined,
      deleteDisabledReason: 'no-permission',
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
