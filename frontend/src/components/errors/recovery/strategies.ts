import { RecoveryStrategy } from '../types';

export function getRecoveryStrategy(error: Error, scope?: string): RecoveryStrategy {
  const errorMessage = error.message.toLowerCase();

  // Network errors - retry
  if (
    errorMessage.includes('fetch') ||
    errorMessage.includes('network') ||
    errorMessage.includes('econnrefused') ||
    errorMessage.includes('timeout')
  ) {
    return RecoveryStrategy.RETRY;
  }

  // Chunk loading errors - reload
  if (
    errorMessage.includes('loading chunk') ||
    errorMessage.includes('failed to fetch dynamically imported module') ||
    errorMessage.includes('dynamically imported module')
  ) {
    return RecoveryStrategy.RELOAD;
  }

  // Authentication errors - fatal
  if (
    errorMessage.includes('401') ||
    errorMessage.includes('unauthorized') ||
    errorMessage.includes('authentication') ||
    errorMessage.includes('token expired')
  ) {
    return RecoveryStrategy.FATAL;
  }

  // Permission errors - fatal
  if (
    errorMessage.includes('403') ||
    errorMessage.includes('forbidden') ||
    errorMessage.includes('permission denied')
  ) {
    return RecoveryStrategy.FATAL;
  }

  // Component errors in non-critical areas - degrade
  if (
    scope?.includes('panel') ||
    scope?.includes('secondary') ||
    scope?.includes('sidebar') ||
    scope?.includes('modal')
  ) {
    return RecoveryStrategy.DEGRADE;
  }

  // Table-specific errors - refresh
  if (scope?.includes('table')) {
    return RecoveryStrategy.REFRESH;
  }

  // Default - reset
  return RecoveryStrategy.RESET;
}

export function getRecoveryMessage(strategy: RecoveryStrategy): string {
  switch (strategy) {
    case RecoveryStrategy.RETRY:
      return 'This might be a temporary issue. Please try again.';
    case RecoveryStrategy.REFRESH:
      return 'Try refreshing the data to resolve this issue.';
    case RecoveryStrategy.RELOAD:
      return 'A reload is required to recover from this error.';
    case RecoveryStrategy.RESET:
      return 'Resetting the component may resolve this issue.';
    case RecoveryStrategy.DEGRADE:
      return 'Some features may be limited due to this error.';
    case RecoveryStrategy.FATAL:
      return 'This is a critical error that requires intervention.';
    default:
      return 'An unexpected error occurred.';
  }
}

export function canAutoRecover(strategy: RecoveryStrategy): boolean {
  return [RecoveryStrategy.RETRY, RecoveryStrategy.REFRESH, RecoveryStrategy.RESET].includes(
    strategy
  );
}

export function shouldLogToServer(error: Error, strategy: RecoveryStrategy): boolean {
  // Always log fatal errors
  if (strategy === RecoveryStrategy.FATAL) {
    return true;
  }

  // Log chunk loading errors for monitoring
  if (strategy === RecoveryStrategy.RELOAD) {
    return true;
  }

  // Log repeated errors (would need to track this)
  // For now, log errors that seem serious
  const seriousErrors = ['undefined is not', 'cannot read', 'maximum call stack'];
  return seriousErrors.some((pattern) => error.message.toLowerCase().includes(pattern));
}
