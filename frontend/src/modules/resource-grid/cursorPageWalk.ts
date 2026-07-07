/**
 * frontend/src/modules/resource-grid/cursorPageWalk.ts
 *
 * The one cursor walk behind every "all matching rows" Copy/Export scope
 * (typed queries and the catalog). The loop, the page guard, the
 * cursor-never-terminates failure, and the cross-page consistency guard live
 * here so a walk fix can never land in one provider and miss the other;
 * blocked/failed/empty pages REJECT inside the caller's fetchPage closure (a
 * partial export saved as success is silent data loss).
 *
 * Consistency guard (docs/architecture/large-data.md "Page Addressing
 * Contract"): each page may carry
 * the domain's RAW source clock (sourceVersions["object"] — never the
 * scope-folded token, which differs per page by construction). The walk
 * snapshots the first page's clock and compares per page: on first drift it
 * restarts once (a cheap shot at a clean pass); on second drift it COMPLETES
 * and sets `dataChangedDuringWalk`, because on a churning domain drift is
 * near-certain and a hard failure would make export unusable exactly where it
 * matters — the caller surfaces the flag as a user-visible warning
 * (loud, not fatal).
 */

const MAX_CURSOR_WALK_PAGES = 100000;

export interface CursorWalkPage<TItem> {
  items: TItem[];
  continueToken: string | null;
  /** The domain's raw source clock at this page's serve; absent = no guard. */
  sourceVersion?: string | null;
}

export interface CursorWalkResult<TItem> {
  items: TItem[];
  /**
   * True when the source clock moved during the walk even after one clean
   * restart — the delivered rows reflect a mix of before/after states and the
   * caller must say so visibly.
   */
  dataChangedDuringWalk: boolean;
}

/**
 * Page through a backend query's full result set following its cursor.
 * `fetchPage` returns the page's items + continue token (+ optional source
 * clock), throws on a failed page, or returns null when no scope can be built
 * (nothing to walk).
 */
export async function walkQueryCursorPages<TItem>(
  label: string,
  fetchPage: (cursor: string | null, page: number) => Promise<CursorWalkPage<TItem> | null>
): Promise<CursorWalkResult<TItem>> {
  let collected: TItem[] = [];
  let cursor: string | null = null;
  let walkClock: string | null = null;
  let restarted = false;
  let drifted = false;
  for (let page = 0; page < MAX_CURSOR_WALK_PAGES; page += 1) {
    const result = await fetchPage(cursor, page);
    if (result === null) {
      break;
    }
    const clock = result.sourceVersion ?? null;
    if (clock !== null) {
      if (walkClock === null) {
        walkClock = clock;
      } else if (clock !== walkClock) {
        if (!restarted) {
          // First drift: restart the whole walk once from page 1.
          restarted = true;
          collected = [];
          cursor = null;
          walkClock = null;
          continue;
        }
        // Second drift: deliver anyway, flagged. Track the moving clock so one
        // sustained change does not re-flag every subsequent page comparison.
        drifted = true;
        walkClock = clock;
      }
    }
    collected.push(...result.items);
    if (!result.continueToken) {
      return { items: collected, dataChangedDuringWalk: drifted };
    }
    cursor = result.continueToken;
  }
  if (cursor !== null) {
    throw new Error(
      `${label} export failed: cursor did not advance after ${MAX_CURSOR_WALK_PAGES} pages`
    );
  }
  return { items: collected, dataChangedDuringWalk: drifted };
}
