import type { AppEvents } from '@/core/events';
import type { RefreshDomain } from './types';

export type InFlightRequest = {
  controller: AbortController;
  isManual: boolean;
  requestId: number;
  cleanup?: () => void;
  contextVersion: number;
  domain: RefreshDomain;
  scope?: string;
};

type StreamingFetchMode = 'snapshot' | 'metrics-only' | 'skip';

type StreamingFetchDecisionInput = {
  domain: RefreshDomain;
  scope: string;
  shouldStream: boolean;
  isManual: boolean;
  metricsOnly: boolean;
  streamingHealthy: boolean;
  metricsMinIntervalMs: number;
  now?: number;
};

export const makeInFlightKey = (domain: RefreshDomain, scope?: string) =>
  `${domain}::${scope ?? '*'}`;

export class ClusterRefreshRuntime {
  readonly inFlight = new Map<string, InFlightRequest>();
  readonly streamingCleanup = new Map<string, () => void>();
  readonly pendingStreaming = new Map<string, Promise<(() => void) | void>>();
  readonly streamingReady = new Map<string, Promise<void>>();
  readonly cancelledStreaming = new Set<string>();
  readonly streamHealth = new Map<string, AppEvents['refresh:resource-stream-health']>();
  readonly blockedStreaming = new Set<string>();
  readonly lastMetricsRefreshAt = new Map<string, number>();
  readonly scopedEnabledState = new Map<RefreshDomain, Map<string, boolean>>();

  constructor(readonly clusterId: string) {}

  isStreamingBlocked(domain: RefreshDomain, scope: string): boolean {
    return this.blockedStreaming.has(makeInFlightKey(domain, scope));
  }

  isStreamingActive(domain: RefreshDomain, scope: string): boolean {
    return this.streamingCleanup.has(makeInFlightKey(domain, scope));
  }

  resolveStreamingFetchMode(input: StreamingFetchDecisionInput): StreamingFetchMode {
    if (input.isManual || !input.shouldStream) {
      return 'snapshot';
    }

    if (!input.metricsOnly) {
      return input.streamingHealthy ? 'skip' : 'snapshot';
    }

    if (!this.isStreamingActive(input.domain, input.scope) || !input.streamingHealthy) {
      return 'snapshot';
    }

    return this.isMetricsRefreshFresh(
      input.domain,
      input.scope,
      input.metricsMinIntervalMs,
      input.now
    )
      ? 'skip'
      : 'metrics-only';
  }

  recordMetricsRefresh(domain: RefreshDomain, scope: string, now = Date.now()): void {
    this.lastMetricsRefreshAt.set(makeInFlightKey(domain, scope), now);
  }

  private isMetricsRefreshFresh(
    domain: RefreshDomain,
    scope: string,
    minIntervalMs: number,
    now = Date.now()
  ): boolean {
    const last = this.lastMetricsRefreshAt.get(makeInFlightKey(domain, scope));
    return last !== undefined && now - last < minIntervalMs;
  }
}
