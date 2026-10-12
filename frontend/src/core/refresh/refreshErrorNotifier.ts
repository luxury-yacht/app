import { errorHandler } from '@utils/errorHandler';
import { errorStatusOf, isBrowserFetchFailure } from '@utils/errorStatus';
import type { DomainCategory } from './domainRegistry';
import { makeInFlightKey } from './refreshRuntime';
import type { ErrorStatusReason, RefreshDomain } from './types';

const STARTUP_REASONS: ReadonlySet<ErrorStatusReason> = new Set([
  'RefreshUnavailable',
  'ClusterNotReady',
]);

type NotifyRefreshErrorOptions = {
  domain: RefreshDomain;
  scope?: string;
  message: string;
  category?: DomainCategory;
  error?: unknown;
  operationId?: string;
};

export class RefreshErrorNotifier {
  private readonly lastNotifiedErrors = new Map<string, string>();
  private suppressNetworkErrorsUntil = 0;

  notify({
    domain,
    scope,
    message,
    category,
    error,
    operationId,
  }: NotifyRefreshErrorOptions): void {
    if (this.shouldSuppressStartupError(error)) {
      return;
    }
    const key = this.getErrorNotificationKey(domain, scope);
    if (this.lastNotifiedErrors.get(key) === message) {
      return;
    }

    if (domain === 'object-details' && errorStatusOf(error)?.reason === 'NotFound') {
      // The panel shows its object as deleted when the NotFound names it.
      this.lastNotifiedErrors.set(key, message);
      return;
    }

    this.lastNotifiedErrors.set(key, message);
    errorHandler.handle(
      error ?? new Error(message),
      {
        source: 'refresh-orchestrator',
        domain,
        scope: scope ?? 'global',
        category,
        ...(operationId ? { operationId } : {}),
      },
      message
    );
  }

  clear(domain: RefreshDomain, scope?: string): void {
    const key = this.getErrorNotificationKey(domain, scope);
    this.lastNotifiedErrors.delete(key);
  }

  clearAll(): void {
    this.lastNotifiedErrors.clear();
  }

  suppressNetworkErrors(durationMs: number): void {
    this.suppressNetworkErrorsUntil = Math.max(
      this.suppressNetworkErrorsUntil,
      Date.now() + durationMs
    );
  }

  /**
   * Right after a kubeconfig change the backend republishes its refresh
   * service and cluster handlers. Until the window closes, answers that say
   * so, and the browser's own fetch failures, are start-up rather than
   * failures.
   */
  shouldSuppressStartupError(error: unknown): boolean {
    if (Date.now() > this.suppressNetworkErrorsUntil) {
      return false;
    }
    const reason = errorStatusOf(error)?.reason;
    return reason ? STARTUP_REASONS.has(reason) : isBrowserFetchFailure(error);
  }

  private getErrorNotificationKey(domain: RefreshDomain, scope?: string): string {
    return makeInFlightKey(domain, scope ?? '__global__');
  }
}
