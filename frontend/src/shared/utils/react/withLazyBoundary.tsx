/**
 * frontend/src/components/hoc/withLazyBoundary.tsx
 *
 * UI component for withLazyBoundary.
 * Handles rendering and interactions for the shared components.
 */

import React, { Component, ComponentType, ComponentProps, lazy, Suspense, ReactNode } from 'react';
import LoadingSpinner from '@shared/components/LoadingSpinner';
import { errorHandler } from '@utils/errorHandler';

// Simple inline ErrorBoundary
class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    errorHandler.handle(error, { action: 'componentError', errorInfo });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary" data-testid="error-boundary">
          <h2>Something went wrong</h2>
          <details style={{ whiteSpace: 'pre-wrap' }}>
            {this.state.error && this.state.error.toString()}
          </details>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * Higher-Order Component that wraps a component with error boundary and lazy loading
 *
 * @param importFn - Dynamic import function for the component
 * @param loadingMessage - Optional message to display while loading
 * @returns A component wrapped with ErrorBoundary and Suspense
 *
 * @example
 * // Instead of:
 * const Settings = lazy(() => import('./components/Settings'));
 * // In render:
 * <ErrorBoundary>
 *   <Suspense fallback={<LoadingSpinner message="Loading settings..." />}>
 *     <Settings {...props} />
 *   </Suspense>
 * </ErrorBoundary>
 *
 * // Use:
 * const Settings = withLazyBoundary(
 *   () => import('./components/Settings'),
 *   'Loading settings...'
 * );
 * // In render:
 * <Settings {...props} />
 */
export function withLazyBoundary<T extends ComponentType<any>>(
  importFn: () => Promise<{ default: T }>,
  loadingMessage?: string
) {
  const LazyComponent = lazy(importFn);

  const WrappedComponent = (props: ComponentProps<T>) => (
    <ErrorBoundary>
      <Suspense fallback={<LoadingSpinner message={loadingMessage} />}>
        <LazyComponent {...props} />
      </Suspense>
    </ErrorBoundary>
  );

  // Set display name for debugging
  WrappedComponent.displayName = `withLazyBoundary(${(LazyComponent as any).displayName || 'Component'})`;

  return WrappedComponent;
}
