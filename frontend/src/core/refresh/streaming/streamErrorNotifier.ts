import { errorHandler } from '@utils/errorHandler';
import type { RefreshDomain } from '../types';

type StreamErrorContext = Record<string, unknown>;

export interface StreamErrorNotification {
  source: string;
  domain?: RefreshDomain | string;
  scope?: string;
  message: string;
  context?: StreamErrorContext;
}

export class StreamErrorNotifier {
  private lastNotifiedErrors = new Map<string, string>();
  private suppressErrorsUntil = 0;

  notify({ source, domain, scope, message, context }: StreamErrorNotification): void {
    if (this.isSuppressed()) {
      return;
    }
    const key = this.notificationKey(domain, scope);
    if (this.lastNotifiedErrors.get(key) === message) {
      return;
    }
    this.lastNotifiedErrors.set(key, message);
    errorHandler.handle(new Error(message), {
      source,
      domain,
      scope: scope ?? 'global',
      context,
    });
  }

  clear(domain?: RefreshDomain | string, scope?: string): void {
    this.lastNotifiedErrors.delete(this.notificationKey(domain, scope));
  }

  clearAll(): void {
    this.lastNotifiedErrors.clear();
  }

  suppressFor(durationMs: number): void {
    this.suppressErrorsUntil = Math.max(this.suppressErrorsUntil, Date.now() + durationMs);
  }

  clearSuppression(): void {
    this.suppressErrorsUntil = 0;
  }

  isSuppressed(): boolean {
    return Date.now() < this.suppressErrorsUntil;
  }

  private notificationKey(domain?: RefreshDomain | string, scope?: string): string {
    return `${domain ?? '__stream__'}::${scope ?? '__global__'}`;
  }
}
