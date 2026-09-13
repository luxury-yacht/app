import { ViewStateProvider } from '@core/contexts/ViewStateContext';
import { ObjectPanelLink } from '@shared/components/ObjectPanelLink';
import { setPendingFocusRequest } from '@shared/components/tables/hooks/useGridTableExternalFocus';
import { KeyboardProvider } from '@ui/shortcuts';
import { act, createContext, type ReactNode, StrictMode, useContext, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAppPreferencesCacheForTesting } from '@/core/settings/appPreferences';
import { requireValue } from '@/test-utils/requireValue';
import type { KubernetesObjectReference } from '@/types/view-state';
import Sidebar from './Sidebar';

const fixtures = vi.hoisted(() => ({
  clusterId: 'cluster-a',
  catalogClusterId: 'cluster-a',
  clusterIds: ['cluster-a', 'cluster-b'],
  families: { cluster: ['karpenter'], namespaced: ['argocd'] },
}));
vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({
    selectedClusterId: fixtures.clusterId,
    selectedClusterIds: fixtures.clusterIds,
  }),
}));
vi.mock('@core/desktop-runtime', () => ({
  desktopRuntimeAvailable: () => false,
  onEvent: () => () => undefined,
}));
vi.mock('@/core/refresh', () => ({ refreshOrchestrator: { updateContext: vi.fn() } }));
vi.mock('@/core/telemetry/sentry', () => ({ setActiveViewContext: vi.fn() }));
vi.mock('@modules/object-panel/contexts/ObjectPanelStateContext', () => ({
  ObjectPanelStateProvider: ({ children }: { children: ReactNode }) => children,
  useObjectPanelState: () => ({ showObjectPanel: false }),
}));
vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => ({ openWithObject: vi.fn() }),
}));
vi.mock('@/core/refresh/hooks/useAutoRefreshLoadingState', () => ({
  useAutoRefreshLoadingState: () => ({ suppressPassiveLoading: false }),
}));
vi.mock('@/core/refresh/hooks/useStreamSignalRefetch', () => ({
  useStreamSignalRefetch: vi.fn(),
}));
vi.mock('@/core/data-access', () => ({
  useRefreshDomainHandle: ({ domain }: { domain: string }) => ({
    data:
      domain === 'catalog'
        ? { clusterId: fixtures.catalogClusterId, resourceFamilies: fixtures.families }
        : undefined,
  }),
}));
vi.mock('./namespaceScope', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./namespaceScope')>()),
  loadNamespaceScope: async () => [],
}));

type NamespaceSelection = { namespace: string; clusterId?: string };
const NamespaceFixtureContext = createContext({
  selection: null as NamespaceSelection | null,
  select: (_selection: NamespaceSelection): void => undefined,
});
vi.mock('@modules/namespace/contexts/NamespaceContext', () => ({
  useNamespace: () => {
    const { selection, select } = useContext(NamespaceFixtureContext);
    return {
      namespaces: ['default', 'other'].map((name) => ({ name, scope: name, hasWorkloads: true })),
      namespaceLoading: false,
      namespacesPermissionDenied: false,
      selectedNamespace: selection?.namespace,
      selectedNamespaceClusterId: selection?.clusterId,
      setSelectedNamespace: (namespace: string, clusterId?: string) =>
        select({ namespace, clusterId }),
    };
  },
}));

function NamespaceFixture({ children }: { children: ReactNode }) {
  const [selection, select] = useState<NamespaceSelection | null>(null);
  return (
    <NamespaceFixtureContext.Provider value={{ selection, select }}>
      {children}
    </NamespaceFixtureContext.Provider>
  );
}

describe('resource link sidebar navigation', () => {
  let host: HTMLDivElement;
  let root: Root;
  const nativeScrollIntoView = Element.prototype.scrollIntoView;
  beforeEach(() => {
    fixtures.clusterId = 'cluster-a';
    fixtures.catalogClusterId = 'cluster-a';
    fixtures.families = { cluster: ['karpenter'], namespaced: ['argocd'] };
    resetAppPreferencesCacheForTesting();
    Element.prototype.scrollIntoView = vi.fn();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    setPendingFocusRequest(null);
    host.remove();
    Element.prototype.scrollIntoView = nativeScrollIntoView;
    vi.clearAllMocks();
  });

  const render = async (objectRef: KubernetesObjectReference) => {
    await act(async () => {
      root.render(
        <StrictMode>
          <ViewStateProvider>
            <NamespaceFixture>
              <KeyboardProvider>
                <ObjectPanelLink objectRef={objectRef}>Reveal object</ObjectPanelLink>
                <Sidebar />
              </KeyboardProvider>
            </NamespaceFixture>
          </ViewStateProvider>
        </StrictMode>
      );
    });
  };
  const button = (selector: string) =>
    requireValue(host.querySelector<HTMLButtonElement>(selector), `expected ${selector}`);
  const altClick = () => {
    act(() => {
      button('.object-panel-link').dispatchEvent(
        new MouseEvent('click', { bubbles: true, altKey: true })
      );
    });
  };

  it.each([
    { kind: 'ConfigMap', group: '', namespace: 'default', view: 'config', category: 'resources' },
    {
      kind: 'Application',
      group: 'argoproj.io',
      namespace: 'other',
      view: 'argocd',
      category: 'extensions',
    },
    { kind: 'Node', group: '', namespace: '', view: 'nodes', category: 'resources' },
    {
      kind: 'NodePool',
      group: 'karpenter.sh',
      namespace: '',
      view: 'karpenter',
      category: 'extensions',
    },
  ])('reveals $kind navigation and can reveal it again after manual collapse', async (target) => {
    const ref = {
      ...target,
      clusterId: 'cluster-a',
      version: target.kind === 'Application' ? 'v1alpha1' : 'v1',
      name: 'example',
    };
    await render(ref);
    const scope = target.namespace
      ? `[data-sidebar-target-kind="namespace-view"][data-sidebar-target-namespace="cluster-a|${target.namespace}"]`
      : '[data-sidebar-target-kind="cluster-view"]';
    const destination = `${scope}[data-sidebar-target-view="${target.view}"]`;
    expect(host.querySelector(destination)).toBeNull();
    altClick();
    expect(button(destination).getAttribute('aria-current')).toBe('page');
    const groupScope = target.namespace
      ? `[data-sidebar-target-kind="namespace-group-toggle"][data-sidebar-target-namespace="cluster-a|${target.namespace}"]`
      : '[data-sidebar-target-kind="cluster-toggle"]';
    const category = button(`${groupScope}[data-sidebar-target-id="${target.category}"]`);
    const otherCategory = target.category === 'resources' ? 'extensions' : 'resources';
    expect(
      button(`${groupScope}[data-sidebar-target-id="${otherCategory}"]`).getAttribute(
        'aria-expanded'
      )
    ).toBe('false');
    act(() => category.click());
    await render(ref);
    expect(host.querySelector(destination)).toBeNull();
    altClick();
    expect(button(destination).getAttribute('aria-current')).toBe('page');
    if (target.namespace) {
      act(() =>
        button(
          `[data-sidebar-target-kind="namespace-toggle"][data-sidebar-target-namespace="cluster-a|${target.namespace}"]`
        ).click()
      );
      expect(host.querySelector(destination)).toBeNull();
      altClick();
      expect(button(destination).getAttribute('aria-current')).toBe('page');
      const otherNamespace = target.namespace === 'default' ? 'other' : 'default';
      expect(
        button(
          `[data-sidebar-target-kind="namespace-toggle"][data-sidebar-target-namespace="cluster-a|${otherNamespace}"]`
        ).getAttribute('aria-expanded')
      ).toBe('false');
    }
  });

  it('reveals an extension once its own cluster discovery is available', async () => {
    fixtures.catalogClusterId = 'cluster-b';
    const ref = {
      clusterId: 'cluster-a',
      group: 'argoproj.io',
      version: 'v1alpha1',
      kind: 'Application',
      namespace: 'other',
      name: 'example',
    };
    await render(ref);
    altClick();
    const namespace = '[data-sidebar-target-namespace="cluster-a|other"]';
    const destination = `${namespace}[data-sidebar-target-view="argocd"]`;
    expect(host.querySelector(destination)).toBeNull();
    expect(
      button(`${namespace}[data-sidebar-target-id="extensions"]`).getAttribute('aria-expanded')
    ).toBe('false');
    fixtures.catalogClusterId = 'cluster-a';
    await render(ref);
    expect(button(destination).getAttribute('aria-current')).toBe('page');
  });
});
