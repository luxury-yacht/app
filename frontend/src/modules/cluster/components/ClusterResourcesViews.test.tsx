import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ClusterResourcesViews from './ClusterResourcesViews';

vi.mock('@modules/cluster/components/ClusterViewConfig', () => ({ default: () => null }));
vi.mock('@modules/cluster/components/ClusterViewAttention', () => ({
  default: () => <div data-testid="attention" />,
}));
vi.mock('@modules/cluster/components/ClusterViewCRDs', () => ({ default: () => null }));
vi.mock('@modules/cluster/components/ClusterViewCustom', () => ({ default: () => null }));
vi.mock('@modules/cluster/components/ClusterViewEvents', () => ({ default: () => null }));
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

  it('renders the namespace summary inventory', () => {
    act(() => root.render(<ClusterResourcesViews activeTab="namespaces" />));

    expect(container.querySelector('[data-testid="namespaces"]')).not.toBeNull();
  });

  it('renders the cluster attention inventory', () => {
    act(() => root.render(<ClusterResourcesViews activeTab="attention" />));

    expect(container.querySelector('[data-testid="attention"]')).not.toBeNull();
  });
});
