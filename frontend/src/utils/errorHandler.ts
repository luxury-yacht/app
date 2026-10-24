/**
 * frontend/src/utils/errorHandler.ts
 *
 * Utility helpers for errorHandler.
 * Provides shared helper functions for the frontend.
 */

import { captureUserVisibleError } from '@/core/telemetry/sentry';
import { ErrorCategory } from '@/shared/constants/errorCategories';
import { errorStatusOf, isBrowserFetchFailure } from './errorStatus';

export { ErrorCategory };

export const ErrorSeverity = {
  INFO: 'info',
  WARNING: 'warning',
  ERROR: 'error',
  CRITICAL: 'critical',
} as const;

export type ErrorSeverity = (typeof ErrorSeverity)[keyof typeof ErrorSeverity];

export interface ErrorDetails {
  message: string;
  category: ErrorCategory;
  severity: ErrorSeverity;
  originalError?: unknown;
  context?: Record<string, unknown>;
  timestamp: Date;
  retryable: boolean;
  userMessage?: string;
  technicalMessage?: string;
  suggestions?: string[];
  /** Header label shown instead of the category (for titled advisories). */
  title?: string;
  /**
   * Explicit auto-dismiss request. When set, it overrides the severity-based
   * default in the notification provider — so a single advisory can
   * auto-dismiss without changing global severity behavior.
   */
  autoDismiss?: boolean;
  autoDismissTimeout?: number;
}

export interface ErrorHandlerOptions {
  enableLogging?: boolean;
  logToConsole?: boolean;
  defaultSeverity?: ErrorSeverity;
  customHandlers?: Map<ErrorCategory, (error: ErrorDetails) => void>;
}

interface ErrorPresentation {
  message: string;
  severity?: ErrorSeverity;
  retryable?: boolean;
  suggestions?: readonly string[];
}

const categoryPresentation: Record<ErrorCategory, ErrorPresentation> = {
  NETWORK: {
    message: 'Unable to connect to the Kubernetes cluster. Please check your network connection.',
    retryable: true,
    suggestions: [
      'Check your internet connection',
      'Verify the Kubernetes API server is accessible',
      'Check if you are behind a proxy or firewall',
    ],
  },
  AUTHENTICATION: {
    message: 'Authentication failed. Please check your kubeconfig credentials.',
    severity: ErrorSeverity.ERROR,
    suggestions: [
      'Verify your kubeconfig file is valid',
      'Check if your credentials have expired',
      'Try selecting a different context',
    ],
  },
  PERMISSION: {
    message: 'You do not have permission to perform this operation.',
    severity: ErrorSeverity.ERROR,
    suggestions: [
      'Contact your cluster administrator for access',
      'Check your RBAC permissions',
      'Try using a different service account',
    ],
  },
  NOT_FOUND: {
    message: 'The requested resource was not found.',
    severity: ErrorSeverity.INFO,
  },
  VALIDATION: {
    message: 'Invalid request. Please check your input and try again.',
    severity: ErrorSeverity.WARNING,
  },
  CONFLICT: {
    message: 'This object changed or already exists. Refresh and try again.',
    severity: ErrorSeverity.WARNING,
  },
  TIMEOUT: {
    message: 'The operation timed out. Please try again.',
    retryable: true,
    suggestions: ['Retry the operation', 'Check if the cluster is under heavy load'],
  },
  RATE_LIMIT: {
    message: 'Too many requests. Please wait a moment before trying again.',
    retryable: true,
    suggestions: ['Wait a few seconds before retrying', 'Reduce the frequency of requests'],
  },
  SERVER_ERROR: {
    message: 'The server encountered an error. Please try again later.',
    severity: ErrorSeverity.CRITICAL,
    retryable: true,
  },
  UNKNOWN: { message: 'An unexpected error occurred.' },
};

class ErrorHandler {
  private options: ErrorHandlerOptions;
  private readonly errorListeners: Set<(error: ErrorDetails) => void> = new Set();
  private errorHistory: ErrorDetails[] = [];
  private readonly maxHistorySize = 100;

  constructor(options: ErrorHandlerOptions = {}) {
    this.options = {
      enableLogging: true,
      logToConsole: true,
      defaultSeverity: ErrorSeverity.ERROR,
      ...options,
    };
  }

  /**
   * The backend status decides the category; an error without one is a
   * network failure only when the browser could not reach the backend.
   */
  private categorizeError(error: unknown): ErrorCategory {
    const status = errorStatusOf(error);
    if (status) {
      return status.category;
    }
    return isBrowserFetchFailure(error) ? ErrorCategory.NETWORK : ErrorCategory.UNKNOWN;
  }

  // These categories are only useful with their own message: which
  // credentials, which argument, or what failed.
  private getUserMessage(category: ErrorCategory, originalMessage: string): string {
    const { message } = categoryPresentation[category];
    if (
      category === ErrorCategory.AUTHENTICATION ||
      category === ErrorCategory.VALIDATION ||
      category === ErrorCategory.UNKNOWN
    ) {
      return originalMessage || message;
    }
    return message;
  }

  /**
   * Extracts error string from various error types
   */
  private getErrorString(error: unknown): string {
    if (typeof error === 'string') {
      return error;
    }
    if (error instanceof Error) {
      return error.message;
    }
    if (error && typeof error === 'object' && 'message' in error) {
      return String(error.message);
    }
    return String(error);
  }

  public describe(
    error: unknown,
    context?: Record<string, unknown>,
    customMessage?: string
  ): ErrorDetails {
    const errorString = this.getErrorString(error);
    const category = this.categorizeError(error);
    const presentation = categoryPresentation[category];
    const severity = presentation.severity || this.options.defaultSeverity || ErrorSeverity.ERROR;

    return {
      message: errorString,
      category,
      severity,
      originalError: error,
      context,
      timestamp: new Date(),
      retryable: presentation.retryable ?? false,
      userMessage: customMessage || this.getUserMessage(category, errorString),
      technicalMessage: errorString,
      suggestions: [...(presentation.suggestions ?? [])],
    };
  }

  private reportError(
    error: unknown,
    details: ErrorDetails,
    surface: 'operational' | 'user-visible' = 'user-visible'
  ): void {
    const reactRootAlreadyCaptured =
      details.context?.source === 'ErrorBoundary' || details.context?.action === 'componentError';
    if (!reactRootAlreadyCaptured) {
      captureUserVisibleError(error, {
        category: details.category,
        severity: details.severity,
        surface,
        context: details.context,
      });
    }
    this.logError(details);
  }

  private logExpectedCondition(details: ErrorDetails): void {
    if (!this.options.enableLogging || !this.options.logToConsole) {
      return;
    }
    console.info(`[EXPECTED] ${details.category}:`, details.technicalMessage, details.context);
  }

  /**
   * Main error handling method
   */
  public handle(
    error: unknown,
    context?: Record<string, unknown>,
    customMessage?: string
  ): ErrorDetails {
    const errorDetails = this.describe(error, context, customMessage);
    const { category } = errorDetails;

    // An expected denial or credential failure is already shown where it
    // belongs (the view's permission state; the auth overlay), so it gets no
    // toast. A denial of an offered action is not expected and is shown.
    const suppressNotification =
      errorStatusOf(error)?.expected === true &&
      (category === ErrorCategory.PERMISSION || category === ErrorCategory.AUTHENTICATION);

    if (suppressNotification) {
      this.logExpectedCondition(errorDetails);
    } else {
      this.reportError(error, errorDetails, 'user-visible');
      // Store in history
      this.addToHistory(errorDetails);

      // Notify listeners
      this.notifyListeners(errorDetails);
    }

    // Execute custom handler if exists
    const customHandler = this.options.customHandlers?.get(category);
    if (customHandler) {
      customHandler(errorDetails);
    }

    return errorDetails;
  }

  /**
   * Reports an operational failure rendered by an inline UI without also
   * publishing it to the global toast listeners.
   */
  public handleInline(
    error: unknown,
    context?: Record<string, unknown>,
    customMessage?: string
  ): ErrorDetails {
    const errorDetails = this.describe(error, context, customMessage);
    this.reportError(error, errorDetails);
    return errorDetails;
  }

  /**
   * Reports a handled operational failure that is not itself rendered as an
   * error surface. This replaces console-only catch paths.
   */
  public handleOperational(
    error: unknown,
    context?: Record<string, unknown>,
    customMessage?: string
  ): ErrorDetails {
    const errorDetails = this.describe(error, context, customMessage);
    this.reportError(error, errorDetails, 'operational');
    return errorDetails;
  }

  /**
   * Logs error based on configuration
   */
  private logError(error: ErrorDetails): void {
    if (!this.options.enableLogging) {
      return;
    }

    if (this.options.logToConsole) {
      console.groupCollapsed(
        `%c[${error.severity.toUpperCase()}] ${error.category}`,
        this.getConsoleStyle(error.severity)
      );
      console.error('Message:', error.userMessage);
      console.error('Technical:', error.technicalMessage);
      if (error.context) {
        console.error('Context:', error.context);
      }
      if (error.suggestions?.length) {
        console.error('Suggestions:', error.suggestions);
      }
      console.error('Timestamp:', error.timestamp);
      if (error.originalError) {
        console.error('Original Error:', error.originalError);
      }
      console.groupEnd();
    }
  }

  private getConsoleStyle(severity: ErrorSeverity): string {
    switch (severity) {
      case ErrorSeverity.INFO:
        return 'color: #2196F3; font-weight: bold;';
      case ErrorSeverity.WARNING:
        return 'color: #FF9800; font-weight: bold;';
      case ErrorSeverity.ERROR:
        return 'color: #F44336; font-weight: bold;';
      case ErrorSeverity.CRITICAL:
        return 'color: #D32F2F; font-weight: bold; font-size: 1.2em;';
      default:
        return 'color: #F44336; font-weight: bold;';
    }
  }

  /**
   * Surface a user-facing WARNING advisory — something the user should know
   * about that is NOT a failure (e.g. an export whose rows span a data change).
   * Distinct from handle(): the severity is WARNING (styled amber, not red),
   * the message is shown verbatim, an optional `title` replaces the category
   * label, and it auto-dismisses by default. Runs the same
   * history/logging/notification path as handle().
   */
  public warn(
    message: string,
    options?: {
      title?: string;
      autoDismiss?: boolean;
      autoDismissTimeout?: number;
      context?: Record<string, unknown>;
    }
  ): ErrorDetails {
    const details: ErrorDetails = {
      message,
      category: ErrorCategory.UNKNOWN,
      severity: ErrorSeverity.WARNING,
      title: options?.title,
      context: options?.context,
      timestamp: new Date(),
      retryable: false,
      userMessage: message,
      technicalMessage: message,
      autoDismiss: options?.autoDismiss ?? true,
      autoDismissTimeout: options?.autoDismissTimeout,
    };

    this.logError(details);
    this.addToHistory(details);
    this.notifyListeners(details);
    return details;
  }

  /**
   * Adds error to history
   */
  private addToHistory(error: ErrorDetails): void {
    this.errorHistory.push(error);
    if (this.errorHistory.length > this.maxHistorySize) {
      this.errorHistory.shift();
    }
  }

  /**
   * Subscribe to error events
   */
  public subscribe(listener: (error: ErrorDetails) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  /**
   * Notify all listeners of an error
   */
  private notifyListeners(error: ErrorDetails): void {
    this.errorListeners.forEach((listener) => {
      listener(error);
    });
  }

  /**
   * Get error history
   */
  public getHistory(): ErrorDetails[] {
    return [...this.errorHistory];
  }

  /**
   * Clear error history
   */
  public clearHistory(): void {
    this.errorHistory = [];
  }

  /**
   * Update options
   */
  public updateOptions(options: Partial<ErrorHandlerOptions>): void {
    this.options = { ...this.options, ...options };
  }
}

// Create and export singleton instance
export const errorHandler = new ErrorHandler();

export const reportOperationalError = (
  error: unknown,
  context?: Record<string, unknown>,
  customMessage?: string
): ErrorDetails => errorHandler.handleOperational(error, context, customMessage);

// Export convenience functions
export const subscribeToErrors = errorHandler.subscribe.bind(errorHandler);
