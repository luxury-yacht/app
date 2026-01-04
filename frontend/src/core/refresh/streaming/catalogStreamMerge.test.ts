/**
 * frontend/src/core/refresh/streaming/catalogStreamMerge.test.ts
 *
 * Tests for the catalog stream merge queue.
 */

import { describe, expect, it } from 'vitest';

import { CatalogStreamMergeQueue } from './catalogStreamMerge';

const createSnapshot = () => ({
  items: [],
  total: 0,
  resourceCount: 0,
  batchIndex: 0,
  batchSize: 0,
  totalBatches: 0,
  isFinal: false,
});

const createEvent = (sequence: number) => ({
  reset: false,
  ready: false,
  cacheReady: true,
  truncated: false,
  snapshotMode: 'partial' as const,
  snapshot: createSnapshot(),
  stats: { itemCount: 0, buildDurationMs: 0 },
  generatedAt: sequence * 1000,
  sequence,
});

describe('CatalogStreamMergeQueue', () => {
  it('applies batch caps and drains remaining events on the next tick', () => {
    const queue = new CatalogStreamMergeQueue({ maxBatchSize: 2, maxPending: 10 });

    queue.enqueue(createEvent(1));
    queue.enqueue(createEvent(2));
    queue.enqueue(createEvent(3));

    const first = queue.drain();
    expect(first?.sequence).toBe(2);
    expect(queue.hasPending()).toBe(true);

    const second = queue.drain();
    expect(second?.sequence).toBe(3);
    expect(queue.hasPending()).toBe(false);
  });

  it('tracks sequence gaps and pending drops for fallback decisions', () => {
    const queue = new CatalogStreamMergeQueue({ maxBatchSize: 5, maxPending: 2 });

    queue.enqueue(createEvent(1));
    queue.enqueue(createEvent(3));
    queue.enqueue(createEvent(4)); // drops the oldest event to stay within maxPending

    const result = queue.drain();
    expect(result?.sequence).toBe(4);
    // One dropped due to maxPending; gap is not observed after dropping.
    expect(result?.droppedEvents).toBe(1);
  });
});
