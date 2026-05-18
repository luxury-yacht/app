import ReactDOMClient from 'react-dom/client';
import * as ReactDOM from 'react-dom';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import StatusIndicator from './StatusIndicator';

vi.mock('react-dom', async () => {
  const actual = await vi.importActual<typeof import('react-dom')>('react-dom');
  return {
    ...actual,
    createPortal: vi.fn((element: any) => element),
  };
});

vi.mock('@core/contexts/ZoomContext', () => ({
  useZoom: () => ({ zoomLevel: 100 }),
}));

const renderStatusIndicator = async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOMClient.createRoot(container);

  await act(async () => {
    root.render(
      <StatusIndicator
        status="healthy"
        title="Connectivity"
        message="Connected"
        ariaLabel="Connectivity status"
      />
    );
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

describe('StatusIndicator', () => {
  beforeEach(() => {
    vi.mocked(ReactDOM.createPortal).mockImplementation((element: any) => element as any);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('layers status popovers above dockable object panels', async () => {
    const { container, cleanup } = await renderStatusIndicator();
    const trigger = container.querySelector('.tooltip-trigger') as HTMLElement;

    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      vi.advanceTimersByTime(150);
    });

    const popover = container.querySelector('.status-popover') as HTMLElement;
    expect(popover.style.zIndex).toBe('var(--z-index-tooltip, 3200)');

    cleanup();
  });
});
