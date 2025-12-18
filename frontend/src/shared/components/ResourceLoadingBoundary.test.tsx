import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import ResourceLoadingBoundary from './ResourceLoadingBoundary';

describe('ResourceLoadingBoundary', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

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
  });

  it('shows a spinner while resources are loading', () => {
    act(() => {
      root.render(
        <ResourceLoadingBoundary loading dataLength={0} hasLoaded={false}>
          <div data-testid="content">content</div>
        </ResourceLoadingBoundary>
      );
    });

    const spinner = container.querySelector('.loading-spinner-container');
    expect(spinner).toBeTruthy();
    expect(spinner?.textContent).toContain('Loading resources...');
  });

  it('renders children when partial data is available', () => {
    act(() => {
      root.render(
        <ResourceLoadingBoundary
          loading
          dataLength={2}
          hasLoaded={false}
          allowPartial
          spinnerMessage="Waiting"
        >
          <div data-testid="content">ready</div>
        </ResourceLoadingBoundary>
      );
    });

    expect(container.querySelector('.loading-spinner-container')).toBeNull();
    expect(container.querySelector('[data-testid="content"]')?.textContent).toBe('ready');
  });

  it('warns when allowPartial is set but no data arrives', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await act(async () => {
      root.render(
        <ResourceLoadingBoundary loading={false} dataLength={0} hasLoaded={false} allowPartial>
          <div data-testid="content">empty</div>
        </ResourceLoadingBoundary>
      );
      await Promise.resolve();
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[ResourceLoadingBoundary] allowPartial is enabled')
    );

    warnSpy.mockRestore();
  });

  it('suppresses the empty warning when suppressEmptyWarning is true', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await act(async () => {
      root.render(
        <ResourceLoadingBoundary
          loading={false}
          dataLength={0}
          hasLoaded={false}
          allowPartial
          suppressEmptyWarning
        >
          <div data-testid="content">empty</div>
        </ResourceLoadingBoundary>
      );
      await Promise.resolve();
    });

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
