import { errorHandler } from '@utils/errorHandler';
import type { DomainCategory } from './domainRegistry';
import { makeInFlightKey } from './refreshRuntime';
import type { RefreshDomain } from './types';

type NotifyRefreshErrorOptions = {
  domain: RefreshDomain;
  scope?: string;
  message: string;
  category?: DomainCategory;
};

export class RefreshErrorNotifier {
  private lastNotifiedErrors = new Map<string, string>();
  private suppressNetworkErrorsUntil = 0;

  notify({ domain, scope, message, category }: NotifyRefreshErrorOptions): void {
    if (this.shouldSuppressNetworkError(message)) {
      return;
    }
    const key = this.getErrorNotificationKey(domain, scope);
    if (this.lastNotifiedErrors.get(key) === message) {
      return;
    }

    const normalizedMessage = message.toLowerCase();
    if (
      domain === 'object-details' &&
      (normalizedMessage.includes('not found') || normalizedMessage.includes('could not find'))
    ) {
      // Suppress toasts for transient not-found errors when panels hold stale objects.
      this.lastNotifiedErrors.set(key, message);
      return;
    }
    if (normalizedMessage.includes('catalog hydration incomplete')) {
      this.lastNotifiedErrors.set(key, message);
      if (process.env.NODE_ENV !== 'production') {
        // Surface in dev tools without triggering user-facing toasts.
        console.warn(
          `[Refresh] hydration warning suppressed for ${domain} (${scope ?? 'global'}): ${message}`
        );
      }
      return;
    }

    this.lastNotifiedErrors.set(key, message);
    errorHandler.handle(new Error(message), {
      source: 'refresh-orchestrator',
      domain,
      scope: scope ?? 'global',
      category,
    });
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

  shouldSuppressNetworkError(message: string): boolean {
    if (Date.now() > this.suppressNetworkErrorsUntil) {
      return false;
    }
    const normalized = message.toLowerCase();
    return (
      normalized.includes('load failed') ||
      normalized.includes('failed to fetch') ||
      normalized.includes('could not connect to the server') ||
      normalized.includes('snapshot request failed')
    );
  }

  private getErrorNotificationKey(domain: RefreshDomain, scope?: string): string {
    return makeInFlightKey(domain, scope ?? '__global__');
  }
}
