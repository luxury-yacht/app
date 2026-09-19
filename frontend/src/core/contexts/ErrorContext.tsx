/**
 * frontend/src/core/contexts/ErrorContext.tsx
 *
 * Error notification context and actions.
 * Provides a way to manage and display error notifications across the application.
 */

import {
  type ErrorDetails,
  ErrorSeverity,
  errorHandler,
  subscribeToErrors,
} from '@utils/errorHandler';
import type React from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from 'react';

export interface ErrorNotification extends ErrorDetails {
  id: string;
}

interface ErrorContextValue {
  errors: ErrorNotification[];
  addError: (error: ErrorDetails) => void;
  dismissError: (id: string) => void;
  dismissAllErrors: () => void;
  clearErrors: () => void;
  retryError: (id: string, retryFn: () => Promise<void>) => void;
}

const ErrorContext = createContext<ErrorContextValue | undefined>(undefined);

interface ErrorProviderProps {
  children: React.ReactNode;
  maxErrors?: number;
  autoDismissInfo?: boolean;
  autoDismissInfoTimeout?: number;
  autoDismissWarning?: boolean;
  autoDismissWarningTimeout?: number;
}

interface AutoDismissPolicy {
  autoDismiss: boolean;
  autoDismissTimeout: number;
}

const resolveAutoDismiss = (
  error: ErrorDetails,
  defaults: Record<'info' | 'warning', AutoDismissPolicy>
): AutoDismissPolicy => {
  const fallback = error.severity === ErrorSeverity.INFO ? defaults.info : defaults.warning;
  if (error.autoDismiss !== undefined) {
    return {
      autoDismiss: error.autoDismiss,
      autoDismissTimeout: error.autoDismissTimeout ?? fallback.autoDismissTimeout,
    };
  }
  const autoDismiss =
    (error.severity === ErrorSeverity.INFO || error.severity === ErrorSeverity.WARNING) &&
    fallback.autoDismiss;
  return { autoDismiss, autoDismissTimeout: autoDismiss ? fallback.autoDismissTimeout : 0 };
};

export const ErrorProvider: React.FC<ErrorProviderProps> = ({
  children,
  maxErrors = 5,
  autoDismissInfo = true,
  autoDismissInfoTimeout = 5000,
  autoDismissWarning = false,
  autoDismissWarningTimeout = 10000,
}) => {
  const [errors, setErrors] = useState<ErrorNotification[]>([]);
  const errorIdCounter = useRef(0);
  const dismissTimers = useRef<Map<string, NodeJS.Timeout>>(new Map());

  const dismissError = useCallback((id: string) => {
    setErrors((prev) => prev.filter((error) => error.id !== id));

    // Clear any associated timer
    const timer = dismissTimers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      dismissTimers.current.delete(id);
    }
  }, []);

  const addError = useCallback(
    (error: ErrorDetails) => {
      const id = `error-${++errorIdCounter.current}`;

      // Determine auto-dismiss settings. An explicit per-notification request
      // (error.autoDismiss) wins over the severity-based defaults, so a single
      // advisory can auto-dismiss without flipping the global severity flags.
      const { autoDismiss, autoDismissTimeout } = resolveAutoDismiss(error, {
        info: { autoDismiss: autoDismissInfo, autoDismissTimeout: autoDismissInfoTimeout },
        warning: { autoDismiss: autoDismissWarning, autoDismissTimeout: autoDismissWarningTimeout },
      });

      const notification: ErrorNotification = {
        ...error,
        id,
        autoDismiss,
        autoDismissTimeout,
      };

      setErrors((prev) => [notification, ...prev].slice(0, maxErrors));

      // Set up auto-dismiss timer if needed
      if (autoDismiss && autoDismissTimeout > 0) {
        const timer = setTimeout(() => {
          dismissError(id);
        }, autoDismissTimeout);
        dismissTimers.current.set(id, timer);
      }
    },
    [
      maxErrors,
      autoDismissInfo,
      autoDismissInfoTimeout,
      autoDismissWarning,
      autoDismissWarningTimeout,
      dismissError,
    ]
  );

  // Replay any errors captured before the provider mounted (once only)
  const replayInitialErrors = useEffectEvent(() => {
    const history = errorHandler.getHistory();
    history.forEach((error) => {
      addError(error);
    });
  });
  useEffect(() => replayInitialErrors(), []);

  // Subscribe to future errors from the global handler
  useEffect(() => {
    const unsubscribe = subscribeToErrors((error: ErrorDetails) => {
      addError(error);
    });

    const timers = dismissTimers.current;

    return () => {
      unsubscribe();
      // Clear auto-dismiss timers when subscription resets
      timers.forEach((timer) => {
        clearTimeout(timer);
      });
    };
  }, [addError]);

  const clearErrors = useCallback(() => {
    // Clear all timers
    dismissTimers.current.forEach((timer) => {
      clearTimeout(timer);
    });
    dismissTimers.current.clear();
    setErrors([]);
  }, []);

  const retryError = useCallback(
    async (id: string, retryFn: () => Promise<void>) => {
      // Remove the error
      dismissError(id);

      try {
        await retryFn();
      } catch (error) {
        // Error will be handled by the global error handler
        errorHandler.handle(error);
      }
    },
    [dismissError]
  );

  const value: ErrorContextValue = {
    errors,
    addError,
    dismissError,
    dismissAllErrors: clearErrors,
    clearErrors,
    retryError,
  };

  return <ErrorContext.Provider value={value}>{children}</ErrorContext.Provider>;
};

export const useErrorContext = (): ErrorContextValue => {
  const context = useContext(ErrorContext);
  if (!context) {
    throw new Error('useErrorContext must be used within an ErrorProvider');
  }
  return context;
};
