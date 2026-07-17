/**
 * frontend/src/modules/namespace/components/AllNamespacesView.test.tsx
 *
 * Test suite for AllNamespacesView.
 * Every tab is query-backed: the view renders the tab's table directly with
 * the all-namespaces scope and reads NOTHING from NsResourcesContext (the
 * old per-tab error banners rode a context data layer that fetched rows
 * nobody rendered).
 */

import AllNamespacesView from '@modules/namespace/components/AllNamespacesView';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NamespaceViewType } from '@/types/navigation/views';

const clientMocks = vi.hoisted(() => ({
  fetchSnapshotMock: vi.fn(),
}));

vi.mock('@/core/refresh/client', () => ({
  fetchSnapshot: clientMocks.fetchSnapshotMock,
}));

type ViewRenderer = ReturnType<typeof vi.fn>;

const hoistedMocks = vi.hoisted(() => {
  const renderers: Record<string, ViewRenderer> = {};
  const makeMock = (id: string) => {
    const renderer = vi.fn();
    renderers[id] = renderer;
    return {
      __esModule: true,
      default: (props: unknown) => {
        renderer(props);
        return null;
      },
    };
  };
  return { renderers, makeMock };
});

const viewRenderers = hoistedMocks.renderers;
vi.mock('@modules/namespace/components/NsViewWorkloads', () =>
  hoistedMocks.makeMock('workloads-view')
);
vi.mock('@modules/namespace/components/NsViewConfig', () => hoistedMocks.makeMock('config-view'));
vi.mock('@modules/namespace/components/NsViewAutoscaling', () =>
  hoistedMocks.makeMock('autoscaling-view')
);
vi.mock('@modules/namespace/components/NsViewNetwork', () => hoistedMocks.makeMock('network-view'));
vi.mock('@modules/namespace/components/NsViewQuotas', () => hoistedMocks.makeMock('quotas-view'));
vi.mock('@modules/namespace/components/NsViewRBAC', () => hoistedMocks.makeMock('rbac-view'));
vi.mock('@modules/namespace/components/NsViewStorage', () => hoistedMocks.makeMock('storage-view'));
vi.mock('@modules/namespace/components/NsViewCustom', () => hoistedMocks.makeMock('custom-view'));
vi.mock('@modules/namespace/components/NsViewHelm', () => hoistedMocks.makeMock('helm-view'));
vi.mock('@modules/namespace/components/NsViewEvents', () => hoistedMocks.makeMock('events-view'));
vi.mock('@modules/browse/components/BrowseView', () => hoistedMocks.makeMock('browse-view'));

describe('AllNamespacesView', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    clientMocks.fetchSnapshotMock.mockReset();
    Object.values(viewRenderers).forEach((mock) => {
      mock.mockReset();
    });
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

  const renderView = async (tab: NamespaceViewType) => {
    await act(async () => {
      root.render(<AllNamespacesView activeTab={tab} />);
      await Promise.resolve();
    });
  };

  const getLatestProps = (rendererKey: string) => {
    const mock = viewRenderers[rendererKey];
    const calls = mock?.mock.calls ?? [];
    return calls[calls.length - 1]?.[0];
  };

  const tableTabs: Array<[NamespaceViewType, string]> = [
    ['workloads', 'workloads-view'],
    ['config', 'config-view'],
    ['autoscaling', 'autoscaling-view'],
    ['network', 'network-view'],
    ['quotas', 'quotas-view'],
    ['rbac', 'rbac-view'],
    ['storage', 'storage-view'],
    ['helm', 'helm-view'],
    ['events', 'events-view'],
  ];

  it.each(tableTabs)(
    'renders the %s tab directly with the all-namespaces scope and no extra fetch',
    async (tab, rendererKey) => {
      await renderView(tab);

      expect(clientMocks.fetchSnapshotMock).not.toHaveBeenCalled();
      const props = getLatestProps(rendererKey);
      expect(props.namespace).toBe(ALL_NAMESPACES_SCOPE);
      expect(props.showNamespaceColumn).toBe(true);
    }
  );

  it('renders the custom tab with its catalog-backed props', async () => {
    await renderView('custom');

    expect(clientMocks.fetchSnapshotMock).not.toHaveBeenCalled();
    const props = getLatestProps('custom-view');
    expect(props.namespace).toBe(ALL_NAMESPACES_SCOPE);
    expect(props.showNamespaceColumn).toBe(true);
  });

  it('renders the browse tab with the all-namespaces scope', async () => {
    await renderView('browse');

    const props = getLatestProps('browse-view');
    expect(props.namespace).toBe(ALL_NAMESPACES_SCOPE);
  });

  it('shows the map placeholder for the all-namespaces scope', async () => {
    await renderView('map');

    expect(container.textContent).toContain('Map is available for individual namespaces.');
  });
});
