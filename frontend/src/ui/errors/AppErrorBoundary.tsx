/**
 * frontend/src/components/errors/specialized/AppErrorBoundary.tsx
 *
 * UI component for AppErrorBoundary.
 * Handles rendering and interactions for the shared components.
 */

import React, { ReactNode } from 'react';
import { ErrorBoundary } from '@shared/components/errors/ErrorBoundary';

interface AppErrorBoundaryProps {
  children: ReactNode;
}

export const AppErrorBoundary: React.FC<AppErrorBoundaryProps> = ({ children }) => (
  <ErrorBoundary
    scope="application"
    fallback={(error, reset) => {
      // For app-level errors, provide a full-page fallback
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100vh',
            background: 'linear-gradient(135deg, #0d0d0d 0%, #1a1a1a 100%)',
            color: '#f5f5f5',
            padding: '2rem',
          }}
        >
          <div style={{ textAlign: 'center', maxWidth: '600px' }}>
            <h1 style={{ fontSize: '4rem', marginBottom: '1rem' }}>💥</h1>
            <h2 style={{ marginBottom: '1rem' }}>Application Error</h2>
            <p style={{ color: '#a0a0a0', marginBottom: '2rem' }}>
              The application encountered a critical error and cannot continue. This error has been
              logged and will be investigated.
            </p>

            {import.meta.env.DEV && (
              <details
                style={{
                  background: '#000',
                  padding: '1rem',
                  borderRadius: '4px',
                  marginBottom: '2rem',
                  textAlign: 'left',
                }}
              >
                <summary style={{ cursor: 'pointer', color: '#ff6b6b' }}>
                  Error Details (Development Only)
                </summary>
                <pre
                  style={{
                    overflow: 'auto',
                    marginTop: '1rem',
                    fontSize: '0.85rem',
                    color: '#ff6b6b',
                  }}
                >
                  {error.stack || error.toString()}
                </pre>
              </details>
            )}

            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
              <button
                onClick={reset}
                style={{
                  padding: '0.75rem 2rem',
                  background: '#2a3f5f',
                  border: 'none',
                  borderRadius: '4px',
                  color: '#f5f5f5',
                  cursor: 'pointer',
                  fontSize: '1rem',
                }}
              >
                Try Recovery
              </button>
              <button
                onClick={() => window.location.reload()}
                style={{
                  padding: '0.75rem 2rem',
                  background: '#5f2a2a',
                  border: 'none',
                  borderRadius: '4px',
                  color: '#f5f5f5',
                  cursor: 'pointer',
                  fontSize: '1rem',
                }}
              >
                Reload Application
              </button>
            </div>
          </div>
        </div>
      );
    }}
  >
    {children}
  </ErrorBoundary>
);
