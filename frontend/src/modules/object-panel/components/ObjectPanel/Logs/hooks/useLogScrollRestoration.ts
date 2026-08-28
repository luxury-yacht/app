import { type RefObject, useCallback, useEffect, useRef } from 'react';
import type { LogScrollPosition } from '../../types';

interface LogScrollRestorationOptions {
  rootRef: RefObject<HTMLElement | null>;
  isParsedView: boolean;
  rowCount: number;
  tailFollowSignal: unknown;
  cacheKey: string;
  getScrollPosition: (cacheKey: string) => LogScrollPosition | undefined;
  setScrollPosition: (cacheKey: string, position: LogScrollPosition) => void;
  forceTailOnNextRestore?: boolean;
  onTailFollowingChange?: (isTailFollowing: boolean) => void;
}

const AT_BOTTOM_THRESHOLD_PX = 16;
const MAX_LAYOUT_SETTLE_FRAMES = 20;
// Virtualized rows are measured only after the first bottom jump renders them.
// Wait for consecutive stable frames so their real height cannot strand the viewport above the tail.
const REQUIRED_STABLE_LAYOUT_FRAMES = 2;

interface KnownScrollPosition {
  element: HTMLElement;
  scrollTop: number;
  scrollHeight: number;
}

export const isLogScrollAtBottom = (scrollElement: HTMLElement): boolean =>
  scrollElement.scrollTop + scrollElement.clientHeight >=
  scrollElement.scrollHeight - AT_BOTTOM_THRESHOLD_PX;

const captureScrollPosition = (scrollElement: HTMLElement): KnownScrollPosition => ({
  element: scrollElement,
  scrollTop: scrollElement.scrollTop,
  scrollHeight: scrollElement.scrollHeight,
});

const reachedKnownBottom = (
  scrollElement: HTMLElement,
  knownPosition: KnownScrollPosition | null
): boolean =>
  knownPosition?.element === scrollElement &&
  scrollElement.scrollTop > knownPosition.scrollTop &&
  scrollElement.scrollTop + scrollElement.clientHeight >=
    knownPosition.scrollHeight - AT_BOTTOM_THRESHOLD_PX;

export const useLogScrollRestoration = ({
  rootRef,
  isParsedView,
  rowCount,
  tailFollowSignal,
  cacheKey,
  getScrollPosition,
  setScrollPosition,
  forceTailOnNextRestore = false,
  onTailFollowingChange,
}: LogScrollRestorationOptions) => {
  const scrollRestoredRef = useRef(false);
  const wasAtBottomRef = useRef(true);
  const knownScrollPositionRef = useRef<KnownScrollPosition | null>(null);
  const forceTailRestoreRef = useRef(forceTailOnNextRestore);
  const previousCacheKeyRef = useRef(cacheKey);

  const setTailFollowing = useCallback(
    (isTailFollowing: boolean) => {
      if (wasAtBottomRef.current === isTailFollowing) {
        return;
      }
      wasAtBottomRef.current = isTailFollowing;
      onTailFollowingChange?.(isTailFollowing);
    },
    [onTailFollowingChange]
  );

  const resetScrollRestoration = useCallback(
    (options: { forceTail?: boolean } = {}) => {
      scrollRestoredRef.current = false;
      setTailFollowing(true);
      knownScrollPositionRef.current = null;
      forceTailRestoreRef.current = Boolean(options.forceTail);
    },
    [setTailFollowing]
  );

  useEffect(() => {
    if (previousCacheKeyRef.current === cacheKey) {
      return;
    }
    previousCacheKeyRef.current = cacheKey;
    resetScrollRestoration({ forceTail: forceTailOnNextRestore });
  }, [cacheKey, forceTailOnNextRestore, resetScrollRestoration]);

  const getScrollContainer = useCallback((): HTMLElement | null => {
    const root = rootRef.current;
    if (!root) {
      return null;
    }
    if (isParsedView) {
      return root.querySelector<HTMLElement>('.gridtable-wrapper');
    }
    return root;
  }, [isParsedView, rootRef]);

  useEffect(() => {
    // The scroll container is conditionally mounted after loading. Re-check it
    // when rows arrive so scrolling does not depend on a later refresh.
    void rowCount;
    const scrollEl = getScrollContainer();
    if (!scrollEl) {
      return;
    }

    const captureAndPersistPosition = () => {
      const knownPosition = knownScrollPositionRef.current;
      const shouldFollowTail =
        isLogScrollAtBottom(scrollEl) ||
        reachedKnownBottom(scrollEl, knownPosition) ||
        (wasAtBottomRef.current &&
          knownPosition?.element === scrollEl &&
          knownPosition.scrollTop === scrollEl.scrollTop);
      knownScrollPositionRef.current = captureScrollPosition(scrollEl);
      setTailFollowing(shouldFollowTail);
      if (!scrollRestoredRef.current) {
        return;
      }
      setScrollPosition(cacheKey, {
        scrollTop: scrollEl.scrollTop,
        isTailFollowing: shouldFollowTail,
      });
    };
    const handler = () => captureAndPersistPosition();

    scrollEl.addEventListener('scroll', handler, { passive: true });
    return () => {
      scrollEl.removeEventListener('scroll', handler);
      captureAndPersistPosition();
    };
  }, [cacheKey, getScrollContainer, rowCount, setScrollPosition, setTailFollowing]);

  const restoreScrollPosition = useCallback((): boolean => {
    if (scrollRestoredRef.current || rowCount === 0) {
      return scrollRestoredRef.current;
    }

    const scrollEl = getScrollContainer();
    if (!scrollEl || scrollEl.scrollHeight <= scrollEl.clientHeight) {
      return false;
    }

    const maxScrollTop = scrollEl.scrollHeight - scrollEl.clientHeight;
    const savedPosition = forceTailRestoreRef.current ? undefined : getScrollPosition(cacheKey);
    const targetScrollTop = savedPosition?.isTailFollowing
      ? maxScrollTop
      : Math.min(savedPosition?.scrollTop ?? maxScrollTop, maxScrollTop);

    scrollEl.scrollTop = targetScrollTop;
    knownScrollPositionRef.current = captureScrollPosition(scrollEl);
    setTailFollowing(isLogScrollAtBottom(scrollEl));
    scrollRestoredRef.current = true;
    forceTailRestoreRef.current = false;
    return true;
  }, [cacheKey, getScrollContainer, getScrollPosition, rowCount, setTailFollowing]);

  useEffect(() => {
    void rowCount;
    void tailFollowSignal;
    if (rowCount === 0) {
      return;
    }

    const shouldFollowTail = () => {
      const element = getScrollContainer();
      if (!element || !scrollRestoredRef.current) {
        return false;
      }

      // A scrollbar drag or wheel update can change scrollTop before the browser
      // dispatches its scroll event. Compare the live DOM position with the last
      // position we observed so a refresh cannot overtake that manual movement.
      const knownPosition = knownScrollPositionRef.current;
      if (knownPosition?.element === element && knownPosition.scrollTop !== element.scrollTop) {
        setTailFollowing(
          isLogScrollAtBottom(element) || reachedKnownBottom(element, knownPosition)
        );
      }
      knownScrollPositionRef.current = captureScrollPosition(element);
      return wasAtBottomRef.current;
    };
    if (restoreScrollPosition() && !shouldFollowTail()) {
      return;
    }

    let rafId: number | undefined;
    let attempts = 0;
    let previousScrollHeight: number | undefined;
    let stableLayoutFrames = 0;
    const scrollToSettledBottom = () => {
      if (!restoreScrollPosition()) {
        attempts += 1;
        if (attempts < MAX_LAYOUT_SETTLE_FRAMES) {
          rafId = requestAnimationFrame(scrollToSettledBottom);
        }
        return;
      }
      if (!shouldFollowTail()) {
        return;
      }
      const element = getScrollContainer();
      if (!element) {
        return;
      }
      const currentScrollHeight = element.scrollHeight;
      if (currentScrollHeight <= element.clientHeight) {
        knownScrollPositionRef.current = captureScrollPosition(element);
        return;
      }
      element.scrollTop = currentScrollHeight;
      knownScrollPositionRef.current = captureScrollPosition(element);
      stableLayoutFrames =
        previousScrollHeight === currentScrollHeight && isLogScrollAtBottom(element)
          ? stableLayoutFrames + 1
          : 0;
      previousScrollHeight = currentScrollHeight;
      attempts += 1;
      if (
        attempts < MAX_LAYOUT_SETTLE_FRAMES &&
        stableLayoutFrames < REQUIRED_STABLE_LAYOUT_FRAMES
      ) {
        rafId = requestAnimationFrame(scrollToSettledBottom);
      }
    };

    rafId = requestAnimationFrame(scrollToSettledBottom);

    return () => {
      if (rafId !== undefined) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [getScrollContainer, restoreScrollPosition, tailFollowSignal, rowCount, setTailFollowing]);

  useEffect(() => {
    void rowCount;
    const scrollEl = getScrollContainer();
    if (!scrollEl || typeof ResizeObserver === 'undefined') {
      return;
    }

    let layoutRafId: number | undefined;
    const observer = new ResizeObserver(() => {
      if (layoutRafId !== undefined) {
        return;
      }
      layoutRafId = requestAnimationFrame(() => {
        layoutRafId = undefined;
        if (!restoreScrollPosition() || !wasAtBottomRef.current) {
          return;
        }
        const element = getScrollContainer();
        if (!element) {
          return;
        }
        element.scrollTop = element.scrollHeight;
        knownScrollPositionRef.current = captureScrollPosition(element);
        setScrollPosition(cacheKey, {
          scrollTop: element.scrollTop,
          isTailFollowing: true,
        });
      });
    });

    const layoutElements = Array.from(scrollEl.children);
    if (layoutElements.length === 0) {
      observer.observe(scrollEl);
    } else {
      for (const element of layoutElements) {
        observer.observe(element);
      }
    }

    return () => {
      observer.disconnect();
      if (layoutRafId !== undefined) {
        cancelAnimationFrame(layoutRafId);
      }
    };
  }, [cacheKey, getScrollContainer, restoreScrollPosition, rowCount, setScrollPosition]);

  const resumeTailFollowing = useCallback(() => {
    const scrollEl = getScrollContainer();
    if (!scrollEl) {
      return;
    }
    scrollEl.scrollTop = scrollEl.scrollHeight;
    knownScrollPositionRef.current = captureScrollPosition(scrollEl);
    scrollRestoredRef.current = true;
    setScrollPosition(cacheKey, {
      scrollTop: scrollEl.scrollTop,
      isTailFollowing: true,
    });
    setTailFollowing(true);
  }, [cacheKey, getScrollContainer, setScrollPosition, setTailFollowing]);

  return { getScrollContainer, resetScrollRestoration, resumeTailFollowing };
};
