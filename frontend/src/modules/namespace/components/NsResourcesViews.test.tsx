/**
 * frontend/src/modules/namespace/components/NsResourcesViews.test.tsx
 *
 * Test suite for NsResourcesViews.
 * Covers key behaviors and edge cases for NsResourcesViews.
 */

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
  browseViewMock,
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
  browseViewMock: vi.fn(() => <div data-testid="browse-view" />),
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
vi.mock('@modules/browse/components/BrowseView', () => ({ default: browseViewMock }));

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
    browseViewMock.mockClear();

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
      objectPanel: <div data-testid="object-panel" />,
    });

    expect(podsViewMock).toHaveBeenCalledTimes(1);
    const podsCall = podsViewMock.mock.calls.length
      ? (podsViewMock.mock.calls[0] as unknown[] | undefined)?.[0]
      : undefined;
    expect(podsCall).toMatchObject({
      namespace: 'team-a',
    });
    expect(container.querySelector('[data-testid="object-panel"]')).toBeTruthy();
  });

  const tabCases = [
    {
      tab: 'browse' as const,
      props: {},
      mock: browseViewMock,
      expected: {
        namespace: 'team-a',
      },
    },
    {
      tab: 'workloads' as const,
      props: {},
      mock: workloadsViewMock,
      expected: {
        namespace: 'team-a',
      },
    },
    {
      tab: 'config' as const,
      props: {},
      mock: configViewMock,
      expected: {
        namespace: 'team-a',
      },
    },
    {
      tab: 'network' as const,
      props: {},
      mock: networkViewMock,
      expected: {
        namespace: 'team-a',
      },
    },
    {
      tab: 'rbac' as const,
      props: {},
      mock: rbacViewMock,
      expected: {
        namespace: 'team-a',
      },
    },
    {
      tab: 'storage' as const,
      props: {},
      mock: storageViewMock,
      expected: {
        namespace: 'team-a',
      },
    },
    {
      tab: 'autoscaling' as const,
      props: {},
      mock: autoscalingViewMock,
      expected: {
        namespace: 'team-a',
      },
    },
    {
      tab: 'quotas' as const,
      props: {},
      mock: quotasViewMock,
      expected: {
        namespace: 'team-a',
      },
    },
    {
      tab: 'custom' as const,
      props: {},
      mock: customViewMock,
      expected: {
        namespace: 'team-a',
      },
    },
    {
      tab: 'helm' as const,
      props: {},
      mock: helmViewMock,
      expected: {
        namespace: 'team-a',
      },
    },
    {
      tab: 'events' as const,
      props: {},
      mock: eventsViewMock,
      expected: {
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
