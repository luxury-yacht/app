/**
 * frontend/src/core/refresh/streaming/resourceStreamHealth.ts
 *
 * Stores resource-stream health snapshots and emits health-change events. This
 * keeps health publication separate from ResourceStreamManager's connection,
 * resync, and row delivery implementation.
 */

import { eventBus, type AppEvents } from '@/core/events';
import { isSupportedDomain, type DoorbellDomain } from './resourceStreamDomains';

export type ResourceStreamHealthStatus = AppEvents['refresh:resource-stream-health']['status'];
export type ResourceStreamHealthPayload = AppEvents['refresh:resource-stream-health'];
export type ResourceStreamConnectionStatus = ResourceStreamHealthPayload['connectionStatus'];

export const STREAM_HEALTH_STATUS_ORDER: Record<ResourceStreamHealthStatus, number> = {
  healthy: 0,
  degraded: 1,
  unhealthy: 2,
};

export class ResourceStreamHealthStore {
  private snapshots = new Map<string, ResourceStreamHealthPayload>();

  private key(domain: DoorbellDomain, scope: string): string {
    return `${domain}::${scope}`;
  }

  status(domain: DoorbellDomain, scope: string): ResourceStreamHealthStatus {
    return this.snapshots.get(this.key(domain, scope))?.status ?? 'unhealthy';
  }

  snapshot(domain: string, scope: string): ResourceStreamHealthPayload | null {
    if (!isSupportedDomain(domain)) {
      return null;
    }
    return this.snapshots.get(this.key(domain, scope)) ?? null;
  }

  set(next: ResourceStreamHealthPayload): void {
    const key = this.key(next.domain, next.scope);
    const previous = this.snapshots.get(key);
    this.snapshots.set(key, next);
    if (
      !previous ||
      previous.status !== next.status ||
      previous.reason !== next.reason ||
      previous.connectionStatus !== next.connectionStatus
    ) {
      eventBus.emit('refresh:resource-stream-health', next);
    }
  }

  clear(): void {
    this.snapshots.clear();
  }
}
