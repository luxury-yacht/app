import { useCallback, useEffect, useRef, useState } from 'react';

export type CursorPageDirection = 'next' | 'previous' | 'current' | 'jump';

interface CursorPageState {
  continueToken: string | null;
  previousToken: string | null;
  pageIndex: number;
}

interface PageLanding {
  direction: CursorPageDirection;
  pageSize: number;
  startRank?: number;
}

const initialPage: CursorPageState = {
  continueToken: null,
  previousToken: null,
  pageIndex: 1,
};

const landingPageIndex = (current: number, landing?: PageLanding): number => {
  if (!landing) {
    return current;
  }
  if (typeof landing.startRank === 'number') {
    return Math.floor(landing.startRank / landing.pageSize) + 1;
  }
  switch (landing.direction) {
    case 'next':
      return current + 1;
    case 'previous':
      return Math.max(1, current - 1);
    case 'jump':
      return 1;
    default:
      return current;
  }
};

export const queryPageStartRank = (page: number, pageSize: number): number =>
  (Math.max(1, Math.floor(page)) - 1) * pageSize;

// Both query adapters publish one page at a time. Their request and failure
// policies differ, but cursors and the footer position have one owner.
export function useCursorPageSession() {
  const [page, setPage] = useState(initialPage);
  const currentPageRef = useRef(initialPage);

  const resetPage = useCallback((keepPosition = false) => {
    const next = { ...initialPage, pageIndex: keepPosition ? currentPageRef.current.pageIndex : 1 };
    currentPageRef.current = next;
    setPage(next);
  }, []);

  const publishPage = useCallback(
    (tokens: Omit<CursorPageState, 'pageIndex'>, landing?: PageLanding) => {
      const pageIndex = landingPageIndex(currentPageRef.current.pageIndex, landing);
      const next = { ...tokens, pageIndex };
      const previous = currentPageRef.current;
      if (
        previous.pageIndex !== pageIndex ||
        previous.continueToken !== next.continueToken ||
        previous.previousToken !== next.previousToken
      ) {
        currentPageRef.current = next;
        setPage(next);
      }
      return pageIndex;
    },
    []
  );

  return { ...page, resetPage, publishPage };
}

// Only typing into an enabled query is delayed. A search set while the query
// is disabled, or held when it becomes enabled (a saved search that hydrated
// meanwhile), applies at once, so the first read never goes out without it.
// Browse can reseed the value when its structural scope changes before commit.
export function useQuerySearch(search: string, enabled: boolean) {
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const [appliedEnabled, setAppliedEnabled] = useState(enabled);
  if (appliedEnabled !== enabled || (!enabled && debouncedSearch !== search)) {
    setAppliedEnabled(enabled);
    setDebouncedSearch(search);
  }
  useEffect(() => {
    if (search === debouncedSearch) {
      return;
    }
    const timer = window.setTimeout(() => setDebouncedSearch(search), 250);
    return () => window.clearTimeout(timer);
  }, [debouncedSearch, search]);
  return [debouncedSearch, setDebouncedSearch] as const;
}
