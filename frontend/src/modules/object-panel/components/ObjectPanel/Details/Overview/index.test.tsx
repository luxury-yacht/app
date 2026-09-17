/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/index.test.tsx
 */

import type { ClusterObjectReference } from '@shared/utils/objectIdentity';
import { buildRequiredObjectReference } from '@shared/utils/objectIdentity';
import type React from 'react';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Overview from './index';

const renderComponentMock = vi.fn();
const descriptorMock = vi.hoisted(() =>
  vi.fn<typeof import('./descriptorRegistry').getOverviewDescriptor>()
);

vi.mock('./GenericOverview', () => ({
  GenericOverview: (props: unknown) => renderComponentMock(props),
}));

// Most cases isolate action wiring through the generic path; the dispatch case
// below uses the real descriptor registry and renderer.
vi.mock('./descriptorRegistry', () => ({
  getOverviewDescriptor: descriptorMock,
}));

const actionsMenuMock = vi.fn((props: unknown) => {
  void props;
  return <div data-testid="actions-menu" />;
});

vi.mock('@shared/components/kubernetes/ActionsMenu', () => ({
  ActionsMenu: (props: unknown) => actionsMenuMock(props),
}));

const objectPanelState = vi.hoisted(() => ({
  objectData: null as ClusterObjectReference | null,
}));

// Mock useObjectPanel to avoid needing ObjectPanelStateProvider
vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => ({
    objectData: objectPanelState.objectData,
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
    objectPanelState.objectData = buildRequiredObjectReference({
      kind: props.kind,
      name: props.name,
      namespace: props.namespace,
      clusterId: 'test-cluster',
      clusterName: 'Test Cluster',
    });
    await act(async () => {
      root.render(<Overview {...props} />);
      await Promise.resolve();
    });
  };

  beforeEach(() => {
    renderComponentMock.mockReset();
    descriptorMock.mockReset();
    actionsMenuMock.mockClear();

    renderComponentMock.mockReturnValue(<div data-testid="overview-content">Overview body</div>);
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

  it('renders the registered raw detail and switches to generic metadata for an unregistered kind', async () => {
    const registry =
      await vi.importActual<typeof import('./descriptorRegistry')>('./descriptorRegistry');
    descriptorMock.mockImplementation(registry.getOverviewDescriptor);
    await renderComponent({
      kind: 'ConfigMap',
      name: 'action-target',
      activeDetail: { kind: 'ConfigMap', name: 'raw-detail-name', usedBy: [] },
    });
    expect(container.textContent).toContain('raw-detail-name');
    expect(renderComponentMock).not.toHaveBeenCalled();
    objectPanelState.objectData = buildRequiredObjectReference({
      clusterId: 'test-cluster',
      group: 'example.test',
      version: 'v1',
      kind: 'Widget',
      name: 'custom-target',
    });
    await act(async () => {
      root.render(<Overview kind="Widget" name="custom-target" labels={{ owner: 'team-a' }} />);
    });
    expect(renderComponentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'Widget',
        name: 'custom-target',
        group: 'example.test',
        labels: { owner: 'team-a' },
      })
    );
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
