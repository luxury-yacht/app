/**
 * frontend/src/core/refresh/fallbacks/objectLogFallbackManager.ts
 *
 * Module source for objectLogFallbackManager.
 * Implements objectLogFallbackManager logic for the core layer.
 */

import { refreshManager } from '../RefreshManager';
import { SYSTEM_REFRESHERS } from '../refresherTypes';
import { eventBus } from '@/core/events';

type Fetcher = (isManual?: boolean) => Promise<void> | void;

interface FallbackEntry {
  fetcher: Fetcher;
  autoRefresh: boolean;
  inFlight: boolean;
}

class ObjectLogFallbackManager {
  private entries = new Map<string, FallbackEntry>();
  private unsubscribe: (() => void) | null = null;

  constructor() {
    eventBus.on('kubeconfig:changing', () => this.clearAll());
  }

  register(scope: string, fetcher: Fetcher, autoRefresh: boolean): void {
    const trimmed = scope.trim();
    if (!trimmed) {
      return;
    }

    const existing = this.entries.get(trimmed);
    if (existing) {
      existing.fetcher = fetcher;
      existing.autoRefresh = autoRefresh;
      this.updateRefresherState();
      return;
    }

    this.entries.set(trimmed, {
      fetcher,
      autoRefresh,
      inFlight: false,
    });

    this.ensureSubscription();
    this.updateRefresherState();
  }

  update(scope: string, options: { autoRefresh?: boolean; fetcher?: Fetcher }): void {
    const entry = this.entries.get(scope.trim());
    if (!entry) {
      return;
    }
    if (typeof options.autoRefresh === 'boolean') {
      entry.autoRefresh = options.autoRefresh;
      this.updateRefresherState();
    }
    if (options.fetcher) {
      entry.fetcher = options.fetcher;
    }
  }

  async refreshNow(scope: string): Promise<void> {
    const entry = this.entries.get(scope.trim());
    if (!entry || entry.inFlight) {
      return;
    }
    try {
      entry.inFlight = true;
      await Promise.resolve(entry.fetcher(true));
    } finally {
      entry.inFlight = false;
    }
  }

  unregister(scope: string): void {
    const trimmed = scope.trim();
    if (!trimmed) {
      return;
    }
    this.entries.delete(trimmed);
    this.updateRefresherState();
    this.teardownIfIdle();
  }

  private ensureSubscription(): void {
    if (this.unsubscribe) {
      return;
    }

    this.unsubscribe = refreshManager.subscribe(SYSTEM_REFRESHERS.objectLogs, async () => {
      const tasks: Array<Promise<void>> = [];
      this.entries.forEach((entry) => {
        if (!entry.autoRefresh || entry.inFlight) {
          return;
        }
        entry.inFlight = true;
        const task = Promise.resolve(entry.fetcher(false))
          .catch(() => {
            // Swallow errors; individual fetchers handle their own state updates
          })
          .finally(() => {
            entry.inFlight = false;
          });
        tasks.push(task);
      });

      if (tasks.length > 0) {
        await Promise.all(tasks);
      }
    });
  }

  private updateRefresherState(): void {
    const hasAuto = Array.from(this.entries.values()).some((entry) => entry.autoRefresh);
    if (hasAuto) {
      refreshManager.enable(SYSTEM_REFRESHERS.objectLogs);
    } else {
      refreshManager.disable(SYSTEM_REFRESHERS.objectLogs);
    }
  }

  private teardownIfIdle(): void {
    if (this.entries.size > 0) {
      return;
    }

    refreshManager.disable(SYSTEM_REFRESHERS.objectLogs);

    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  private clearAll(): void {
    this.entries.clear();
    this.updateRefresherState();
    this.teardownIfIdle();
  }
}

export const objectLogFallbackManager = new ObjectLogFallbackManager();
