import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ClusterResourcesViews from './ClusterResourcesViews';

vi.mock('@modules/namespace/components/NsViewWorkloads', () => ({
  default: (props: {
    namespace: string;
    showNamespaceColumn?: boolean;
    attentionOnly?: boolean;
  }) => (
    <div
      data-testid="needs-attention"
      data-namespace={props.namespace}
      data-show-namespace={String(props.showNamespaceColumn)}
      data-attention-only={String(props.attentionOnly)}
    />
  ),
}));

vi.mock('@modules/cluster/components/ClusterViewConfig', () => ({ default: () => null }));
vi.mock('@modules/cluster/components/ClusterViewCRDs', () => ({ default: () => null }));
vi.mock('@modules/cluster/components/ClusterViewCustom', () => ({ default: () => null }));
vi.mock('@modules/cluster/components/ClusterViewEvents', () => ({ default: () => null }));
vi.mock('@modules/cluster/components/GlobalViewClusters', () => ({
  default: () => <div data-testid="global-clusters" />,
}));
vi.mock('@modules/cluster/components/GlobalViewNamespaces', () => ({
  default: () => <div data-testid="global-namespaces" />,
}));
vi.mock('@modules/cluster/components/ClusterViewNamespaces', () => ({
  default: () => <div data-testid="namespaces" />,
}));
vi.mock('@modules/cluster/components/ClusterViewNodes', () => ({ default: () => null }));
vi.mock('@modules/cluster/components/ClusterViewRBAC', () => ({ default: () => null }));
vi.mock('@modules/cluster/components/ClusterViewStorage', () => ({ default: () => null }));

describe('ClusterResourcesViews', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('renders the unhealthy all-namespaces workload lens for Needs Attention', () => {
    act(() => root.render(<ClusterResourcesViews activeTab="attention" />));

    const lens = container.querySelector<HTMLElement>('[data-testid="needs-attention"]');
    expect(lens?.dataset.namespace).toBe(ALL_NAMESPACES_SCOPE);
    expect(lens?.dataset.showNamespace).toBe('true');
    expect(lens?.dataset.attentionOnly).toBe('true');
  });

  it('renders the global Clusters comparison view for the compatibility route', () => {
    act(() => root.render(<ClusterResourcesViews activeTab="fleet" />));

    expect(container.querySelector('[data-testid="global-clusters"]')).not.toBeNull();
  });

  it('renders the namespace summary inventory', () => {
    act(() => root.render(<ClusterResourcesViews activeTab="namespaces" />));

    expect(container.querySelector('[data-testid="namespaces"]')).not.toBeNull();
  });

  it('renders the global namespace summary inventory', () => {
    act(() => root.render(<ClusterResourcesViews activeTab="global-namespaces" />));

    expect(container.querySelector('[data-testid="global-namespaces"]')).not.toBeNull();
  });
});
