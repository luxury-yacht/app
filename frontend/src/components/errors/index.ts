/**
 * frontend/src/components/errors/index.ts
 *
 * Barrel exports for errors.
 * Re-exports public APIs for the shared components.
 */

// Specialized boundaries
export { AppErrorBoundary } from './specialized/AppErrorBoundary';
export { RouteErrorBoundary } from './specialized/RouteErrorBoundary';
export { PanelErrorBoundary } from './specialized/PanelErrorBoundary';
// Types
export type { ErrorBoundaryProps, ErrorBoundaryState, ErrorFallbackProps } from './types';
