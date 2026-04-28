/**
 * frontend/src/shared/components/kubernetes/ResourceMetadata.test.tsx
 *
 * Test suite for ResourceMetadata.
 * Covers key behaviors and edge cases for ResourceMetadata.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@shared/components/Tooltip', () => ({
  __esModule: true,
  default: ({ children }: any) => <>{children}</>,
}));

import { ResourceMetadata } from './ResourceMetadata';

const renderMetadata = async (props: React.ComponentProps<typeof ResourceMetadata>) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);

  await act(async () => {
    root.render(<ResourceMetadata {...props} />);
    await Promise.resolve();
  });

  return {
    container,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
};

describe('ResourceMetadata', () => {
  let container: HTMLDivElement | null;

  beforeEach(() => {
    container = null;
  });

  afterEach(() => {
    container?.remove();
  });

  it('returns null when no metadata is provided', async () => {
    const result = await renderMetadata({});
    container = result.container;
    expect(result.container.innerHTML).toBe('');
    result.cleanup();
  });

  it('highlights selector labels when showSelector is enabled', async () => {
    const { container: root, cleanup } = await renderMetadata({
      showSelector: true,
      selector: { app: 'demo', tier: 'frontend' },
      labels: { app: 'demo' },
    });
    container = root;
    const chips = root.querySelectorAll('.status-chip--info');
    expect(chips.length).toBe(2);
    expect(root.textContent).toContain('app');
    expect(root.textContent).toContain('tier');
    cleanup();
  });

  it('renders selectors even when labels are absent', async () => {
    const { container: root, cleanup } = await renderMetadata({
      showSelector: true,
      selector: { component: 'worker' },
    });
    container = root;
    expect(root.querySelector('.status-chip--info')).toBeTruthy();
    expect(root.textContent).toContain('component');
    cleanup();
  });

  it('renders labels and annotations via shared component', async () => {
    const { container: root, cleanup } = await renderMetadata({
      labels: { app: 'demo' },
      annotations: { 'deployment.kubernetes.io/revision': '5' },
    });
    container = root;
    expect(root.textContent).toContain('app');
    expect(root.textContent).toContain('deployment.kubernetes.io/revision');
    cleanup();
  });
});
