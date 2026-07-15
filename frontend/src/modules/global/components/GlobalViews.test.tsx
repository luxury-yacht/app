import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GlobalViews from './GlobalViews';

vi.mock('./GlobalViewClusters', () => ({
  default: () => <div data-testid="global-clusters" />,
}));

vi.mock('./GlobalViewNamespaces', () => ({
  default: () => <div data-testid="global-namespaces" />,
}));

describe('GlobalViews', () => {
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

  it('routes the Global Clusters view', () => {
    act(() => root.render(<GlobalViews activeView="fleet" />));
    expect(container.querySelector('[data-testid="global-clusters"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="global-namespaces"]')).toBeNull();
  });

  it('routes the Global Namespaces view', () => {
    act(() => root.render(<GlobalViews activeView="global-namespaces" />));
    expect(container.querySelector('[data-testid="global-clusters"]')).toBeNull();
    expect(container.querySelector('[data-testid="global-namespaces"]')).not.toBeNull();
  });
});
