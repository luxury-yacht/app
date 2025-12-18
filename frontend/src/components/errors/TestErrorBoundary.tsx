import React, { useState, useEffect } from 'react';
import { errorHandler } from '@utils/errorHandler';

// Component that throws an error during render
const ThrowOnRender: React.FC<{ error: Error }> = ({ error }) => {
  throw error;
};

// Component that throws an error in useEffect
const ThrowInEffect: React.FC<{ error: Error; onError: () => void }> = ({ error, onError }) => {
  useEffect(() => {
    onError();
    throw error;
  }, [error, onError]);
  return <div>Loading...</div>;
};

// Component that simulates async error
const AsyncErrorComponent: React.FC = () => {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setLoading(false);
      // This will trigger a render with an error
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  if (!loading) {
    throw new Error('Async component failed to load!');
  }

  return <div>Loading async component...</div>;
};

/**
 * Test component to verify error boundaries are working
 * This component should only be shown in development
 */
const TestErrorBoundary: React.FC = () => {
  const [errorType, setErrorType] = useState<string | null>(null);
  const [showAsyncError, setShowAsyncError] = useState(false);

  const handleReset = () => {
    setErrorType(null);
    setShowAsyncError(false);
  };

  // Render different error scenarios based on state
  if (errorType === 'sync') {
    return (
      <ThrowOnRender error={new Error('Sync render error - should be caught by error boundary!')} />
    );
  }

  if (errorType === 'network') {
    const error = new Error('Network request failed: ECONNREFUSED');
    error.name = 'NetworkError';
    return <ThrowOnRender error={error} />;
  }

  if (errorType === 'chunk') {
    const error = new Error('Loading chunk 5 failed');
    error.name = 'ChunkLoadError';
    return <ThrowOnRender error={error} />;
  }

  if (errorType === 'effect') {
    return (
      <ThrowInEffect
        error={new Error('Error in useEffect - should be caught!')}
        onError={() => {
          // keep hook symmetry without logging
        }}
      />
    );
  }

  if (showAsyncError) {
    return <AsyncErrorComponent />;
  }

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '20px',
        left: '20px',
        zIndex: 10000,
        background: 'rgba(255, 0, 0, 0.1)',
        border: '2px dashed red',
        padding: '10px',
        borderRadius: '4px',
        maxWidth: '250px',
      }}
    >
      <h4 style={{ margin: '0 0 10px 0', color: 'red', fontSize: '12px' }}>
        🧪 Error Boundary Tests (Dev)
      </h4>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
        <div style={{ fontSize: '11px', fontWeight: 'bold', marginTop: '5px' }}>
          Caught by Error Boundary:
        </div>

        <button
          onClick={() => setErrorType('sync')}
          style={{
            padding: '4px 8px',
            background: '#ff4444',
            color: 'white',
            border: 'none',
            borderRadius: '3px',
            cursor: 'pointer',
            fontSize: '11px',
          }}
          title="Throws during render - will be caught by error boundary"
        >
          🔴 Sync Render Error
        </button>

        <button
          onClick={() => setErrorType('network')}
          style={{
            padding: '4px 8px',
            background: '#ff6644',
            color: 'white',
            border: 'none',
            borderRadius: '3px',
            cursor: 'pointer',
            fontSize: '11px',
          }}
          title="Simulates network error - should trigger retry strategy"
        >
          🌐 Network Error
        </button>

        <button
          onClick={() => setErrorType('chunk')}
          style={{
            padding: '4px 8px',
            background: '#ff8844',
            color: 'white',
            border: 'none',
            borderRadius: '3px',
            cursor: 'pointer',
            fontSize: '11px',
          }}
          title="Simulates chunk loading error - should suggest reload"
        >
          📦 Chunk Load Error
        </button>

        <button
          onClick={() => setErrorType('effect')}
          style={{
            padding: '4px 8px',
            background: '#ffaa44',
            color: 'white',
            border: 'none',
            borderRadius: '3px',
            cursor: 'pointer',
            fontSize: '11px',
          }}
          title="Throws in useEffect - will be caught"
        >
          ⚡ UseEffect Error
        </button>

        <button
          onClick={() => setShowAsyncError(true)}
          style={{
            padding: '4px 8px',
            background: '#ffcc44',
            color: 'white',
            border: 'none',
            borderRadius: '3px',
            cursor: 'pointer',
            fontSize: '11px',
          }}
          title="Simulates async component error"
        >
          ⏱️ Async Component Error
        </button>

        <div style={{ fontSize: '11px', fontWeight: 'bold', marginTop: '10px' }}>
          Not Caught (Notifications):
        </div>

        <button
          onClick={() => {
            // This won't be caught by error boundary, only by global handler
            setTimeout(() => {
              const error = new Error('Async timeout error - check notifications!');
              errorHandler.handle(error, { source: 'TestErrorBoundary' });
            }, 100);
          }}
          style={{
            padding: '4px 8px',
            background: '#4444ff',
            color: 'white',
            border: 'none',
            borderRadius: '3px',
            cursor: 'pointer',
            fontSize: '11px',
          }}
          title="Won't be caught by boundary, will show in notifications"
        >
          📢 Async Handler Error
        </button>

        <button
          onClick={() => {
            // Event handler errors are not caught by error boundaries
            throw new Error('Event handler error - not caught by boundary!');
          }}
          style={{
            padding: '4px 8px',
            background: '#6644ff',
            color: 'white',
            border: 'none',
            borderRadius: '3px',
            cursor: 'pointer',
            fontSize: '11px',
          }}
          title="Throws in event handler - will NOT be caught"
        >
          🖱️ Event Handler Error
        </button>

        <button
          onClick={async () => {
            // Promise rejection
            await Promise.reject(new Error('Unhandled promise rejection!'));
          }}
          style={{
            padding: '4px 8px',
            background: '#8844ff',
            color: 'white',
            border: 'none',
            borderRadius: '3px',
            cursor: 'pointer',
            fontSize: '11px',
          }}
          title="Promise rejection - not caught by boundary"
        >
          ⚠️ Promise Rejection
        </button>

        {errorType && (
          <button
            onClick={handleReset}
            style={{
              marginTop: '10px',
              padding: '4px 8px',
              background: '#44ff44',
              color: 'black',
              border: 'none',
              borderRadius: '3px',
              cursor: 'pointer',
              fontSize: '11px',
              fontWeight: 'bold',
            }}
          >
            ✓ Reset Test State
          </button>
        )}
      </div>

      <div
        style={{
          marginTop: '10px',
          fontSize: '10px',
          color: '#666',
          borderTop: '1px solid #ccc',
          paddingTop: '5px',
        }}
      >
        <div>🔴 = Caught by boundary</div>
        <div>🔵 = Only in notifications</div>
      </div>
    </div>
  );
};

export default TestErrorBoundary;
