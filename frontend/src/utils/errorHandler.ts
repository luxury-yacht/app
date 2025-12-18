/**
 * Centralized error handling utility for the Luxury Yacht application
 * Provides error categorization, custom messages, and logging
 */

export enum ErrorCategory {
  NETWORK = 'NETWORK',
  AUTHENTICATION = 'AUTHENTICATION',
  PERMISSION = 'PERMISSION',
  NOT_FOUND = 'NOT_FOUND',
  VALIDATION = 'VALIDATION',
  TIMEOUT = 'TIMEOUT',
  RATE_LIMIT = 'RATE_LIMIT',
  SERVER_ERROR = 'SERVER_ERROR',
  UNKNOWN = 'UNKNOWN',
}

export enum ErrorSeverity {
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
  CRITICAL = 'critical',
}

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
}

export interface ErrorHandlerOptions {
  enableLogging?: boolean;
  logToConsole?: boolean;
  logToServer?: boolean;
  defaultSeverity?: ErrorSeverity;
  customHandlers?: Map<ErrorCategory, (error: ErrorDetails) => void>;
}

class ErrorHandler {
  private options: ErrorHandlerOptions;
  private errorListeners: Set<(error: ErrorDetails) => void> = new Set();
  private errorHistory: ErrorDetails[] = [];
  private readonly maxHistorySize = 100;

  constructor(options: ErrorHandlerOptions = {}) {
    this.options = {
      enableLogging: true,
      logToConsole: true,
      logToServer: false,
      defaultSeverity: ErrorSeverity.ERROR,
      ...options,
    };
  }

  /**
   * Categorizes an error based on its content and type
   */
  private categorizeError(error: unknown): ErrorCategory {
    const errorString = this.getErrorString(error);
    const lowerError = errorString.toLowerCase();

    // Network errors
    if (
      lowerError.includes('network') ||
      lowerError.includes('fetch') ||
      lowerError.includes('cors') ||
      lowerError.includes('connection') ||
      lowerError.includes('offline') ||
      lowerError.includes('econnrefused')
    ) {
      return ErrorCategory.NETWORK;
    }

    // Authentication errors
    if (
      lowerError.includes('unauthorized') ||
      lowerError.includes('authentication') ||
      lowerError.includes('auth') ||
      lowerError.includes('token') ||
      lowerError.includes('expired') ||
      lowerError.includes('401')
    ) {
      return ErrorCategory.AUTHENTICATION;
    }

    // Permission errors
    if (
      lowerError.includes('forbidden') ||
      lowerError.includes('permission') ||
      lowerError.includes('access denied') ||
      lowerError.includes('403')
    ) {
      return ErrorCategory.PERMISSION;
    }

    // Not found errors
    if (
      lowerError.includes('not found') ||
      lowerError.includes('404') ||
      lowerError.includes('missing')
    ) {
      return ErrorCategory.NOT_FOUND;
    }

    // Validation errors
    if (
      lowerError.includes('invalid') ||
      lowerError.includes('validation') ||
      lowerError.includes('bad request') ||
      lowerError.includes('400')
    ) {
      return ErrorCategory.VALIDATION;
    }

    // Server errors (check before timeout to catch "Gateway Timeout")
    if (
      lowerError.includes('500') ||
      lowerError.includes('502') ||
      lowerError.includes('503') ||
      (lowerError.includes('504') && lowerError.includes('gateway')) ||
      lowerError.includes('server error') ||
      lowerError.includes('internal server')
    ) {
      return ErrorCategory.SERVER_ERROR;
    }

    // Timeout errors
    if (lowerError.includes('timeout') || lowerError.includes('timed out')) {
      return ErrorCategory.TIMEOUT;
    }

    // Rate limit errors
    if (
      lowerError.includes('rate limit') ||
      lowerError.includes('too many requests') ||
      lowerError.includes('429')
    ) {
      return ErrorCategory.RATE_LIMIT;
    }

    return ErrorCategory.UNKNOWN;
  }

  /**
   * Determines if an error is retryable based on its category
   */
  private isRetryable(category: ErrorCategory): boolean {
    return [
      ErrorCategory.NETWORK,
      ErrorCategory.TIMEOUT,
      ErrorCategory.RATE_LIMIT,
      ErrorCategory.SERVER_ERROR,
    ].includes(category);
  }

  /**
   * Generates user-friendly message based on error category
   */
  private getUserMessage(category: ErrorCategory, originalMessage: string): string {
    switch (category) {
      case ErrorCategory.NETWORK:
        return 'Unable to connect to the Kubernetes cluster. Please check your network connection.';
      case ErrorCategory.AUTHENTICATION:
        return 'Authentication failed. Please check your kubeconfig credentials.';
      case ErrorCategory.PERMISSION:
        return 'You do not have permission to perform this operation.';
      case ErrorCategory.NOT_FOUND:
        return 'The requested resource was not found.';
      case ErrorCategory.VALIDATION:
        return 'Invalid request. Please check your input and try again.';
      case ErrorCategory.TIMEOUT:
        return 'The operation timed out. Please try again.';
      case ErrorCategory.RATE_LIMIT:
        return 'Too many requests. Please wait a moment before trying again.';
      case ErrorCategory.SERVER_ERROR:
        return 'The server encountered an error. Please try again later.';
      default:
        return originalMessage || 'An unexpected error occurred.';
    }
  }

  /**
   * Generates suggestions for error recovery
   */
  private getSuggestions(category: ErrorCategory): string[] {
    switch (category) {
      case ErrorCategory.NETWORK:
        return [
          'Check your internet connection',
          'Verify the Kubernetes API server is accessible',
          'Check if you are behind a proxy or firewall',
        ];
      case ErrorCategory.AUTHENTICATION:
        return [
          'Verify your kubeconfig file is valid',
          'Check if your credentials have expired',
          'Try selecting a different context',
        ];
      case ErrorCategory.PERMISSION:
        return [
          'Contact your cluster administrator for access',
          'Check your RBAC permissions',
          'Try using a different service account',
        ];
      case ErrorCategory.TIMEOUT:
        return ['Retry the operation', 'Check if the cluster is under heavy load'];
      case ErrorCategory.RATE_LIMIT:
        return ['Wait a few seconds before retrying', 'Reduce the frequency of requests'];
      default:
        return [];
    }
  }

  /**
   * Extracts error string from various error types
   */
  private getErrorString(error: unknown): string {
    if (typeof error === 'string') return error;
    if (error instanceof Error) return error.message;
    if (error && typeof error === 'object' && 'message' in error) {
      return String(error.message);
    }
    return String(error);
  }

  /**
   * Determines severity based on error category
   */
  private getSeverity(category: ErrorCategory): ErrorSeverity {
    switch (category) {
      case ErrorCategory.NOT_FOUND:
        return ErrorSeverity.INFO;
      case ErrorCategory.VALIDATION:
        return ErrorSeverity.WARNING;
      case ErrorCategory.AUTHENTICATION:
      case ErrorCategory.PERMISSION:
        return ErrorSeverity.ERROR;
      case ErrorCategory.SERVER_ERROR:
        return ErrorSeverity.CRITICAL;
      default:
        return this.options.defaultSeverity || ErrorSeverity.ERROR;
    }
  }

  /**
   * Main error handling method
   */
  public handle(
    error: unknown,
    context?: Record<string, unknown>,
    customMessage?: string
  ): ErrorDetails {
    const errorString = this.getErrorString(error);
    const category = this.categorizeError(error);
    const severity = this.getSeverity(category);

    // Check if the error contains STDERR information
    let userMsg = customMessage || this.getUserMessage(category, errorString);
    let technicalMsg = errorString;

    // Parse STDERR from the error message if present
    if (errorString.includes('STDERR:')) {
      const parts = errorString.split('STDERR:');
      userMsg = customMessage || this.getUserMessage(category, parts[0].trim());
      technicalMsg = parts[1]?.trim() || errorString;

      // Add the original error to context for debugging
      context = {
        ...context,
        originalError: parts[0].trim(),
        stderr: parts[1]?.trim(),
      };
    }

    const errorDetails: ErrorDetails = {
      message: errorString,
      category,
      severity,
      originalError: error,
      context,
      timestamp: new Date(),
      retryable: this.isRetryable(category),
      userMessage: userMsg,
      technicalMessage: technicalMsg,
      suggestions: this.getSuggestions(category),
    };

    // Log the error
    this.logError(errorDetails);

    const suppressNotification = category === ErrorCategory.PERMISSION;

    if (!suppressNotification) {
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
   * Logs error based on configuration
   */
  private logError(error: ErrorDetails): void {
    if (!this.options.enableLogging) return;

    if (this.options.logToConsole) {
      console.groupCollapsed(
        `%c[${error.severity.toUpperCase()}] ${error.category}`,
        this.getConsoleStyle(error.severity)
      );
      console.error('Message:', error.userMessage);
      console.error('Technical:', error.technicalMessage);
      if (error.context) console.error('Context:', error.context);
      if (error.suggestions?.length) console.error('Suggestions:', error.suggestions);
      console.error('Timestamp:', error.timestamp);
      if (error.originalError) console.error('Original Error:', error.originalError);
      console.groupEnd();
    }

    if (this.options.logToServer) {
      // Implement server logging here if needed
      // This could send errors to a logging service
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
    this.errorListeners.forEach((listener) => listener(error));
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

  /**
   * Create a scoped error handler for specific contexts
   */
  public createScoped(contextName: string): ScopedErrorHandler {
    return new ScopedErrorHandler(this, contextName);
  }
}

/**
 * Scoped error handler for specific contexts
 */
class ScopedErrorHandler {
  constructor(
    private parent: ErrorHandler,
    private contextName: string
  ) {}

  handle(error: unknown, additionalContext?: Record<string, unknown>, customMessage?: string) {
    return this.parent.handle(
      error,
      {
        scope: this.contextName,
        ...additionalContext,
      },
      customMessage
    );
  }
}

// Create and export singleton instance
export const errorHandler = new ErrorHandler();

// Export convenience functions
export const subscribeToErrors = errorHandler.subscribe.bind(errorHandler);
