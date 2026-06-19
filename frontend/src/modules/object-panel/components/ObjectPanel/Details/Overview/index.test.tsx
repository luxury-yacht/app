/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/index.test.tsx
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Overview from './index';

const renderComponentMock = vi.fn();
const getResourceCapabilitiesMock = vi.fn();

vi.mock('./registry', () => ({
  overviewRegistry: {
    renderComponent: (props: unknown) => renderComponentMock(props),
  },
  getResourceCapabilities: (kind: unknown) => getResourceCapabilitiesMock(kind),
}));

// This suite verifies the Overview wrapper's content + ActionsMenu wiring, independent of which
// kinds have migrated to descriptors. Force the legacy render path so the assertions hold for any
// kind; the descriptor path is covered by the per-kind descriptor tests.
vi.mock('./descriptorRegistry', () => ({
  getOverviewDescriptor: () => undefined,
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
    renderComponentMock.mockReset();
    getResourceCapabilitiesMock.mockReset();
    actionsMenuMock.mockClear();

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

  it('passes replica string desired count to ActionsMenu when desiredReplicas is missing', async () => {
    await renderComponent({
      kind: 'ReplicaSet',
      objectKind: 'replicaset',
      name: 'rs-demo',
      replicas: '2/4',
      ready: '2/4',
      actionLoading: false,
    });

    const calls = actionsMenuMock.mock.calls as Array<[Record<string, unknown>]>;
    const actionProps = calls[0]?.[0];

    expect(actionProps).toMatchObject({
      object: expect.objectContaining({
        kind: 'ReplicaSet',
        name: 'rs-demo',
        ready: '2/4',
      }),
      currentReplicas: 4,
    });
  });

  it('passes lifecycle callbacks to ActionsMenu for the controller', async () => {
    const onAfterDelete = vi.fn();
    const onAfterAction = vi.fn();

    await renderComponent({
      kind: 'StatefulSet',
      objectKind: 'statefulset',
      name: 'stateful-1',
      onAfterDelete,
      onAfterAction,
    });

    expect(actionsMenuMock).toHaveBeenCalledTimes(1);
    const calls = actionsMenuMock.mock.calls as Array<[Record<string, unknown>]>;
    const actionMenuArgs = calls[0];
    if (!actionMenuArgs) {
      throw new Error('ActionsMenu was not called');
    }
    const actionMenuProps = actionMenuArgs[0];
    // ActionsMenu receives the object data + the panel lifecycle callbacks; the
    // shared controller owns execution and modals from here.
    expect(actionMenuProps).toMatchObject({
      object: expect.objectContaining({
        kind: 'StatefulSet',
        name: 'stateful-1',
      }),
      onAfterDelete,
      onAfterAction,
    });
  });

  it('always renders overview content', async () => {
    await renderComponent({ kind: 'Pod', objectKind: 'pod', name: 'api' });

    expect(container.querySelector('[data-testid="overview-content"]')).not.toBeNull();
    expect(container.querySelector('.object-panel-section-title')?.textContent).toContain(
      'Overview'
    );
  });
});
