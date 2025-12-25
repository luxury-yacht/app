/**
 * frontend/src/shared/components/errors/ResourceBarErrorBoundary.test.tsx
 *
 * Test suite for ResourceBarErrorBoundary.
 * Covers key behaviors and edge cases for ResourceBarErrorBoundary.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import ResourceBarErrorBoundary from './ResourceBarErrorBoundary';

const UnstableMetric = ({ shouldThrow }: { shouldThrow: boolean }) => {
  if (shouldThrow) {
    throw new Error('metrics failed');
  }

  return <div data-testid="metrics">Metrics</div>;
};

describe('ResourceBarErrorBoundary', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  let consoleErrorSpy: any;

  const renderBoundary = async (child: React.ReactNode, fallback?: React.ReactNode) => {
    await act(async () => {
      root.render(<ResourceBarErrorBoundary fallback={fallback}>{child}</ResourceBarErrorBoundary>);
      await Promise.resolve();
    });
  };

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    consoleErrorSpy = vi.spyOn(console, 'error');
    consoleErrorSpy.mockImplementation(() => {});
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    consoleErrorSpy.mockRestore();
  });

  it('renders child content when no error is raised', async () => {
    await renderBoundary(<UnstableMetric shouldThrow={false} />);
    expect(container.querySelector('[data-testid="metrics"]')).toBeTruthy();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('renders the default fallback when metrics fail', async () => {
    await renderBoundary(<UnstableMetric shouldThrow />);
    expect(container.querySelector('.resource-bar-container')).toBeTruthy();
    expect(container.textContent).toContain('Unable to display metrics');
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('uses a custom fallback and recovers after props change', async () => {
    await renderBoundary(
      <UnstableMetric shouldThrow />,
      <div data-testid="custom-fallback">Fallback content</div>
    );
    expect(container.querySelector('[data-testid="custom-fallback"]')).toBeTruthy();

    await renderBoundary(<UnstableMetric shouldThrow={false} />);
    expect(container.querySelector('[data-testid="custom-fallback"]')).toBeNull();
    expect(container.querySelector('[data-testid="metrics"]')).toBeTruthy();
  });
});
