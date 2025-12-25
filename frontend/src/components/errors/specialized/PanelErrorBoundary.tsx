/**
 * frontend/src/components/errors/specialized/PanelErrorBoundary.tsx
 *
 * UI component for PanelErrorBoundary.
 * Handles rendering and interactions for the shared components.
 */

import React, { ReactNode } from 'react';
import { ErrorBoundary } from '../ErrorBoundary';

interface PanelErrorBoundaryProps {
  children: ReactNode;
  onClose: () => void;
  panelName?: string;
}

export const PanelErrorBoundary: React.FC<PanelErrorBoundaryProps> = ({
  children,
  onClose,
  panelName = 'panel',
}) => (
  <ErrorBoundary
    scope={`panel-${panelName}`}
    fallback={(_, reset) => (
      <div className="panel-error-fallback">
        <h3>Panel Error</h3>
        <p>Unable to display this content</p>
        <div className="panel-error-actions">
          <button onClick={reset} className="btn-reset">
            Retry
          </button>
          <button onClick={onClose} className="btn-reload">
            Close Panel
          </button>
        </div>
      </div>
    )}
  >
    {children}
  </ErrorBoundary>
);
