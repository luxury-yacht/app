import { Component, ErrorInfo } from 'react';
import { errorHandler } from '@utils/errorHandler';
import { ErrorFallback } from './ErrorFallback';
import { ErrorBoundaryProps, ErrorBoundaryState } from './types';

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error, errorInfo: null };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const { scope, onError, isolate } = this.props;

    // Log to console in development
    if (import.meta.env.DEV) {
      console.group(`🔴 Error Boundary Caught [${scope || 'unknown'}]`);
      console.error('Error:', error);
      console.error('Component Stack:', errorInfo.componentStack);
      console.groupEnd();
    }

    // Send to global error handler
    if (!isolate) {
      errorHandler.handle(
        error,
        {
          source: 'ErrorBoundary',
          scope,
          componentStack: errorInfo.componentStack,
        },
        `Component error in ${scope || 'unknown scope'}`
      );
    }

    // Call custom error handler
    onError?.(error, errorInfo);

    // Update state with errorInfo
    this.setState({ errorInfo });
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    const { resetKeys, resetOnPropsChange, children } = this.props;
    const { hasError } = this.state;

    if (hasError && prevProps.resetKeys !== resetKeys) {
      if (resetKeys?.some((key, idx) => key !== prevProps.resetKeys?.[idx])) {
        this.resetError();
      }
    }

    if (hasError && resetOnPropsChange && prevProps.children !== children) {
      this.resetError();
    }
  }

  resetError = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    const { hasError, error, errorInfo } = this.state;
    const { children, fallback, scope } = this.props;

    if (hasError && error) {
      if (fallback) {
        return fallback(error, this.resetError);
      }

      return (
        <ErrorFallback
          error={error}
          errorInfo={errorInfo}
          resetError={this.resetError}
          scope={scope}
        />
      );
    }

    return children;
  }
}
