import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DebugOverlay } from './DebugOverlay';

describe('DebugOverlay', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    document.body.innerHTML = '';
  });

  const renderOverlay = (props?: Partial<React.ComponentProps<typeof DebugOverlay>>) => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);

    act(() => {
      root.render(
        <DebugOverlay title="Keyboard Focus" testId="debug-overlay-under-test" {...props}>
          <div>Overlay content</div>
        </DebugOverlay>
      );
    });
  };

  it('renders into document.body without requiring the sidebar host', () => {
    renderOverlay();

    expect(container.querySelector('[data-testid="debug-overlay-under-test"]')).toBeNull();
    expect(document.body.querySelector('[data-testid="debug-overlay-under-test"]')).not.toBeNull();
  });

  it('calls onClose from the close button', () => {
    const onClose = vi.fn();
    renderOverlay({ onClose });

    const closeButton = document.body.querySelector<HTMLButtonElement>(
      '[aria-label="Close debug overlay"]'
    );

    expect(closeButton).not.toBeNull();

    act(() => {
      closeButton?.click();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
