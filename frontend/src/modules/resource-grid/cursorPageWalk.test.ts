/**
 * frontend/src/modules/resource-grid/cursorPageWalk.test.ts
 *
 * Drift-guard semantics for the "all matching rows" export walk (plan P7/F2):
 * a multi-page walk snapshots the domain's raw source clock on its first page
 * and compares per page. First drift → restart the walk once (a cheap shot at
 * a clean pass). Second drift → COMPLETE the walk and flag it, because on a
 * churning domain drift is near-certain and a hard failure would make export
 * unusable exactly there. Failed pages keep rejecting (fails-loudly rule).
 */

import { describe, expect, it } from 'vitest';
import { walkQueryCursorPages, type CursorWalkPage } from './cursorPageWalk';

type Item = string;

// pagesFor builds a fetchPage over consecutive "walk attempts": each attempt
// is an array of pages (items + continue + sourceVersion). A restart replays
// from the next attempt when provided, else the same one.
const fetcherFor = (attempts: Array<Array<CursorWalkPage<Item>>>) => {
  let attempt = 0;
  let index = 0;
  return async (cursor: string | null): Promise<CursorWalkPage<Item>> => {
    if (cursor === null) {
      // A fresh start (initial or restart) moves to the next scripted attempt
      // when one exists.
      if (index > 0 && attempt < attempts.length - 1) {
        attempt += 1;
      }
      index = 0;
    }
    const page = attempts[attempt][index];
    index += 1;
    return page;
  };
};

describe('walkQueryCursorPages drift guard', () => {
  it('collects all pages with a stable source clock and no flag', async () => {
    const result = await walkQueryCursorPages<Item>(
      'test',
      fetcherFor([
        [
          { items: ['a', 'b'], continueToken: 't1', sourceVersion: 'v1' },
          { items: ['c'], continueToken: null, sourceVersion: 'v1' },
        ],
      ])
    );
    expect(result.items).toEqual(['a', 'b', 'c']);
    expect(result.dataChangedDuringWalk).toBe(false);
  });

  it('restarts once on first drift and returns the clean second pass unflagged', async () => {
    const result = await walkQueryCursorPages<Item>(
      'test',
      fetcherFor([
        [
          { items: ['stale-a'], continueToken: 't1', sourceVersion: 'v1' },
          { items: ['stale-b'], continueToken: 't2', sourceVersion: 'v2' }, // drift
        ],
        [
          { items: ['a'], continueToken: 't1', sourceVersion: 'v2' },
          { items: ['b'], continueToken: null, sourceVersion: 'v2' },
        ],
      ])
    );
    expect(result.items).toEqual(['a', 'b']);
    expect(result.dataChangedDuringWalk).toBe(false);
  });

  it('completes and flags on a second drift instead of failing', async () => {
    const result = await walkQueryCursorPages<Item>(
      'test',
      fetcherFor([
        [
          { items: ['x'], continueToken: 't1', sourceVersion: 'v1' },
          { items: ['y'], continueToken: 't2', sourceVersion: 'v2' }, // drift 1 → restart
        ],
        [
          { items: ['a'], continueToken: 't1', sourceVersion: 'v3' },
          { items: ['b'], continueToken: 't2', sourceVersion: 'v4' }, // drift 2 → deliver + flag
          { items: ['c'], continueToken: null, sourceVersion: 'v5' },
        ],
      ])
    );
    expect(result.items).toEqual(['a', 'b', 'c']);
    expect(result.dataChangedDuringWalk).toBe(true);
  });

  it('treats missing source clocks as no-drift (no guard possible)', async () => {
    const result = await walkQueryCursorPages<Item>(
      'test',
      fetcherFor([
        [
          { items: ['a'], continueToken: 't1' },
          { items: ['b'], continueToken: null },
        ],
      ])
    );
    expect(result.items).toEqual(['a', 'b']);
    expect(result.dataChangedDuringWalk).toBe(false);
  });

  it('still rejects on a failed page', async () => {
    await expect(
      walkQueryCursorPages<Item>('test', async () => {
        throw new Error('test export failed: page 1 request was blocked');
      })
    ).rejects.toThrow('blocked');
  });
});
