import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { ErrorDetails, ErrorSeverity, errorHandler, subscribeToErrors } from '@utils/errorHandler';

export interface ErrorNotification extends ErrorDetails {
  id: string;
  dismissed: boolean;
  autoDismiss?: boolean;
  autoDismissTimeout?: number;
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
    setErrors((prev) =>
      prev.map((error) => (error.id === id ? { ...error, dismissed: true } : error))
    );

    // Clear any associated timer
    const timer = dismissTimers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      dismissTimers.current.delete(id);
    }

    // Remove dismissed error after animation
    setTimeout(() => {
      setErrors((prev) => prev.filter((error) => error.id !== id));
    }, 300);
  }, []);

  const addError = useCallback(
    (error: ErrorDetails) => {
      const id = `error-${++errorIdCounter.current}`;

      // Determine auto-dismiss settings
      let autoDismiss = false;
      let autoDismissTimeout = 0;

      if (error.severity === ErrorSeverity.INFO && autoDismissInfo) {
        autoDismiss = true;
        autoDismissTimeout = autoDismissInfoTimeout;
      } else if (error.severity === ErrorSeverity.WARNING && autoDismissWarning) {
        autoDismiss = true;
        autoDismissTimeout = autoDismissWarningTimeout;
      }

      const notification: ErrorNotification = {
        ...error,
        id,
        dismissed: false,
        autoDismiss,
        autoDismissTimeout,
      };

      setErrors((prev) => {
        // Keep only the most recent errors up to maxErrors
        const newErrors = [notification, ...prev].slice(0, maxErrors);
        return newErrors;
      });

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

  // Subscribe to global error handler
  useEffect(() => {
    // Replay any errors captured before the provider mounted
    const history = errorHandler.getHistory();
    history.forEach((error) => addError(error));

    const unsubscribe = subscribeToErrors((error: ErrorDetails) => {
      addError(error);
    });

    const timers = dismissTimers.current;

    return () => {
      unsubscribe();
      // Clear all timers on unmount
      timers.forEach((timer) => clearTimeout(timer));
    };
  }, [addError]);

  const dismissAllErrors = useCallback(() => {
    setErrors((prev) => prev.map((error) => ({ ...error, dismissed: true })));

    // Clear all timers
    dismissTimers.current.forEach((timer) => clearTimeout(timer));
    dismissTimers.current.clear();

    // Remove all errors after animation
    setTimeout(() => {
      setErrors([]);
    }, 300);
  }, []);

  const clearErrors = useCallback(() => {
    // Clear all timers
    dismissTimers.current.forEach((timer) => clearTimeout(timer));
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
    errors: errors.filter((e) => !e.dismissed),
    addError,
    dismissError,
    dismissAllErrors,
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
