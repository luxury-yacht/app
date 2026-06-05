/**
 * frontend/src/core/refresh/streaming/catalogStreamManager.ts
 *
 * Module source for catalogStreamManager.
 * Implements catalogStreamManager logic for the core layer.
 */

import { parseClusterScope } from '../clusterScope';
import { refreshManager } from '../RefreshManager';
import { CLUSTER_REFRESHERS } from '../refresherTypes';
import { resetScopedDomainState, setScopedDomainState } from '../store';
import type { CatalogStreamEventPayload } from '../types';
import type { CatalogStreamMergeResult } from './catalogStreamMerge';
import { CatalogStreamMergeQueue } from './catalogStreamMerge';
import { errorHandler } from '@utils/errorHandler';
import { APP_LOG_SOURCES, logAppLogsWarn } from '@/core/logging/appLogsClient';
import { eventBus } from '@/core/events';
import { closeRefreshEventSource, openRefreshEventSource } from './sseStreamTransport';
import { StreamErrorNotifier } from './streamErrorNotifier';
import { streamReconnectDelay } from './streamTiming';
import { StreamVisibilityController } from './streamVisibilityController';

type CatalogStreamEvent = CatalogStreamEventPayload;

// Bound work per tick to avoid nested update bursts.
const CATALOG_STREAM_BATCH_SIZE = 3;
const CATALOG_STREAM_MAX_PENDING = 40;
// Debounce stream application to avoid render storms.
const CATALOG_STREAM_FLUSH_MS = 120;
// Throttle snapshot fallbacks during sustained bursts.
const CATALOG_STREAM_FALLBACK_COOLDOWN_MS = 5000;

function isValidCatalogStreamEvent(data: unknown): data is CatalogStreamEvent {
  if (typeof data !== 'object' || data === null) {
    return false;
  }

  const obj = data as Record<string, unknown>;

  // snapshot is required and must be an object
  if (typeof obj.snapshot !== 'object' || obj.snapshot === null) {
    return false;
  }

  // generatedAt should be a number
  if (typeof obj.generatedAt !== 'number') {
    return false;
  }

  // sequence should be a number
  if (typeof obj.sequence !== 'number') {
    return false;
  }

  // cacheReady and truncated are required booleans
  if (typeof obj.cacheReady !== 'boolean') {
    return false;
  }
  if (typeof obj.truncated !== 'boolean') {
    return false;
  }

  // snapshotMode must be a known string variant
  if (obj.snapshotMode !== 'full' && obj.snapshotMode !== 'partial') {
    return false;
  }

  // stats should be an object
  if (typeof obj.stats !== 'object' || obj.stats === null) {
    return false;
  }

  // Optional boolean fields
  if (obj.reset !== undefined && typeof obj.reset !== 'boolean') {
    return false;
  }
  if (obj.ready !== undefined && typeof obj.ready !== 'boolean') {
    return false;
  }

  return true;
}

class CatalogStreamManager {
  private eventSource: EventSource | null = null;
  private scope: string | null = null;
  private retryTimer: number | null = null;
  private closed = false;
  private attempt = 0;
  private session = 0;
  private streamErrors = new StreamErrorNotifier();
  private visibility = new StreamVisibilityController<string>({
    captureActive: () => (this.eventSource && this.scope ? [this.scope] : []),
    suspendActive: () => {
      this.stop(false);
    },
    resumeItem: (scope) => {
      void this.start(scope);
    },
  });
  private flushTimer: number | null = null;
  private lastAppliedSequence = 0;
  private lastFallbackAt = 0;
  private lastEventAt = 0;
  private mergeQueue = new CatalogStreamMergeQueue({
    maxBatchSize: CATALOG_STREAM_BATCH_SIZE,
    maxPending: CATALOG_STREAM_MAX_PENDING,
  });

  constructor() {
    eventBus.on('kubeconfig:changing', this.handleKubeconfigChanging);
    eventBus.on('kubeconfig:changed', this.handleKubeconfigChanged);
    eventBus.on('app:visibility-hidden', this.visibility.suspend);
    eventBus.on('app:visibility-visible', this.visibility.resume);
  }

  private handleKubeconfigChanging = () => {
    this.streamErrors.suppressFor(5000);
  };

  private handleKubeconfigChanged = () => {
    this.streamErrors.suppressFor(2000);
  };

  async start(scope: string): Promise<() => void> {
    if (typeof window === 'undefined') {
      return () => {};
    }
    this.stop(false);
    this.closed = false;
    this.scope = scope.trim();
    this.attempt = 0;
    this.mergeQueue.reset();
    this.clearFlushTimer();
    this.lastAppliedSequence = 0;
    this.lastFallbackAt = 0;
    this.lastEventAt = 0;
    const session = this.bumpSession();
    await this.openStream(session);
    return () => this.stop(false);
  }

  stop(reset = false): void {
    this.closed = true;
    this.bumpSession();
    this.attempt = 0;
    this.clearFlushTimer();
    this.mergeQueue.reset();
    if (reset) {
      this.streamErrors.suppressFor(2000);
    }
    if (this.retryTimer !== null) {
      window.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    closeRefreshEventSource(this.eventSource);
    this.eventSource = null;
    if (reset) {
      // Guard: scope is set to null after reset, so capture before clearing.
      if (this.scope) {
        resetScopedDomainState('catalog', this.scope);
      }
      this.scope = null;
    }
  }

  /** Reports whether the catalog stream has delivered data recently. */
  isHealthy(scope?: string): boolean {
    const requestedScope = scope?.trim() ?? '';
    if (!this.eventSource || this.closed || !this.scope) {
      return false;
    }
    if (requestedScope && requestedScope !== this.scope) {
      return false;
    }
    // Consider healthy if we received an event within the last 90 seconds.
    // The catalog sync runs every 60s (or 5min with reactive updates),
    // so 90s gives margin for one missed cycle.
    return this.lastEventAt > 0 && Date.now() - this.lastEventAt < 90_000;
  }

  async refreshOnce(scope: string): Promise<void> {
    await this.restart(scope);
  }

  private async restart(scope: string): Promise<void> {
    this.stop(false);
    this.scope = scope.trim();
    this.closed = false;
    this.attempt = 0;
    this.mergeQueue.reset();
    this.clearFlushTimer();
    this.lastAppliedSequence = 0;
    this.lastEventAt = 0;
    const session = this.bumpSession();
    await this.openStream(session);
  }

  private bumpSession(): number {
    this.session = (this.session + 1) % Number.MAX_SAFE_INTEGER;
    return this.session;
  }

  private async openStream(session: number): Promise<void> {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      const handle = await openRefreshEventSource({
        path: '/api/v2/stream/catalog',
        configureURL: (url) => {
          if (this.scope && this.scope.length > 0) {
            url.search = `?${this.scope}`;
          } else {
            url.search = '';
          }
        },
        onMessage: (message) => this.handleMessage(session, message),
        onError: (event) => this.handleError(session, event),
      });
      if (session !== this.session) {
        handle.close();
        return;
      }
      if (this.closed) {
        handle.close();
        return;
      }
      this.eventSource = handle.source;
      this.attempt = 0;
      this.streamErrors.clearSuppression();
    } catch (error) {
      errorHandler.handle(error instanceof Error ? error : new Error(String(error)), {
        source: 'catalog-stream',
      });
      this.scheduleReconnect(session);
    }
  }

  private handleMessage = (session: number, event: MessageEvent) => {
    if (this.closed || session !== this.session) {
      return;
    }
    try {
      const parsed: unknown = JSON.parse(event.data);
      if (!isValidCatalogStreamEvent(parsed)) {
        console.error('Invalid catalog stream event payload structure');
        return;
      }
      this.lastEventAt = Date.now();
      const payload = parsed;
      const isPaginatedScope = Boolean(this.scope && this.scope.includes('continue='));
      const shouldReset = payload.reset && !isPaginatedScope;
      const normalizedPayload = {
        ...payload,
        reset: shouldReset,
      };

      this.mergeQueue.enqueue(normalizedPayload);
      this.scheduleFlush(session);
    } catch (error) {
      errorHandler.handle(error instanceof Error ? error : new Error(String(error)), {
        source: 'catalog-stream-parse',
      });
    }
  };

  private scheduleFlush(session: number): void {
    if (this.flushTimer !== null) {
      return;
    }

    this.flushTimer = window.setTimeout(() => {
      this.flushTimer = null;
      if (this.closed || session !== this.session) {
        return;
      }
      const result = this.mergeQueue.drain();
      if (!result) {
        return;
      }
      this.applyMergedState(session, result);
      if (this.mergeQueue.hasPending()) {
        this.scheduleFlush(session);
      }
    }, CATALOG_STREAM_FLUSH_MS);
  }

  private applyMergedState(session: number, result: CatalogStreamMergeResult): void {
    if (this.closed || session !== this.session) {
      return;
    }
    if (result.sequence <= this.lastAppliedSequence) {
      return;
    }
    this.lastAppliedSequence = result.sequence;

    const scope = this.scope;
    const ready = result.ready;
    const timestamp = result.generatedAt ?? Date.now();

    setScopedDomainState('catalog', scope!, (previous) => {
      if (result.reset) {
        return {
          status: ready ? 'ready' : 'updating',
          data: result.snapshot,
          stats: result.stats ?? null,
          version: undefined,
          checksum: undefined,
          etag: undefined,
          lastUpdated: timestamp,
          lastManualRefresh: undefined,
          lastAutoRefresh: ready ? timestamp : undefined,
          error: null,
          isManual: false,
          droppedAutoRefreshes: 0,
          scope: scope ?? undefined,
        };
      }

      return {
        ...previous,
        status: ready ? 'ready' : 'updating',
        data: result.snapshot,
        stats: result.stats ?? previous.stats ?? null,
        lastUpdated: timestamp,
        lastAutoRefresh: ready ? timestamp : previous.lastAutoRefresh,
        error: null,
        isManual: false,
        scope: scope ?? previous.scope,
      };
    });

    if (result.droppedEvents > 0) {
      this.triggerSnapshotFallback('stream overflow', result);
    }

    if (!result.cacheReady) {
      this.triggerSnapshotFallback('cache not ready', result);
    }
  }

  private triggerSnapshotFallback(reason: string, result: CatalogStreamMergeResult): void {
    const now = Date.now();
    if (now - this.lastFallbackAt < CATALOG_STREAM_FALLBACK_COOLDOWN_MS) {
      return;
    }
    this.lastFallbackAt = now;
    void refreshManager.triggerManualRefresh(CLUSTER_REFRESHERS.browse);
    logAppLogsWarn(
      `Catalog stream fallback (${reason}): dropped=${result.droppedEvents}, seq=${result.sequence}`,
      APP_LOG_SOURCES.CatalogStream,
      { clusterId: parseClusterScope(this.scope).clusterId }
    );
  }

  private clearFlushTimer(): void {
    if (this.flushTimer !== null) {
      window.clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private handleError(session: number, event?: Event): void {
    if (this.closed || session !== this.session) {
      return;
    }
    this.streamErrors.notify({
      source: 'catalog-stream',
      domain: 'catalog',
      scope: this.scope ?? '',
      message: 'Catalog stream connection lost',
      context: {
        eventType: event?.type ?? 'unknown',
        scope: this.scope ?? '',
        attempt: this.attempt,
      },
    });
    if (this.closed || session !== this.session) {
      return;
    }
    this.scheduleReconnect(session);
  }

  private scheduleReconnect(session: number): void {
    if (this.closed || session !== this.session || this.retryTimer !== null) {
      return;
    }
    const delay = streamReconnectDelay(this.attempt, { jitterMs: 250, minMs: 500 });
    this.attempt += 1;
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      void this.openStream(session);
    }, delay);
  }
}

export const catalogStreamManager = new CatalogStreamManager();
