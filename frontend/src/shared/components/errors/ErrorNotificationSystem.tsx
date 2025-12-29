/**
 * frontend/src/shared/components/errors/ErrorNotificationSystem.tsx
 *
 * UI component for ErrorNotificationSystem.
 * Handles rendering and interactions for the shared components.
 */

import React from 'react';
import { useErrorContext, ErrorNotification } from '@contexts/ErrorContext';
import { ErrorSeverity } from '@utils/errorHandler';
import './ErrorNotificationSystem.css';

interface ErrorNotificationItemProps {
  error: ErrorNotification;
  onDismiss: (id: string) => void;
  onRetry?: (id: string, retryFn: () => Promise<void>) => void;
  stackPosition: number;
  stackSize: number;
}

const ErrorNotificationItem: React.FC<ErrorNotificationItemProps> = ({
  error,
  onDismiss,
  onRetry,
  stackPosition,
  stackSize,
}) => {
  const getSeverityClass = (severity: ErrorSeverity) => `error-notification-${severity}`;
  const isTop = stackPosition === 0;
  const autoDismissClass = error.autoDismiss
    ? error.autoDismissTimeout && error.autoDismissTimeout >= 10000
      ? 'error-notification--auto-dismiss-long'
      : 'error-notification--auto-dismiss-short'
    : '';
  const stackStyle = {
    '--notification-stack-index': `${stackPosition}`,
    '--notification-stack-count': `${stackSize}`,
  } as React.CSSProperties;

  return (
    <div
      className={`error-notification ${getSeverityClass(error.severity)} ${
        isTop ? 'error-notification--active' : 'error-notification--stacked'
      } ${autoDismissClass}`}
      data-stack-size={stackSize}
      style={stackStyle}
    >
      <div className="error-notification-header">
        {isTop && stackSize > 1 && <span className="error-notification-count">{stackSize}</span>}
        <span className="error-notification-category">{error.category}</span>
        {error.autoDismiss && (
          <span className="error-notification-auto-dismiss" title="Will auto-dismiss">
            ⏱️
          </span>
        )}
        <button
          className="error-notification-dismiss"
          onClick={() => onDismiss(error.id)}
          title="Dismiss"
        >
          ✕
        </button>
      </div>

      <div className="error-notification-body">
        <p className="error-notification-message">{error.userMessage}</p>

        {error.suggestions && error.suggestions.length > 0 && (
          <div className="error-notification-suggestions">
            <p className="suggestions-label">Suggestions:</p>
            <ul>
              {error.suggestions.map((suggestion, index) => (
                <li key={index}>{suggestion}</li>
              ))}
            </ul>
          </div>
        )}

        {error.context && Object.keys(error.context).length > 0 && (
          <details className="error-notification-details">
            <summary>Technical Details</summary>
            <div className="technical-details">
              <p className="technical-message">{error.technicalMessage}</p>
              <pre className="error-context">{JSON.stringify(error.context, null, 2)}</pre>
            </div>
          </details>
        )}
      </div>

      {error.retryable && (
        <div className="error-notification-actions">
          <button
            className="error-notification-retry"
            onClick={() => {
              if (onRetry && error.context?.retryFn) {
                onRetry(error.id, error.context.retryFn as () => Promise<void>);
              }
            }}
          >
            Retry
          </button>
        </div>
      )}
      {error.autoDismiss && (
        <div className="error-notification-progress" aria-hidden="true">
          <span className="error-notification-progress-bar" />
        </div>
      )}
    </div>
  );
};

export const ErrorNotificationSystem: React.FC = () => {
  const { errors, dismissError, dismissAllErrors, retryError } = useErrorContext();

  if (errors.length === 0) {
    return null;
  }

  return (
    <div className="error-notification-container">
      <div className="error-notification-list">
        {errors.map((error, index) => (
          <ErrorNotificationItem
            key={error.id}
            error={error}
            onDismiss={dismissError}
            onRetry={retryError}
            stackPosition={errors.length - 1 - index}
            stackSize={errors.length}
          />
        ))}
      </div>

      <div className="error-notification-header-actions">
        <button className="dismiss-all-btn" onClick={dismissAllErrors}>
          {errors.length > 1 ? `Dismiss All (${errors.length})` : 'Dismiss'}
        </button>
      </div>
    </div>
  );
};
