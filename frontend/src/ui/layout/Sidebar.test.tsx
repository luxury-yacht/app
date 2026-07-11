/**
 * frontend/src/ui/layout/Sidebar.test.tsx
 *
 * Test suite for Sidebar.
 * Covers key behaviors and edge cases for Sidebar.
 */

import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import { KeyboardProvider } from '@ui/shortcuts';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventBus } from '@/core/events';
import {
  resetAppPreferencesCacheForTesting,
  setAppPreferencesForTesting,
} from '@/core/settings/appPreferences';
import { requireValue } from '@/test-utils/requireValue';
import Sidebar from './Sidebar';

const runtimeMocks = vi.hoisted(() => ({
  eventsOn: vi.fn(),
  eventsOff: vi.fn(),
}));

const autoRefreshLoadingState = vi.hoisted(() => ({
  suppressPassiveLoading: false,
}));

const testClusterId = 'cluster-a';
const namespaceKey = (scope: string) => `${testClusterId}|${scope}`;

vi.mock('@wailsjs/runtime/runtime', () => ({
  EventsOn: runtimeMocks.eventsOn,
  EventsOff: runtimeMocks.eventsOff,
}));

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({ selectedClusterId: testClusterId }),
}));

vi.mock('@/core/refresh/hooks/useAutoRefreshLoadingState', () => ({
  useAutoRefreshLoadingState: () => autoRefreshLoadingState,
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
  namespacesPermissionDenied: boolean;
  namespaces: NamespaceEntry[];
  namespaceLoading: boolean;
  selectedNamespace?: string;
  selectedNamespaceClusterId?: string;
  setSelectedNamespace: (namespace: string, clusterId?: string) => void;
};

const createNamespaceState = (): NamespaceState => ({
  namespacesPermissionDenied: false,
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
      Element.prototype.scrollIntoView = () => undefined;
    }
  });

  afterAll(() => {
    if (nativeScrollIntoView) {
      Element.prototype.scrollIntoView = nativeScrollIntoView;
    } else {
      // @ts-expect-error cleanup
      Element.prototype.scrollIntoView = undefined;
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
      requireValue(root, 'expected test value in Sidebar.test.tsx').render(
        <KeyboardProvider>
          <Sidebar />
        </KeyboardProvider>
      );
    });
  };

  it('exposes navigation items and disclosure state with native buttons', () => {
    renderSidebar();

    const host = requireValue(container, 'expected Sidebar test container');
    const overview = host.querySelector<HTMLElement>('[data-sidebar-target-kind="overview"]');
    const resources = host.querySelector<HTMLElement>(
      '[data-sidebar-target-kind="cluster-toggle"]'
    );
    const namespace = host.querySelector<HTMLElement>(
      '[data-sidebar-target-kind="namespace-toggle"]'
    );

    expect(overview?.tagName).toBe('BUTTON');
    expect(overview?.getAttribute('aria-current')).toBe('page');
    expect(resources?.tagName).toBe('BUTTON');
    expect(resources?.getAttribute('aria-expanded')).toBe('true');
    expect(resources?.getAttribute('aria-controls')).toBeTruthy();
    expect(namespace?.tagName).toBe('BUTTON');
    expect(namespace?.getAttribute('aria-expanded')).toBe('false');
    expect(namespace?.getAttribute('aria-controls')).toBeTruthy();

    act(() => resources?.click());
    expect(resources?.getAttribute('aria-expanded')).toBe('false');
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    namespaceState = createNamespaceState();
    viewStateMock = createViewState();
    autoRefreshLoadingState.suppressPassiveLoading = false;
    resetAppPreferencesCacheForTesting();
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

  it('opens the command palette in namespace mode from the Namespaces header button', () => {
    renderSidebar();

    const button = document.querySelector<HTMLButtonElement>(
      '.namespaces-section h3 .sidebar-header-action'
    );
    expect(button).not.toBeNull();

    const openNamespaces = vi.fn();
    const unsubscribe = eventBus.on('command-palette:open-namespaces', openNamespaces);
    act(() => {
      requireValue(button, 'expected test value in Sidebar.test.tsx').click();
    });
    unsubscribe();

    expect(openNamespaces).toHaveBeenCalledTimes(1);
  });

  it('keeps the Namespaces header button when namespace listing is denied', () => {
    namespaceState.namespacesPermissionDenied = true;
    renderSidebar();

    expect(document.querySelector('.namespaces-section h3 .sidebar-header-action')).not.toBeNull();
  });

  it('shows the permission message and the scope editor when listing is denied', () => {
    // Fail-fast design: no catalog inference, no empty list — the user is told
    // exactly why the sidebar has no namespaces, and the inline scope editor
    // (docs/plans/namespace-scope.md) is the way in for a restricted identity.
    namespaceState.namespacesPermissionDenied = true;
    namespaceState.namespaces = [];
    renderSidebar();

    expect(
      requireValue(container, 'expected test value in Sidebar.test.tsx').textContent
    ).toContain('Insufficient permission to list namespaces.');
    expect(
      requireValue(container, 'expected test value in Sidebar.test.tsx').textContent
    ).toContain('Add namespace');
    expect(
      requireValue(container, 'expected test value in Sidebar.test.tsx').querySelector(
        '[data-sidebar-target-kind="namespace-toggle"]'
      )
    ).toBeNull();
  });

  it('does not expand inaccessible scope namespaces', () => {
    // A scope entry flagged not-found/no-access has no views to offer: the
    // row must not expand on click, must be excluded from keyboard
    // navigation, and must carry the warning flag.
    namespaceState.namespaces = [
      {
        name: 'ghost',
        scope: 'ghost',
        resourceVersion: '',
        hasWorkloads: false,
        workloadsUnknown: true,
        scopeStatus: 'not-found',
        details: '',
      },
      {
        name: 'default',
        scope: 'default',
        resourceVersion: '1',
        hasWorkloads: true,
        workloadsUnknown: false,
        details: '',
      },
    ] as NamespaceEntry[];
    renderSidebar();

    const rows = Array.from(
      requireValue(
        container,
        'expected test value in Sidebar.test.tsx'
      ).querySelectorAll<HTMLElement>('[data-sidebar-target-kind="namespace-toggle"]')
    );
    const ghostRow = rows.find((row) => row.textContent?.includes('ghost'));
    const defaultRow = rows.find((row) => row.textContent?.includes('default'));
    expect(ghostRow).toBeDefined();
    expect(defaultRow).toBeDefined();

    expect(
      requireValue(ghostRow, 'expected test value in Sidebar.test.tsx').getAttribute(
        'data-sidebar-focusable'
      )
    ).toBeNull();
    expect(
      requireValue(ghostRow, 'expected test value in Sidebar.test.tsx').querySelector(
        '.namespace-scope-flag'
      )
    ).not.toBeNull();
    expect(
      requireValue(defaultRow, 'expected test value in Sidebar.test.tsx').getAttribute(
        'data-sidebar-focusable'
      )
    ).toBe('true');

    act(() => {
      requireValue(ghostRow, 'expected test value in Sidebar.test.tsx').click();
    });
    expect(
      requireValue(container, 'expected test value in Sidebar.test.tsx').querySelector(
        '.namespaces-section .sidebar-views'
      )
    ).toBeNull();

    act(() => {
      requireValue(defaultRow, 'expected test value in Sidebar.test.tsx').click();
    });
    expect(
      requireValue(container, 'expected test value in Sidebar.test.tsx').querySelector(
        '.namespaces-section .sidebar-views'
      )
    ).not.toBeNull();
  });

  it('toggles the sidebar when the toolbar button is pressed', () => {
    renderSidebar();
    const toggleButton = requireValue(
      container,
      'expected test value in Sidebar.test.tsx'
    ).querySelector<HTMLButtonElement>('.sidebar-toggle');
    expect(toggleButton).not.toBeNull();
    act(() => {
      requireValue(toggleButton, 'expected test value in Sidebar.test.tsx').click();
    });
    expect(viewStateMock.toggleSidebar).toHaveBeenCalledTimes(1);
  });

  it('activates the browse cluster view when clicked', () => {
    renderSidebar();
    const browseItem = Array.from(
      requireValue(
        container,
        'expected test value in Sidebar.test.tsx'
      ).querySelectorAll<HTMLDivElement>('[data-sidebar-target-kind="cluster-view"]')
    ).find((item) => item.dataset.sidebarTargetView === 'browse');
    expect(browseItem).not.toBeNull();
    act(() => {
      requireValue(browseItem, 'expected test value in Sidebar.test.tsx').click();
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
    const overviewItem = requireValue(
      container,
      'expected test value in Sidebar.test.tsx'
    ).querySelector<HTMLDivElement>('[data-sidebar-target-kind="overview"]');
    expect(overviewItem).not.toBeNull();
    act(() => {
      requireValue(overviewItem, 'expected test value in Sidebar.test.tsx').click();
    });
    expect(viewStateMock.setViewType).toHaveBeenCalledWith('overview');
    expect(viewStateMock.setSidebarSelection).toHaveBeenCalledWith({
      type: 'overview',
      value: 'overview',
    });
  });

  it('collapses cluster resources when toggled', () => {
    renderSidebar();
    const nodesItemBefore = requireValue(
      container,
      'expected test value in Sidebar.test.tsx'
    ).querySelector<HTMLElement>(
      '[data-sidebar-target-kind="cluster-view"][data-sidebar-target-view="nodes"]'
    );
    expect(nodesItemBefore).not.toBeNull();

    const toggle = requireValue(
      container,
      'expected test value in Sidebar.test.tsx'
    ).querySelector<HTMLDivElement>(
      '[data-sidebar-target-kind="cluster-toggle"][data-sidebar-target-id="resources"]'
    );
    expect(toggle).not.toBeNull();
    act(() => {
      requireValue(toggle, 'expected test value in Sidebar.test.tsx').click();
    });

    const nodesItemAfter = requireValue(
      container,
      'expected test value in Sidebar.test.tsx'
    ).querySelector('[data-sidebar-target-kind="cluster-view"][data-sidebar-target-view="nodes"]');
    expect(nodesItemAfter).toBeNull();
  });

  it('activates a specific cluster resource view when clicked', () => {
    renderSidebar();
    const nodesItem = requireValue(
      container,
      'expected test value in Sidebar.test.tsx'
    ).querySelector<HTMLDivElement>(
      '[data-sidebar-target-kind="cluster-view"][data-sidebar-target-view="nodes"]'
    );
    expect(nodesItem).not.toBeNull();
    act(() => {
      requireValue(nodesItem, 'expected test value in Sidebar.test.tsx').click();
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
    Element.prototype.scrollIntoView = (options) => scrollSpy(options);
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

    const namespaceToggle = requireValue(
      container,
      'expected test value in Sidebar.test.tsx'
    ).querySelector<HTMLDivElement>(
      `[data-sidebar-target-kind="namespace-toggle"][data-sidebar-target-namespace="${namespaceKey(
        'default'
      )}"]`
    );
    expect(namespaceToggle).not.toBeNull();
    act(() => {
      requireValue(namespaceToggle, 'expected test value in Sidebar.test.tsx').click();
    });

    vi.runAllTimers();
    expect(scrollSpy).toHaveBeenCalled();
    vi.useRealTimers();
    if (originalScroll) {
      Element.prototype.scrollIntoView = originalScroll;
    } else {
      // @ts-expect-error cleanup
      Element.prototype.scrollIntoView = undefined;
    }
    document.querySelector = originalQuerySelector;
  });

  it('escapes namespace keys before building the expansion scroll selector', () => {
    namespaceState.namespaces = [
      {
        name: 'quoted',
        scope: 'default"bad',
        resourceVersion: '1',
        hasWorkloads: true,
        workloadsUnknown: false,
        details: '',
      },
    ];
    renderSidebar();

    const originalQuerySelector = document.querySelector;
    const querySelectorSpy = vi.fn(() => null);
    document.querySelector = querySelectorSpy as unknown as typeof document.querySelector;
    vi.useFakeTimers();

    const namespaceToggle = Array.from(
      requireValue(
        container,
        'expected test value in Sidebar.test.tsx'
      ).querySelectorAll<HTMLDivElement>('[data-sidebar-target-kind="namespace-toggle"]')
    ).find((element) => element.dataset.sidebarTargetNamespace === `${testClusterId}|default"bad`);
    expect(namespaceToggle).not.toBeUndefined();

    act(() => {
      requireValue(namespaceToggle, 'expected test value in Sidebar.test.tsx').click();
    });

    vi.runAllTimers();

    expect(querySelectorSpy).toHaveBeenCalledWith(
      '.sidebar-item[data-namespace="cluster-a|default\\"bad"]'
    );

    vi.useRealTimers();
    document.querySelector = originalQuerySelector;
  });

  it('toggles namespace expansion without selecting a view', () => {
    renderSidebar();
    const namespaceToggle = requireValue(
      container,
      'expected test value in Sidebar.test.tsx'
    ).querySelector<HTMLDivElement>(
      `[data-sidebar-target-kind="namespace-toggle"][data-sidebar-target-namespace="${namespaceKey(
        'default'
      )}"]`
    );
    expect(namespaceToggle).not.toBeNull();

    act(() => {
      requireValue(namespaceToggle, 'expected test value in Sidebar.test.tsx').click();
    });

    const namespaceViews = requireValue(
      container,
      'expected test value in Sidebar.test.tsx'
    ).querySelector(
      `[data-sidebar-target-kind="namespace-view"][data-sidebar-target-namespace="${namespaceKey(
        'default'
      )}"]`
    );
    expect(namespaceViews).not.toBeNull();
    expect(namespaceState.setSelectedNamespace).not.toHaveBeenCalled();
    expect(viewStateMock.onNamespaceSelect).not.toHaveBeenCalled();
    expect(viewStateMock.setActiveNamespaceTab).not.toHaveBeenCalled();
  });

  it('collapses a namespace when clicked repeatedly', () => {
    renderSidebar();
    const namespaceToggle = requireValue(
      container,
      'expected test value in Sidebar.test.tsx'
    ).querySelector<HTMLDivElement>(
      `[data-sidebar-target-kind="namespace-toggle"][data-sidebar-target-namespace="${namespaceKey(
        'default'
      )}"]`
    );
    expect(namespaceToggle).not.toBeNull();

    act(() => {
      requireValue(namespaceToggle, 'expected test value in Sidebar.test.tsx').click();
    });

    const namespaceViews = () =>
      requireValue(container, 'expected test value in Sidebar.test.tsx').querySelector(
        `[data-sidebar-target-kind="namespace-view"][data-sidebar-target-namespace="${namespaceKey(
          'default'
        )}"]`
      );
    expect(namespaceViews()).not.toBeNull();

    act(() => {
      requireValue(namespaceToggle, 'expected test value in Sidebar.test.tsx').click();
    });

    expect(namespaceViews()).toBeNull();
  });

  it('collapses the previous namespace by default when another namespace expands', () => {
    namespaceState.namespaces = [
      {
        name: 'default',
        scope: 'default',
        resourceVersion: '1',
        hasWorkloads: true,
        workloadsUnknown: false,
        details: '',
      },
      {
        name: 'kube-system',
        scope: 'kube-system',
        resourceVersion: '2',
        hasWorkloads: true,
        workloadsUnknown: false,
        details: '',
      },
    ];
    renderSidebar();

    const defaultToggle = requireValue(
      container,
      'expected test value in Sidebar.test.tsx'
    ).querySelector<HTMLDivElement>(
      `[data-sidebar-target-kind="namespace-toggle"][data-sidebar-target-namespace="${namespaceKey(
        'default'
      )}"]`
    );
    const kubeSystemToggle = requireValue(
      container,
      'expected test value in Sidebar.test.tsx'
    ).querySelector<HTMLDivElement>(
      `[data-sidebar-target-kind="namespace-toggle"][data-sidebar-target-namespace="${namespaceKey(
        'kube-system'
      )}"]`
    );
    expect(defaultToggle).not.toBeNull();
    expect(kubeSystemToggle).not.toBeNull();

    act(() => {
      requireValue(defaultToggle, 'expected test value in Sidebar.test.tsx').click();
    });
    expect(
      requireValue(container, 'expected test value in Sidebar.test.tsx').querySelector(
        `[data-sidebar-target-kind="namespace-view"][data-sidebar-target-namespace="${namespaceKey(
          'default'
        )}"]`
      )
    ).not.toBeNull();

    act(() => {
      requireValue(kubeSystemToggle, 'expected test value in Sidebar.test.tsx').click();
    });

    expect(
      requireValue(container, 'expected test value in Sidebar.test.tsx').querySelector(
        `[data-sidebar-target-kind="namespace-view"][data-sidebar-target-namespace="${namespaceKey(
          'default'
        )}"]`
      )
    ).toBeNull();
    expect(
      requireValue(container, 'expected test value in Sidebar.test.tsx').querySelector(
        `[data-sidebar-target-kind="namespace-view"][data-sidebar-target-namespace="${namespaceKey(
          'kube-system'
        )}"]`
      )
    ).not.toBeNull();
  });

  it('allows multiple expanded namespaces when exclusive namespaces is disabled', () => {
    setAppPreferencesForTesting({ exclusiveNamespaces: false });
    namespaceState.namespaces = [
      {
        name: 'default',
        scope: 'default',
        resourceVersion: '1',
        hasWorkloads: true,
        workloadsUnknown: false,
        details: '',
      },
      {
        name: 'kube-system',
        scope: 'kube-system',
        resourceVersion: '2',
        hasWorkloads: true,
        workloadsUnknown: false,
        details: '',
      },
    ];
    renderSidebar();

    const defaultToggle = requireValue(
      container,
      'expected test value in Sidebar.test.tsx'
    ).querySelector<HTMLDivElement>(
      `[data-sidebar-target-kind="namespace-toggle"][data-sidebar-target-namespace="${namespaceKey(
        'default'
      )}"]`
    );
    const kubeSystemToggle = requireValue(
      container,
      'expected test value in Sidebar.test.tsx'
    ).querySelector<HTMLDivElement>(
      `[data-sidebar-target-kind="namespace-toggle"][data-sidebar-target-namespace="${namespaceKey(
        'kube-system'
      )}"]`
    );
    expect(defaultToggle).not.toBeNull();
    expect(kubeSystemToggle).not.toBeNull();

    act(() => {
      requireValue(defaultToggle, 'expected test value in Sidebar.test.tsx').click();
      requireValue(kubeSystemToggle, 'expected test value in Sidebar.test.tsx').click();
    });

    expect(
      requireValue(container, 'expected test value in Sidebar.test.tsx').querySelector(
        `[data-sidebar-target-kind="namespace-view"][data-sidebar-target-namespace="${namespaceKey(
          'default'
        )}"]`
      )
    ).not.toBeNull();
    expect(
      requireValue(container, 'expected test value in Sidebar.test.tsx').querySelector(
        `[data-sidebar-target-kind="namespace-view"][data-sidebar-target-namespace="${namespaceKey(
          'kube-system'
        )}"]`
      )
    ).not.toBeNull();
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
    const namespaceToggle = requireValue(
      container,
      'expected test value in Sidebar.test.tsx'
    ).querySelector<HTMLDivElement>(
      `[data-sidebar-target-kind="namespace-toggle"][data-sidebar-target-namespace="${namespaceKey(
        ALL_NAMESPACES_SCOPE
      )}"]`
    );
    expect(namespaceToggle).not.toBeNull();

    act(() => {
      requireValue(namespaceToggle, 'expected test value in Sidebar.test.tsx').click();
    });

    expect(namespaceState.setSelectedNamespace).not.toHaveBeenCalled();
    expect(viewStateMock.onNamespaceSelect).not.toHaveBeenCalled();
  });

  it('hides the map view for All Namespaces only', () => {
    namespaceState.namespaces = [
      {
        name: 'All Namespaces',
        scope: ALL_NAMESPACES_SCOPE,
        resourceVersion: 'synthetic',
        hasWorkloads: true,
        workloadsUnknown: false,
        details: '',
      },
      {
        name: 'default',
        scope: 'default',
        resourceVersion: '1',
        hasWorkloads: true,
        workloadsUnknown: false,
        details: '',
      },
    ];
    renderSidebar();

    const allNamespacesToggle = requireValue(
      container,
      'expected test value in Sidebar.test.tsx'
    ).querySelector<HTMLDivElement>(
      `[data-sidebar-target-kind="namespace-toggle"][data-sidebar-target-namespace="${namespaceKey(
        ALL_NAMESPACES_SCOPE
      )}"]`
    );
    expect(allNamespacesToggle).not.toBeNull();
    act(() => {
      requireValue(allNamespacesToggle, 'expected test value in Sidebar.test.tsx').click();
    });
    expect(
      requireValue(container, 'expected test value in Sidebar.test.tsx').querySelector(
        `[data-sidebar-target-kind="namespace-view"][data-sidebar-target-namespace="${namespaceKey(
          ALL_NAMESPACES_SCOPE
        )}"][data-sidebar-target-view="map"]`
      )
    ).toBeNull();

    const defaultToggle = requireValue(
      container,
      'expected test value in Sidebar.test.tsx'
    ).querySelector<HTMLDivElement>(
      `[data-sidebar-target-kind="namespace-toggle"][data-sidebar-target-namespace="${namespaceKey(
        'default'
      )}"]`
    );
    expect(defaultToggle).not.toBeNull();
    act(() => {
      requireValue(defaultToggle, 'expected test value in Sidebar.test.tsx').click();
    });
    expect(
      requireValue(container, 'expected test value in Sidebar.test.tsx').querySelector(
        `[data-sidebar-target-kind="namespace-view"][data-sidebar-target-namespace="${namespaceKey(
          'default'
        )}"][data-sidebar-target-view="map"]`
      )
    ).not.toBeNull();
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

    const podsView = requireValue(
      container,
      'expected test value in Sidebar.test.tsx'
    ).querySelector<HTMLDivElement>(
      `[data-sidebar-target-kind="namespace-view"][data-sidebar-target-namespace="${namespaceKey(
        'default'
      )}"][data-sidebar-target-view="pods"]`
    );
    expect(podsView).not.toBeNull();

    act(() => {
      requireValue(podsView, 'expected test value in Sidebar.test.tsx').click();
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
    const namespaceToggle = requireValue(
      container,
      'expected test value in Sidebar.test.tsx'
    ).querySelector<HTMLDivElement>(
      `[data-sidebar-target-kind="namespace-toggle"][data-sidebar-target-namespace="${namespaceKey(
        'default'
      )}"]`
    );
    expect(namespaceToggle).not.toBeNull();
    act(() => {
      requireValue(namespaceToggle, 'expected test value in Sidebar.test.tsx').click();
    });

    const podsView = requireValue(
      container,
      'expected test value in Sidebar.test.tsx'
    ).querySelector<HTMLDivElement>(
      `[data-sidebar-target-kind="namespace-view"][data-sidebar-target-namespace="${namespaceKey(
        'default'
      )}"][data-sidebar-target-view="pods"]`
    );
    expect(podsView).not.toBeNull();

    act(() => {
      requireValue(podsView, 'expected test value in Sidebar.test.tsx').click();
    });

    expect(namespaceState.setSelectedNamespace).toHaveBeenCalledWith('default', testClusterId);
    expect(viewStateMock.onNamespaceSelect).toHaveBeenCalledWith('default');
    expect(viewStateMock.setActiveNamespaceTab).toHaveBeenCalledWith('pods');
  });

  it('allows modified navigation keys to bubble to global handlers', () => {
    renderSidebar();
    const focusable = requireValue(
      container,
      'expected test value in Sidebar.test.tsx'
    ).querySelector<HTMLElement>('[data-sidebar-focusable="true"]');
    expect(focusable).not.toBeNull();

    act(() => {
      requireValue(focusable, 'expected test value in Sidebar.test.tsx').focus();
    });

    const plainArrowEvent = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      requireValue(focusable, 'expected test value in Sidebar.test.tsx').dispatchEvent(
        plainArrowEvent
      );
    });
    expect(plainArrowEvent.defaultPrevented).toBe(true);

    const metaArrowEvent = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true,
      metaKey: true,
    });
    act(() => {
      requireValue(focusable, 'expected test value in Sidebar.test.tsx').dispatchEvent(
        metaArrowEvent
      );
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
      requireValue(focusable, 'expected test value in Sidebar.test.tsx').dispatchEvent(
        shiftSpaceEvent
      );
    });
    expect(shiftSpaceEvent.defaultPrevented).toBe(false);
  });

  it('renders a loading spinner when namespaces are loading', () => {
    namespaceState.namespaceLoading = true;
    namespaceState.namespaces = [];
    renderSidebar();
    const spinnerText = requireValue(
      container,
      'expected test value in Sidebar.test.tsx'
    ).querySelector('.loading-spinner p')?.textContent;
    expect(spinnerText).toBe('Loading namespaces...');
  });

  it('shows an auto-refresh disabled message when namespaces have not loaded and refresh is paused', () => {
    autoRefreshLoadingState.suppressPassiveLoading = true;
    namespaceState.namespaceLoading = false;
    namespaceState.namespaces = [];

    renderSidebar();

    expect(
      requireValue(container, 'expected test value in Sidebar.test.tsx').textContent
    ).toContain('Auto-refresh is disabled');
  });

  it('renders unknown-workload namespaces exactly like normal ones and dims only confirmed-empty', () => {
    namespaceState.namespaces = [
      {
        name: 'empty',
        scope: 'empty',
        resourceVersion: '1',
        hasWorkloads: false,
        workloadsUnknown: false,
        details: '',
      },
      {
        name: 'pending',
        scope: 'pending',
        resourceVersion: '2',
        hasWorkloads: false,
        workloadsUnknown: true,
        details: '',
      },
      {
        name: 'active',
        scope: 'active',
        resourceVersion: '3',
        hasWorkloads: true,
        workloadsUnknown: false,
        details: '',
      },
    ];
    renderSidebar();
    const itemFor = (name: string) =>
      requireValue(container, 'expected test value in Sidebar.test.tsx').querySelector(
        `[data-sidebar-target-namespace="${namespaceKey(name)}"]`
      );

    // Confirmed absence of workloads is the ONLY state that changes presentation.
    expect(
      requireValue(itemFor('empty'), 'expected test value in Sidebar.test.tsx').className
    ).toContain('dimmed');

    // Not-yet-known must be indistinguishable from a normal namespace: the transient
    // startup state (ingest stores not settled) must not draw the eye.
    expect(
      requireValue(itemFor('pending'), 'expected test value in Sidebar.test.tsx').className
    ).toBe(requireValue(itemFor('active'), 'expected test value in Sidebar.test.tsx').className);
    expect(
      requireValue(itemFor('pending'), 'expected test value in Sidebar.test.tsx').className
    ).not.toContain('dimmed');
    expect(
      requireValue(itemFor('pending'), 'expected test value in Sidebar.test.tsx').className
    ).not.toContain('workloads-unknown');
    expect(
      requireValue(container, 'expected test value in Sidebar.test.tsx').querySelector(
        '.status-text.warning'
      )
    ).toBeNull();
    expect(
      requireValue(itemFor('pending'), 'expected test value in Sidebar.test.tsx').getAttribute(
        'title'
      ) ?? ''
    ).not.toContain('Unable to determine');
  });

  it('does not dim inactive namespaces when the display setting is disabled', () => {
    setAppPreferencesForTesting({ dimInactiveNamespaces: false });
    namespaceState.namespaces = [
      {
        name: 'inactive',
        scope: 'inactive',
        resourceVersion: '1',
        hasWorkloads: false,
        workloadsUnknown: false,
        details: '',
      },
    ];

    renderSidebar();

    const inactiveItem = requireValue(
      container,
      'expected test value in Sidebar.test.tsx'
    ).querySelector(`[data-sidebar-target-namespace="${namespaceKey('inactive')}"]`);
    expect(inactiveItem).not.toBeNull();
    expect(
      requireValue(inactiveItem, 'expected test value in Sidebar.test.tsx').className
    ).not.toContain('dimmed');
  });

  it('renders in collapsed state when the sidebar is hidden', () => {
    renderSidebar({
      viewState: {
        isSidebarVisible: false,
      },
    });
    const sidebar = requireValue(
      container,
      'expected test value in Sidebar.test.tsx'
    ).querySelector('.sidebar');
    expect(sidebar).not.toBeNull();
    expect(
      requireValue(sidebar, 'expected test value in Sidebar.test.tsx').classList.contains(
        'collapsed'
      )
    ).toBe(true);
    expect(
      requireValue(sidebar, 'expected test value in Sidebar.test.tsx').getAttribute('tabindex')
    ).toBe('-1');
    expect(
      requireValue(sidebar, 'expected test value in Sidebar.test.tsx').getAttribute('style')
    ).toContain('width: 50px');
    const toggleButton = requireValue(
      container,
      'expected test value in Sidebar.test.tsx'
    ).querySelector<HTMLButtonElement>('.sidebar-toggle');
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
    const podsView = requireValue(
      container,
      'expected test value in Sidebar.test.tsx'
    ).querySelector<HTMLDivElement>(
      `[data-sidebar-target-kind="namespace-view"][data-sidebar-target-namespace="${namespaceKey(
        'default'
      )}"][data-sidebar-target-view="pods"]`
    );
    expect(podsView).not.toBeNull();
  });
});
