/**
 * frontend/src/modules/object-panel/components/ObjectPanel/ObjectPanelHeader.test.tsx
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

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

  it('renders kind badge and object name', async () => {
    await renderComponent({
      kind: 'Pod',
      kindAlias: null,
      name: 'worker-1',
    });

    const badge = container.querySelector('.kind-badge');
    const name = container.querySelector('.object-name');

    expect(badge?.textContent).toBe('Pod');
    expect(name?.textContent).toBe('worker-1');
  });

  it('attaches a hashed kind-color slot class and renders alias with title', async () => {
    await renderComponent({
      kind: 'Deployment@Beta',
      kindAlias: 'Workload',
      name: 'api',
    });

    const badge = container.querySelector('.kind-badge');
    const name = container.querySelector('.object-name');

    expect(badge?.textContent).toBe('Workload');
    expect(badge?.classList.contains('kind-badge')).toBe(true);
    const slotClass = Array.from(badge?.classList ?? []).find((c) => c.startsWith('hash-color-'));
    expect(slotClass).toMatch(/^hash-color-\d{1,2}$/);
    expect(badge?.getAttribute('title')).toBe('Deployment@Beta');
    expect(name?.textContent).toBe('api');
  });
});
