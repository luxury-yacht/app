/**
 * frontend/src/components/errors/specialized/RouteErrorBoundary.tsx
 *
 * UI component for RouteErrorBoundary.
 * Handles rendering and interactions for the shared components.
 */

import React, { ReactNode } from 'react';
import { ErrorBoundary } from '../ErrorBoundary';

interface RouteErrorBoundaryProps {
  children: ReactNode;
  routeName: string;
}

export const RouteErrorBoundary: React.FC<RouteErrorBoundaryProps> = ({ children, routeName }) => (
  <ErrorBoundary
    scope={`route-${routeName}`}
    fallback={(_, reset) => (
      <div className="route-error-fallback">
        <h1>Page Error</h1>
        <p>The {routeName} page encountered an error and cannot be displayed.</p>
        <div className="route-error-actions">
          <button onClick={reset} className="btn-reset">
            Try Again
          </button>
          <button onClick={() => window.history.back()} className="btn-reload">
            Go Back
          </button>
          <a href="/">Go to Home</a>
        </div>
      </div>
    )}
    resetKeys={[routeName]}
  >
    {children}
  </ErrorBoundary>
);
