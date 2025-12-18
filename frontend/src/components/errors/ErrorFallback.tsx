import React from 'react';
import { ErrorFallbackProps } from './types';
import './ErrorFallback.css';

export const ErrorFallback: React.FC<ErrorFallbackProps> = ({
  error,
  errorInfo,
  resetError,
  scope,
}) => {
  const isDev = import.meta.env.DEV;

  return (
    <div className="error-boundary-fallback">
      <div className="error-boundary-content">
        <div className="error-icon">⚠️</div>

        <h2>Something went wrong</h2>

        <p className="error-message">
          {scope ? `Error in ${scope}` : 'An unexpected error occurred'}
        </p>

        {isDev && (
          <details className="error-details">
            <summary>Error Details (Development Only)</summary>
            <pre className="error-stack">
              <code>{error.toString()}</code>
              {errorInfo && (
                <>
                  <br />
                  <br />
                  Component Stack:
                  {errorInfo.componentStack}
                </>
              )}
            </pre>
          </details>
        )}

        <div className="error-actions">
          <button onClick={resetError} className="btn-reset">
            Try Again
          </button>
          <button onClick={() => window.location.reload()} className="btn-reload">
            Reload Page
          </button>
        </div>
      </div>
    </div>
  );
};
