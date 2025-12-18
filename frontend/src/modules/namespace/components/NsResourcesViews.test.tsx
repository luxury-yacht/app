import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  podsViewMock,
  workloadsViewMock,
  configViewMock,
  networkViewMock,
  rbacViewMock,
  storageViewMock,
  autoscalingViewMock,
  quotasViewMock,
  customViewMock,
  helmViewMock,
  eventsViewMock,
} = vi.hoisted(() => ({
  podsViewMock: vi.fn(() => <div data-testid="pods-view" />),
  workloadsViewMock: vi.fn(() => <div data-testid="workloads-view" />),
  configViewMock: vi.fn(() => <div data-testid="config-view" />),
  networkViewMock: vi.fn(() => <div data-testid="network-view" />),
  rbacViewMock: vi.fn(() => <div data-testid="rbac-view" />),
  storageViewMock: vi.fn(() => <div data-testid="storage-view" />),
  autoscalingViewMock: vi.fn(() => <div data-testid="autoscaling-view" />),
  quotasViewMock: vi.fn(() => <div data-testid="quotas-view" />),
  customViewMock: vi.fn(() => <div data-testid="custom-view" />),
  helmViewMock: vi.fn(() => <div data-testid="helm-view" />),
  eventsViewMock: vi.fn(() => <div data-testid="events-view" />),
}));

vi.mock('@modules/namespace/components/NsViewPods', () => ({ default: podsViewMock }));
vi.mock('@modules/namespace/components/NsViewWorkloads', () => ({ default: workloadsViewMock }));
vi.mock('@modules/namespace/components/NsViewConfig', () => ({ default: configViewMock }));
vi.mock('@modules/namespace/components/NsViewNetwork', () => ({ default: networkViewMock }));
vi.mock('@modules/namespace/components/NsViewRBAC', () => ({ default: rbacViewMock }));
vi.mock('@modules/namespace/components/NsViewStorage', () => ({ default: storageViewMock }));
vi.mock('@modules/namespace/components/NsViewAutoscaling', () => ({
  default: autoscalingViewMock,
}));
vi.mock('@modules/namespace/components/NsViewQuotas', () => ({ default: quotasViewMock }));
vi.mock('@modules/namespace/components/NsViewCustom', () => ({ default: customViewMock }));
vi.mock('@modules/namespace/components/NsViewHelm', () => ({ default: helmViewMock }));
vi.mock('@modules/namespace/components/NsViewEvents', () => ({ default: eventsViewMock }));

import NamespaceResourcesViews from '@modules/namespace/components/NsResourcesViews';
import { NamespaceViewType } from '@/types/navigation/views';

describe('NamespaceResourcesViews', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    podsViewMock.mockClear();
    workloadsViewMock.mockClear();
    configViewMock.mockClear();
    networkViewMock.mockClear();
    rbacViewMock.mockClear();
    storageViewMock.mockClear();
    autoscalingViewMock.mockClear();
    quotasViewMock.mockClear();
    customViewMock.mockClear();
    helmViewMock.mockClear();
    eventsViewMock.mockClear();

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

  const renderView = async (props: React.ComponentProps<typeof NamespaceResourcesViews>) => {
    await act(async () => {
      root.render(<NamespaceResourcesViews {...props} />);
      await Promise.resolve();
    });
  };

  it('renders the pods view with namespace data and passes object panel content', async () => {
    await renderView({
      namespace: 'team-a',
      activeTab: 'pods',
      nsPods: [{ name: 'api', namespace: 'team-a' }],
      nsPodsLoading: true,
      nsPodsLoaded: true,
      nsPodsError: 'oops',
      objectPanel: <div data-testid="object-panel" />,
    });

    expect(podsViewMock).toHaveBeenCalledTimes(1);
    const podsCall = podsViewMock.mock.calls.length
      ? (podsViewMock.mock.calls[0] as unknown[] | undefined)?.[0]
      : undefined;
    expect(podsCall).toMatchObject({
      namespace: 'team-a',
      data: [{ name: 'api', namespace: 'team-a' }],
      loading: true,
      loaded: true,
      error: 'oops',
    });
    expect(container.querySelector('[data-testid="object-panel"]')).toBeTruthy();
  });

  const tabCases = [
    {
      tab: 'workloads' as const,
      props: {
        nsWorkloads: [{ name: 'deploy', namespace: 'team-a' }],
        nsWorkloadsLoading: true,
        nsWorkloadsLoaded: false,
      },
      mock: workloadsViewMock,
      expected: {
        namespace: 'team-a',
        data: [{ name: 'deploy', namespace: 'team-a' }],
        loading: true,
        loaded: false,
      },
    },
    {
      tab: 'config' as const,
      props: {
        nsConfig: [{ name: 'cm' }],
        nsConfigLoading: false,
        nsConfigLoaded: true,
      },
      mock: configViewMock,
      expected: {
        namespace: 'team-a',
        data: [{ name: 'cm' }],
        loading: false,
        loaded: true,
      },
    },
    {
      tab: 'network' as const,
      props: {
        nsNetwork: [{ name: 'np' }],
        nsNetworkLoading: false,
        nsNetworkLoaded: true,
      },
      mock: networkViewMock,
      expected: {
        namespace: 'team-a',
        data: [{ name: 'np' }],
        loading: false,
        loaded: true,
      },
    },
    {
      tab: 'rbac' as const,
      props: {
        nsRBAC: [{ name: 'role' }],
        nsRBACLoading: true,
        nsRBACLoaded: false,
      },
      mock: rbacViewMock,
      expected: {
        namespace: 'team-a',
        data: [{ name: 'role' }],
        loading: true,
        loaded: false,
      },
    },
    {
      tab: 'storage' as const,
      props: {
        nsStorage: [{ name: 'pvc' }],
        nsStorageLoading: true,
        nsStorageLoaded: true,
      },
      mock: storageViewMock,
      expected: {
        namespace: 'team-a',
        data: [{ name: 'pvc' }],
        loading: true,
        loaded: true,
      },
    },
    {
      tab: 'autoscaling' as const,
      props: {
        nsAutoscaling: [{ name: 'hpa' }],
        nsAutoscalingLoading: false,
        nsAutoscalingLoaded: true,
      },
      mock: autoscalingViewMock,
      expected: {
        namespace: 'team-a',
        data: [{ name: 'hpa' }],
        loading: false,
        loaded: true,
      },
    },
    {
      tab: 'quotas' as const,
      props: {
        nsQuotas: [{ name: 'rq' }],
        nsQuotasLoading: true,
        nsQuotasLoaded: true,
      },
      mock: quotasViewMock,
      expected: {
        namespace: 'team-a',
        data: [{ name: 'rq' }],
        loading: true,
        loaded: true,
      },
    },
    {
      tab: 'custom' as const,
      props: {
        nsCustom: [{ name: 'crd' }],
        nsCustomLoading: false,
        nsCustomLoaded: true,
      },
      mock: customViewMock,
      expected: {
        namespace: 'team-a',
        data: [{ name: 'crd' }],
        loading: false,
        loaded: true,
      },
    },
    {
      tab: 'helm' as const,
      props: {
        nsHelm: [{ name: 'release', namespace: 'team-a' }],
        nsHelmLoading: false,
        nsHelmLoaded: true,
      },
      mock: helmViewMock,
      expected: {
        namespace: 'team-a',
        data: [{ name: 'release', namespace: 'team-a' }],
        loading: false,
        loaded: true,
      },
    },
    {
      tab: 'events' as const,
      props: {
        nsEvents: [{ message: 'Pod restarted' }],
        nsEventsLoading: false,
        nsEventsLoaded: true,
      },
      mock: eventsViewMock,
      expected: {
        data: [{ message: 'Pod restarted' }],
        loading: false,
        loaded: true,
        namespace: 'team-a',
      },
    },
  ];

  it.each(tabCases)('renders %s tab content', async ({ tab, props, mock, expected }) => {
    await renderView({
      namespace: 'team-a',
      activeTab: tab,
      ...props,
    });

    expect(mock).toHaveBeenCalledTimes(1);
    const call = mock.mock.calls.length
      ? (mock.mock.calls[0] as unknown[] | undefined)?.[0]
      : undefined;
    expect(call).toMatchObject(expected);
  });

  it('renders custom view data when provided', async () => {
    await renderView({
      namespace: 'team-a',
      activeTab: 'custom',
      nsCustom: [{ name: 'crd' }],
      nsCustomLoading: false,
      nsCustomLoaded: true,
      objectPanel: <aside data-testid="panel" />,
    });

    expect(customViewMock).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="panel"]')).toBeTruthy();
  });

  it('falls back to null when the tab is not recognised', async () => {
    const invalidTab = 'invalid-tab' as NamespaceViewType;

    await renderView({
      namespace: 'team-a',
      activeTab: 'pods',
    });

    // Switch to an unknown tab and ensure nothing new renders
    await renderView({
      namespace: 'team-a',
      activeTab: invalidTab,
    });
    const viewContent = container.querySelector('.view-content');
    expect(viewContent?.textContent?.trim()).toBe('');
  });
});
