/**
 * frontend/src/core/refresh/streaming/catalogStreamMerge.ts
 *
 * Stream merge utilities for catalog streaming. Maintains a normalized store
 * of catalog items so partial stream updates can be applied safely and in
 * bounded batches.
 */

import type { SnapshotStats } from '@/core/refresh/client';
import type {
  CatalogItem,
  CatalogSnapshotPayload,
  CatalogStreamEventPayload,
} from '@/core/refresh/types';

type CatalogStreamMergeState = {
  items: CatalogItem[];
  indexByUid: Map<string, number>;
  lastSequence: number;
  snapshot: CatalogSnapshotPayload | null;
};

export type CatalogStreamMergeResult = {
  snapshot: CatalogSnapshotPayload;
  stats: SnapshotStats | null;
  ready: boolean;
  cacheReady: boolean;
  truncated: boolean;
  generatedAt: number;
  sequence: number;
  reset: boolean;
  droppedEvents: number;
};

export type CatalogStreamMergeQueueOptions = {
  maxBatchSize: number;
  maxPending: number;
};

const createMergeState = (): CatalogStreamMergeState => ({
  items: [],
  indexByUid: new Map<string, number>(),
  lastSequence: 0,
  snapshot: null,
});

const rebuildIndexByUid = (items: CatalogItem[]): Map<string, number> => {
  const index = new Map<string, number>();
  items.forEach((item, idx) => {
    if (item.uid) {
      index.set(item.uid, idx);
    }
  });
  return index;
};

const mergeSnapshotMeta = (
  previous: CatalogSnapshotPayload | null,
  incoming: CatalogSnapshotPayload
): CatalogSnapshotPayload => {
  if (!previous) {
    return { ...incoming };
  }
  // Preserve catalog metadata when the stream omits optional fields.
  return {
    ...previous,
    ...incoming,
    kinds: incoming.kinds ?? previous.kinds,
    namespaces: incoming.namespaces ?? previous.namespaces,
    namespaceGroups: incoming.namespaceGroups ?? previous.namespaceGroups,
    parity: incoming.parity ?? previous.parity,
  };
};

const applyFullSnapshot = (
  state: CatalogStreamMergeState,
  incoming: CatalogSnapshotPayload
): CatalogStreamMergeState => ({
  items: incoming.items.length > 0 ? incoming.items.slice() : [],
  indexByUid: rebuildIndexByUid(incoming.items),
  lastSequence: state.lastSequence,
  snapshot: state.snapshot,
});

const applyPartialSnapshot = (
  state: CatalogStreamMergeState,
  incoming: CatalogSnapshotPayload
): { items: CatalogItem[]; indexByUid: Map<string, number> } => {
  if (incoming.items.length === 0) {
    return { items: state.items, indexByUid: state.indexByUid };
  }

  let nextItems = state.items;
  let changed = false;
  const indexByUid = state.indexByUid;

  for (const item of incoming.items) {
    const uid = item.uid;
    if (!uid) {
      if (!changed) {
        nextItems = nextItems.slice();
        changed = true;
      }
      nextItems.push(item);
      continue;
    }
    const existingIndex = indexByUid.get(uid);
    if (existingIndex == null) {
      if (!changed) {
        nextItems = nextItems.slice();
        changed = true;
      }
      indexByUid.set(uid, nextItems.length);
      nextItems.push(item);
      continue;
    }
    if (!changed) {
      nextItems = nextItems.slice();
      changed = true;
    }
    nextItems[existingIndex] = item;
  }

  return { items: nextItems, indexByUid };
};

const applyStreamEvent = (
  state: CatalogStreamMergeState,
  event: CatalogStreamEventPayload
): { state: CatalogStreamMergeState; result: CatalogStreamMergeResult | null } => {
  if (event.sequence <= state.lastSequence) {
    return { state, result: null };
  }

  const gapCount =
    state.lastSequence > 0 && event.sequence > state.lastSequence + 1
      ? event.sequence - state.lastSequence - 1
      : 0;
  const ready = event.ready ?? event.snapshot.isFinal;
  const baseSnapshot = mergeSnapshotMeta(state.snapshot, event.snapshot);
  const isFullSnapshot = event.snapshotMode === 'full' || Boolean(event.reset);
  let nextState = state;
  let nextItems = state.items;
  let nextIndex = state.indexByUid;

  if (isFullSnapshot) {
    nextState = applyFullSnapshot(state, event.snapshot);
    nextItems = nextState.items;
    nextIndex = nextState.indexByUid;
  } else {
    const partial = applyPartialSnapshot(state, event.snapshot);
    nextItems = partial.items;
    nextIndex = partial.indexByUid;
  }

  const nextSnapshot = {
    ...baseSnapshot,
    items: nextItems,
  };

  const updatedState: CatalogStreamMergeState = {
    items: nextItems,
    indexByUid: nextIndex,
    lastSequence: event.sequence,
    snapshot: nextSnapshot,
  };

  return {
    state: updatedState,
    result: {
      snapshot: nextSnapshot,
      stats: event.stats ?? null,
      ready,
      cacheReady: event.cacheReady,
      truncated: event.truncated,
      generatedAt: event.generatedAt,
      sequence: event.sequence,
      reset: Boolean(event.reset),
      droppedEvents: gapCount,
    },
  };
};

export class CatalogStreamMergeQueue {
  private pending: CatalogStreamEventPayload[] = [];
  private state: CatalogStreamMergeState = createMergeState();
  private droppedEvents = 0;

  constructor(private readonly options: CatalogStreamMergeQueueOptions) {}

  enqueue(event: CatalogStreamEventPayload): void {
    if (this.pending.length >= this.options.maxPending) {
      // Drop the oldest update so the queue does not grow unbounded.
      this.pending.shift();
      this.droppedEvents += 1;
    }
    this.pending.push(event);
  }

  reset(): void {
    this.pending = [];
    this.droppedEvents = 0;
    this.state = createMergeState();
  }

  hasPending(): boolean {
    return this.pending.length > 0;
  }

  drain(): CatalogStreamMergeResult | null {
    if (this.pending.length === 0) {
      return null;
    }

    const batch = this.pending.splice(0, this.options.maxBatchSize);
    let output: CatalogStreamMergeResult | null = null;

    for (const event of batch) {
      const applied = applyStreamEvent(this.state, event);
      this.state = applied.state;
      if (applied.result) {
        output = applied.result;
      }
    }

    if (output && this.droppedEvents > 0) {
      output.droppedEvents += this.droppedEvents;
      this.droppedEvents = 0;
    }

    return output;
  }
}
