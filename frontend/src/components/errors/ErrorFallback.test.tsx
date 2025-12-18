import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorFallback } from './ErrorFallback';

describe('ErrorFallback', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  const originalEnv = import.meta.env.DEV;

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

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
    (import.meta.env as any).DEV = originalEnv;
  });

  it('renders scope-aware messaging and invokes reset callback', async () => {
    const reset = vi.fn();
    await act(async () => {
      root.render(
        <ErrorFallback
          error={new Error('boom')}
          errorInfo={null}
          resetError={reset}
          scope="object-panel"
        />
      );
      await Promise.resolve();
    });

    expect(container.querySelector('.error-message')?.textContent).toContain('object-panel');

    const resetButton = container.querySelector('.btn-reset') as HTMLButtonElement;
    act(() => {
      resetButton.click();
    });
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('shows dev details and fallback actions reload page', async () => {
    const reloadMock = vi.fn();
    const locationGetter = vi.spyOn(window, 'location', 'get');
    locationGetter.mockReturnValue({ reload: reloadMock } as unknown as Location);
    (import.meta.env as any).DEV = true;

    await act(async () => {
      root.render(
        <ErrorFallback
          error={new Error('stack')}
          errorInfo={{ componentStack: 'Component stack trace' } as any}
          resetError={vi.fn()}
          scope={undefined}
        />
      );
      await Promise.resolve();
    });

    const details = container.querySelector('.error-details') as HTMLDetailsElement;
    expect(details).toBeTruthy();
    expect(details.textContent).toContain('Component stack trace');

    const reloadButton = container.querySelector('.btn-reload') as HTMLButtonElement;
    act(() => {
      reloadButton.click();
    });
    expect(reloadMock).toHaveBeenCalledTimes(1);
    locationGetter.mockRestore();
  });
});
