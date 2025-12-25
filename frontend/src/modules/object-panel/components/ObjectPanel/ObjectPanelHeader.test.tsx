/**
 * frontend/src/modules/object-panel/components/ObjectPanel/ObjectPanelHeader.test.tsx
 *
 * Tests for ObjectPanelHeader.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { ObjectPanelHeader } from './ObjectPanelHeader';

describe('ObjectPanelHeader', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  const renderComponent = async (props: React.ComponentProps<typeof ObjectPanelHeader>) => {
    await act(async () => {
      root.render(<ObjectPanelHeader {...props} />);
      await Promise.resolve();
    });
  };

  const getNavButtons = () =>
    Array.from(container.querySelectorAll<HTMLButtonElement>('.nav-button'));

  beforeEach(() => {
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

  it('disables navigation buttons at boundaries', async () => {
    const onNavigate = vi.fn();
    await renderComponent({
      navigationIndex: 0,
      navigationCount: 1,
      onNavigate,
      kind: 'Deployment',
      kindAlias: null,
      name: 'api',
    });

    const [previous, next] = getNavButtons();
    expect(previous?.disabled).toBe(true);
    expect(next?.disabled).toBe(true);

    act(() => {
      previous?.click();
      next?.click();
    });
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('navigates backward and forward when possible', async () => {
    const onNavigate = vi.fn();
    await renderComponent({
      navigationIndex: 1,
      navigationCount: 3,
      onNavigate,
      kind: 'Pod',
      kindAlias: 'Workload',
      name: 'worker-1',
    });

    const [previous, next] = getNavButtons();
    expect(previous?.disabled).toBe(false);
    expect(next?.disabled).toBe(false);

    act(() => {
      previous?.click();
      next?.click();
    });

    expect(onNavigate).toHaveBeenNthCalledWith(1, 0);
    expect(onNavigate).toHaveBeenNthCalledWith(2, 2);
  });

  it('sanitizes the kind class and renders alias with title', async () => {
    await renderComponent({
      navigationIndex: 0,
      navigationCount: 2,
      onNavigate: () => {},
      kind: 'Deployment@Beta',
      kindAlias: 'Workload',
      name: 'api',
    });

    const badge = container.querySelector('.kind-badge');
    const name = container.querySelector('.object-name');

    expect(badge?.textContent).toBe('Workload');
    expect(badge?.classList.contains('kind-badge')).toBe(true);
    expect(badge?.classList.contains('deploymentbeta')).toBe(true);
    expect(badge?.getAttribute('title')).toBe('Deployment@Beta');
    expect(name?.textContent).toBe('api');
  });
});
