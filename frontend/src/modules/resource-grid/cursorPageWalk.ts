/**
 * frontend/src/modules/resource-grid/cursorPageWalk.ts
 *
 * The one cursor walk behind every "all matching rows" Copy/Export scope
 * (typed queries and the catalog). The loop, the page guard, and the
 * cursor-never-terminates failure live here so a walk fix can never land in
 * one provider and miss the other; blocked/failed/empty pages REJECT inside
 * the caller's fetchPage closure (a partial export saved as success is silent
 * data loss).
 */

const MAX_CURSOR_WALK_PAGES = 100000;

export interface CursorWalkPage<TItem> {
  items: TItem[];
  continueToken: string | null;
}

/**
 * Page through a backend query's full result set following its cursor.
 * `fetchPage` returns the page's items + continue token, throws on a failed
 * page, or returns null when no scope can be built (nothing to walk).
 */
export async function walkQueryCursorPages<TItem>(
  label: string,
  fetchPage: (cursor: string | null, page: number) => Promise<CursorWalkPage<TItem> | null>
): Promise<TItem[]> {
  const collected: TItem[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_CURSOR_WALK_PAGES; page += 1) {
    const result = await fetchPage(cursor, page);
    if (result === null) {
      break;
    }
    collected.push(...result.items);
    if (!result.continueToken) {
      return collected;
    }
    cursor = result.continueToken;
  }
  if (cursor !== null) {
    throw new Error(
      `${label} export failed: cursor did not advance after ${MAX_CURSOR_WALK_PAGES} pages`
    );
  }
  return collected;
}
