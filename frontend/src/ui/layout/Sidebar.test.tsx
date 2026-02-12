/**
 * frontend/src/ui/layout/Sidebar.test.tsx
 *
 * Test suite for Sidebar.
 * Covers key behaviors and edge cases for Sidebar.
 */

import { act } from 'react';
import ReactDOM from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import Sidebar from './Sidebar';
import { KeyboardProvider } from '@ui/shortcuts';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';

const runtimeMocks = vi.hoisted(() => ({
  eventsOn: vi.fn(),
  eventsOff: vi.fn(),
}));

const refreshMocks = vi.hoisted(() => ({
  // Scoped domain states: Record<string, DomainState>
  // The component iterates Object.values() looking for an entry with .data
  catalogScopedStates: {} as Record<
    string,
    { status: 'idle' | 'loading' | 'success' | 'error'; data: any; stats: any; error: any; droppedAutoRefreshes: number; scope: string | undefined }
  >,
}));

const testClusterId = 'cluster-a';
const namespaceKey = (scope: string) => `${testClusterId}|${scope}`;

vi.mock('@wailsjs/runtime/runtime', () => ({
  EventsOn: runtimeMocks.eventsOn,
  EventsOff: runtimeMocks.eventsOff,
}));

vi.mock('@core/refresh', () => ({
  useRefreshDomain: () => ({ status: 'idle', data: null, stats: null, error: null, droppedAutoRefreshes: 0, scope: undefined }),
  useRefreshScopedDomainStates: () => refreshMocks.catalogScopedStates,
}));

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({ selectedClusterId: testClusterId }),
}));

type NamespaceEntry = {
  name: string;
  scope: string;
  resourceVersion: string;
  hasWorkloads: boolean;
  workloadsUnknown: boolean;
  details: string;
};

type NamespaceState = {
  namespaces: NamespaceEntry[];
  namespaceLoading: boolean;
  selectedNamespace?: string;
  selectedNamespaceClusterId?: string;
  setSelectedNamespace: (namespace: string, clusterId?: string) => void;
};

const createNamespaceState = (): NamespaceState => ({
  namespaces: [
    {
      name: 'default',
      scope: 'default',
      resourceVersion: '1',
      hasWorkloads: true,
      workloadsUnknown: false,
      details: '',
    },
  ] as NamespaceEntry[],
  namespaceLoading: false,
  selectedNamespace: undefined,
  selectedNamespaceClusterId: undefined,
  setSelectedNamespace: vi.fn<(ns: string, clusterId?: string) => void>(),
});

const createViewState = () => ({
  isSidebarVisible: true,
  sidebarWidth: 260,
  sidebarSelection: { type: 'overview', value: 'overview' } as
    | { type: 'overview'; value: string }
    | { type: 'namespace'; value: string }
    | { type: 'cluster'; value: string },
  viewType: 'overview' as 'overview' | 'cluster' | 'namespace',
  activeClusterTab: 'nodes' as string | null,
  activeNamespaceTab: 'workloads' as string | null,
  toggleSidebar: vi.fn(),
  setViewType: vi.fn(),
  setActiveClusterView: vi.fn(),
  setSidebarSelection: vi.fn(),
  onNamespaceSelect: vi.fn(),
  setActiveNamespaceTab: vi.fn(),
});

let namespaceState = createNamespaceState();
let viewStateMock = createViewState();
const nativeScrollIntoView = Element.prototype.scrollIntoView;

vi.mock('@modules/namespace/contexts/NamespaceContext', () => ({
  useNamespace: () => namespaceState,
}));

vi.mock('@core/contexts/ViewStateContext', () => ({
  useViewState: () => viewStateMock,
}));

describe('Sidebar', () => {
  beforeAll(() => {
    if (!Element.prototype.scrollIntoView) {
      (Element.prototype as any).scrollIntoView = () => {};
    }
  });

  afterAll(() => {
    if (nativeScrollIntoView) {
      Element.prototype.scrollIntoView = nativeScrollIntoView;
    } else {
      // @ts-expect-error cleanup
      delete Element.prototype.scrollIntoView;
    }
  });
  let container: HTMLDivElement | null;
  let root: ReactDOM.Root | null;

  const renderSidebar = ({
    namespaces,
    viewState,
  }: {
    namespaces?: NamespaceEntry[];
    viewState?: Partial<ReturnType<typeof createViewState>>;
  } = {}) => {
    if (namespaces) {
      namespaceState.namespaces = namespaces;
    }
    if (viewState) {
      Object.assign(viewStateMock, viewState);
    }
    act(() => {
      root!.render(
        <KeyboardProvider>
          <Sidebar />
        </KeyboardProvider>
      );
    });
  };

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    namespaceState = createNamespaceState();
    viewStateMock = createViewState();
    refreshMocks.catalogScopedStates = {};
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    if (container?.parentNode) {
      container.parentNode.removeChild(container);
    }
    container = null;
    root = null;
    vi.clearAllMocks();
  });

  it('toggles the sidebar when the toolbar button is pressed', () => {
    renderSidebar();
    const toggleButton = container!.querySelector<HTMLButtonElement>('.sidebar-toggle');
    expect(toggleButton).not.toBeNull();
    act(() => {
      toggleButton!.click();
    });
    expect(viewStateMock.toggleSidebar).toHaveBeenCalledTimes(1);
  });

  it('activates the browse cluster view when clicked', () => {
    renderSidebar();
    const browseItem = Array.from(
      container!.querySelectorAll<HTMLDivElement>('[data-sidebar-target-kind="cluster-view"]')
    ).find((item) => item.dataset.sidebarTargetView === 'browse');
    expect(browseItem).not.toBeNull();
    act(() => {
      browseItem!.click();
    });
    expect(viewStateMock.setViewType).toHaveBeenCalledWith('cluster');
    expect(viewStateMock.setActiveClusterView).toHaveBeenCalledWith('browse');
    expect(viewStateMock.setSidebarSelection).toHaveBeenCalledWith({
      type: 'cluster',
      value: 'cluster',
    });
  });

  it('selects the overview entry when clicked', () => {
    renderSidebar();
    const overviewItem = container!.querySelector<HTMLDivElement>(
      '[data-sidebar-target-kind="overview"]'
    );
    expect(overviewItem).not.toBeNull();
    act(() => {
      overviewItem!.click();
    });
    expect(viewStateMock.setViewType).toHaveBeenCalledWith('overview');
    expect(viewStateMock.setSidebarSelection).toHaveBeenCalledWith({
      type: 'overview',
      value: 'overview',
    });
  });

  it('collapses cluster resources when toggled', () => {
    renderSidebar();
    const nodesItemBefore = container!.querySelector<HTMLElement>(
      '[data-sidebar-target-kind="cluster-view"][data-sidebar-target-view="nodes"]'
    );
    expect(nodesItemBefore).not.toBeNull();

    const toggle = container!.querySelector<HTMLDivElement>(
      '[data-sidebar-target-kind="cluster-toggle"][data-sidebar-target-id="resources"]'
    );
    expect(toggle).not.toBeNull();
    act(() => {
      toggle!.click();
    });

    const nodesItemAfter = container!.querySelector(
      '[data-sidebar-target-kind="cluster-view"][data-sidebar-target-view="nodes"]'
    );
    expect(nodesItemAfter).toBeNull();
  });

  it('activates a specific cluster resource view when clicked', () => {
    renderSidebar();
    const nodesItem = container!.querySelector<HTMLDivElement>(
      '[data-sidebar-target-kind="cluster-view"][data-sidebar-target-view="nodes"]'
    );
    expect(nodesItem).not.toBeNull();
    act(() => {
      nodesItem!.click();
    });
    expect(viewStateMock.setViewType).toHaveBeenCalledWith('cluster');
    expect(viewStateMock.setActiveClusterView).toHaveBeenCalledWith('nodes');
  });

  it('scrolls expanded namespaces into view after toggling', () => {
    namespaceState.selectedNamespace = undefined;
    namespaceState.selectedNamespaceClusterId = undefined;
    renderSidebar();
    const originalScroll = Element.prototype.scrollIntoView;
    const scrollSpy = vi.fn();
    (Element.prototype as any).scrollIntoView = scrollSpy;
    const originalQuerySelector = document.querySelector;
    const fakeElement = {
      scrollIntoView: scrollSpy,
      getBoundingClientRect: () => ({ top: 0, bottom: 50 }) as DOMRect,
      closest: () => ({
        getBoundingClientRect: () => ({ top: 200, bottom: 300 }) as DOMRect,
      }),
      parentElement: {
        querySelector: () => ({
          getBoundingClientRect: () => ({ top: 400, bottom: 900 }) as DOMRect,
        }),
      },
    } as unknown as Element;
    document.querySelector = vi.fn((selector: string) => {
      if (selector.includes('.sidebar-item')) {
        return fakeElement;
      }
      return originalQuerySelector.call(document, selector);
    }) as typeof document.querySelector;

    vi.useFakeTimers();

    const namespaceToggle = container!.querySelector<HTMLDivElement>(
      `[data-sidebar-target-kind="namespace-toggle"][data-sidebar-target-namespace="${namespaceKey(
        'default'
      )}"]`
    );
    expect(namespaceToggle).not.toBeNull();
    act(() => {
      namespaceToggle!.click();
    });

    vi.runAllTimers();
    expect(scrollSpy).toHaveBeenCalled();
    vi.useRealTimers();
    if (originalScroll) {
      Element.prototype.scrollIntoView = originalScroll;
    } else {
      // @ts-expect-error cleanup
      delete Element.prototype.scrollIntoView;
    }
    document.querySelector = originalQuerySelector;
  });

  it('toggles namespace expansion without selecting a view', () => {
    renderSidebar();
    const namespaceToggle = container!.querySelector<HTMLDivElement>(
      `[data-sidebar-target-kind="namespace-toggle"][data-sidebar-target-namespace="${namespaceKey(
        'default'
      )}"]`
    );
    expect(namespaceToggle).not.toBeNull();

    act(() => {
      namespaceToggle!.click();
    });

    const namespaceViews = container!.querySelector(
      `[data-sidebar-target-kind="namespace-view"][data-sidebar-target-namespace="${namespaceKey(
        'default'
      )}"]`
    );
    expect(namespaceViews).not.toBeNull();
    expect(namespaceState.setSelectedNamespace).not.toHaveBeenCalled();
    expect(viewStateMock.onNamespaceSelect).not.toHaveBeenCalled();
    expect(viewStateMock.setActiveNamespaceTab).not.toHaveBeenCalled();
  });

  it('filters catalog namespace groups to the active cluster', () => {
    refreshMocks.catalogScopedStates = {
      'test-scope': {
        status: 'success',
        data: {
          namespaceGroups: [
            {
              clusterId: testClusterId,
              clusterName: 'Cluster A',
              namespaces: ['default'],
            },
            {
              clusterId: 'cluster-b',
              clusterName: 'Cluster B',
              namespaces: ['other'],
            },
          ],
        },
        stats: null,
        error: null,
        droppedAutoRefreshes: 0,
        scope: 'test-scope',
      },
    };
    renderSidebar();
    const namespaceToggle = container!.querySelector<HTMLDivElement>(
      `[data-sidebar-target-kind="namespace-toggle"][data-sidebar-target-namespace="${namespaceKey(
        'default'
      )}"]`
    );
    expect(namespaceToggle).not.toBeNull();
    const otherClusterToggle = container!.querySelector<HTMLDivElement>(
      '[data-sidebar-target-kind="namespace-toggle"][data-sidebar-target-namespace="cluster-b|other"]'
    );
    expect(otherClusterToggle).toBeNull();

    act(() => {
      namespaceToggle!.click();
    });

    expect(namespaceState.setSelectedNamespace).not.toHaveBeenCalled();
    expect(viewStateMock.onNamespaceSelect).not.toHaveBeenCalled();
  });

  it('collapses a namespace when clicked repeatedly', () => {
    renderSidebar();
    const namespaceToggle = container!.querySelector<HTMLDivElement>(
      `[data-sidebar-target-kind="namespace-toggle"][data-sidebar-target-namespace="${namespaceKey(
        'default'
      )}"]`
    );
    expect(namespaceToggle).not.toBeNull();

    act(() => {
      namespaceToggle!.click();
    });

    const namespaceViews = () =>
      container!.querySelector(
        `[data-sidebar-target-kind="namespace-view"][data-sidebar-target-namespace="${namespaceKey(
          'default'
        )}"]`
      );
    expect(namespaceViews()).not.toBeNull();

    act(() => {
      namespaceToggle!.click();
    });

    expect(namespaceViews()).toBeNull();
  });

  it('keeps All Namespaces clicks to expand/collapse only', () => {
    namespaceState.namespaces = [
      {
        name: 'All Namespaces',
        scope: ALL_NAMESPACES_SCOPE,
        resourceVersion: 'synthetic',
        hasWorkloads: true,
        workloadsUnknown: false,
        details: '',
      },
    ];
    renderSidebar();
    const namespaceToggle = container!.querySelector<HTMLDivElement>(
      `[data-sidebar-target-kind="namespace-toggle"][data-sidebar-target-namespace="${namespaceKey(
        ALL_NAMESPACES_SCOPE
      )}"]`
    );
    expect(namespaceToggle).not.toBeNull();

    act(() => {
      namespaceToggle!.click();
    });

    expect(namespaceState.setSelectedNamespace).not.toHaveBeenCalled();
    expect(viewStateMock.onNamespaceSelect).not.toHaveBeenCalled();
  });

  it('updates view state when selecting a namespace that is already focused', async () => {
    namespaceState.selectedNamespace = 'default';
    namespaceState.selectedNamespaceClusterId = testClusterId;
    renderSidebar({
      viewState: {
        sidebarSelection: { type: 'namespace', value: 'default' },
        viewType: 'namespace',
        activeNamespaceTab: 'pods',
      },
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const podsView = container!.querySelector<HTMLDivElement>(
      `[data-sidebar-target-kind="namespace-view"][data-sidebar-target-namespace="${namespaceKey(
        'default'
      )}"][data-sidebar-target-view="pods"]`
    );
    expect(podsView).not.toBeNull();

    act(() => {
      podsView!.click();
    });

    expect(viewStateMock.onNamespaceSelect).not.toHaveBeenCalled();
    expect(viewStateMock.setViewType).toHaveBeenCalledWith('namespace');
    expect(viewStateMock.setSidebarSelection).toHaveBeenCalledWith({
      type: 'namespace',
      value: 'default',
    });
  });

  it('selects a namespace view and notifies the namespace context', () => {
    renderSidebar();
    const namespaceToggle = container!.querySelector<HTMLDivElement>(
      `[data-sidebar-target-kind="namespace-toggle"][data-sidebar-target-namespace="${namespaceKey(
        'default'
      )}"]`
    );
    expect(namespaceToggle).not.toBeNull();
    act(() => {
      namespaceToggle!.click();
    });

    const podsView = container!.querySelector<HTMLDivElement>(
      `[data-sidebar-target-kind="namespace-view"][data-sidebar-target-namespace="${namespaceKey(
        'default'
      )}"][data-sidebar-target-view="pods"]`
    );
    expect(podsView).not.toBeNull();

    act(() => {
      podsView!.click();
    });

    expect(namespaceState.setSelectedNamespace).toHaveBeenCalledWith('default', testClusterId);
    expect(viewStateMock.onNamespaceSelect).toHaveBeenCalledWith('default');
    expect(viewStateMock.setActiveNamespaceTab).toHaveBeenCalledWith('pods');
  });

  it('allows modified navigation keys to bubble to global handlers', () => {
    renderSidebar();
    const focusable = container!.querySelector<HTMLElement>('[data-sidebar-focusable="true"]');
    expect(focusable).not.toBeNull();

    act(() => {
      focusable!.focus();
    });

    const plainArrowEvent = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      focusable!.dispatchEvent(plainArrowEvent);
    });
    expect(plainArrowEvent.defaultPrevented).toBe(true);

    const metaArrowEvent = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true,
      metaKey: true,
    });
    act(() => {
      focusable!.dispatchEvent(metaArrowEvent);
    });
    expect(metaArrowEvent.defaultPrevented).toBe(false);

    const shiftSpaceEvent = new KeyboardEvent('keydown', {
      key: ' ',
      code: 'Space',
      bubbles: true,
      cancelable: true,
      shiftKey: true,
    });
    act(() => {
      focusable!.dispatchEvent(shiftSpaceEvent);
    });
    expect(shiftSpaceEvent.defaultPrevented).toBe(false);
  });

  it('renders a loading spinner when namespaces are loading', () => {
    namespaceState.namespaceLoading = true;
    namespaceState.namespaces = [];
    renderSidebar();
    const spinnerText = container!.querySelector('.loading-spinner p')?.textContent;
    expect(spinnerText).toBe('Loading namespaces...');
  });

  it('applies workload status indicators on namespace entries', () => {
    namespaceState.namespaces = [
      {
        name: 'dimmed',
        scope: 'dimmed',
        resourceVersion: '1',
        hasWorkloads: false,
        workloadsUnknown: false,
        details: '',
      },
      {
        name: 'unknown',
        scope: 'unknown',
        resourceVersion: '2',
        hasWorkloads: true,
        workloadsUnknown: true,
        details: '',
      },
    ];
    renderSidebar();
    const dimmedItem = container!.querySelector(
      `[data-sidebar-target-namespace="${namespaceKey('dimmed')}"]`
    );
    expect(dimmedItem).not.toBeNull();
    expect(dimmedItem!.className).toContain('dimmed');
    const unknownBadge = container!.querySelector(
      `[data-sidebar-target-namespace="${namespaceKey('unknown')}"] .namespace-status-badge`
    );
    expect(unknownBadge?.textContent).toBe('Unknown');
  });

  it('renders in collapsed state when the sidebar is hidden', () => {
    renderSidebar({
      viewState: {
        isSidebarVisible: false,
      },
    });
    const sidebar = container!.querySelector('.sidebar');
    expect(sidebar).not.toBeNull();
    expect(sidebar!.classList.contains('collapsed')).toBe(true);
    expect(sidebar!.getAttribute('tabindex')).toBe('-1');
    expect(sidebar!.getAttribute('style')).toContain('width: 50px');
    const toggleButton = container!.querySelector<HTMLButtonElement>('.sidebar-toggle');
    expect(toggleButton?.getAttribute('aria-label')).toBe('Show Sidebar');
  });

  it('expands the active namespace based on view state selection on mount', async () => {
    namespaceState.selectedNamespace = 'default';
    namespaceState.selectedNamespaceClusterId = testClusterId;
    renderSidebar({
      viewState: {
        sidebarSelection: { type: 'namespace', value: 'default' },
        viewType: 'namespace',
        activeNamespaceTab: 'pods',
      },
    });
    await act(async () => {
      await Promise.resolve();
    });
    const podsView = container!.querySelector<HTMLDivElement>(
      `[data-sidebar-target-kind="namespace-view"][data-sidebar-target-namespace="${namespaceKey(
        'default'
      )}"][data-sidebar-target-view="pods"]`
    );
    expect(podsView).not.toBeNull();
  });
});
