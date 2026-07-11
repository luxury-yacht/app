/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/DetailsTabDataErrorBoundary.test.tsx
 */

import type React from 'react';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';

import DetailsTabDataErrorBoundary from './DetailsTabDataErrorBoundary';

const ThrowingChild = ({ shouldThrow }: { shouldThrow: boolean }) => {
  if (shouldThrow) {
    throw new Error('boom');
  }

  return <div data-testid="safe-child">Rendered</div>;
};

describe('DetailsTabDataErrorBoundary', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  let consoleErrorSpy: MockInstance;

  const renderBoundary = async (child: React.ReactNode, fallback?: React.ReactNode) => {
    await act(async () => {
      root.render(
        <DetailsTabDataErrorBoundary fallback={fallback}>{child}</DetailsTabDataErrorBoundary>
      );
      await Promise.resolve();
    });
  };

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    consoleErrorSpy = vi.spyOn(console, 'error');
    consoleErrorSpy.mockImplementation(() => undefined);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    consoleErrorSpy.mockRestore();
  });

  it('renders children when no error occurs', async () => {
    await renderBoundary(<ThrowingChild shouldThrow={false} />);
    expect(container.querySelector('[data-testid="safe-child"]')).toBeTruthy();
    expect(container.textContent).toContain('Rendered');
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('renders the default fallback when a child throws', async () => {
    await renderBoundary(<ThrowingChild shouldThrow={true} />);

    const title = container.querySelector('.object-panel-section-title');
    expect(title?.textContent).toContain('Data');
    expect(container.textContent).toContain('Error loading data');
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('resets the error state when children change and renders provided fallback', async () => {
    await renderBoundary(
      <ThrowingChild shouldThrow={true} />,
      <div data-testid="custom-fallback">Something went wrong</div>
    );
    expect(container.querySelector('[data-testid="custom-fallback"]')).toBeTruthy();

    await renderBoundary(<ThrowingChild shouldThrow={false} />);
    expect(container.querySelector('[data-testid="custom-fallback"]')).toBeNull();
    expect(container.querySelector('[data-testid="safe-child"]')).toBeTruthy();
  });
});
