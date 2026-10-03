import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { LogScrollPosition } from '../../types';

interface LogScrollRestorationOptions {
  rootRef: RefObject<HTMLElement | null>;
  isActive?: boolean;
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
const USER_SCROLL_GESTURE_WINDOW_MS = 500;
// Virtualized rows are measured only after the first bottom jump renders them.
// Wait for consecutive stable frames so their real height cannot strand the viewport above the tail.
const REQUIRED_STABLE_LAYOUT_FRAMES = 2;

interface KnownScrollPosition {
  element: HTMLElement;
  scrollTop: number;
  scrollHeight: number;
}

const isLogScrollAtBottom = (scrollElement: HTMLElement): boolean =>
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

const shouldFollowTailAfterUserScroll = (
  scrollElement: HTMLElement,
  knownPosition: KnownScrollPosition | null,
  isTailFollowing: boolean
): boolean =>
  isLogScrollAtBottom(scrollElement) ||
  reachedKnownBottom(scrollElement, knownPosition) ||
  (isTailFollowing &&
    knownPosition?.element === scrollElement &&
    knownPosition.scrollTop === scrollElement.scrollTop);

// Counts consecutive frames whose content height held still with the view at
// the bottom; reports when enough frames have settled.
const createLayoutSettleTracker = () => {
  let previousScrollHeight: number | undefined;
  let stableFrames = 0;
  return (scrollHeight: number, isAtBottom: boolean): boolean => {
    stableFrames = previousScrollHeight === scrollHeight && isAtBottom ? stableFrames + 1 : 0;
    previousScrollHeight = scrollHeight;
    return stableFrames >= REQUIRED_STABLE_LAYOUT_FRAMES;
  };
};

// Scrolls to the tail each frame until the layout settles (virtualized rows
// change height once measured), giving up after MAX_LAYOUT_SETTLE_FRAMES.
// Content shorter than the viewport is already settled. Returns a cancel.
const followTailUntilLayoutSettles = ({
  restore,
  followTarget,
  scrollToTail,
  onShortContent,
}: {
  restore: () => boolean;
  followTarget: () => HTMLElement | null;
  scrollToTail: (element: HTMLElement) => void;
  onShortContent: (element: HTMLElement) => void;
}): (() => void) => {
  let rafId: number | undefined;
  let attempts = 0;
  const layoutSettled = createLayoutSettleTracker();
  const retryNextFrame = () => {
    attempts += 1;
    if (attempts < MAX_LAYOUT_SETTLE_FRAMES) {
      rafId = requestAnimationFrame(scrollToSettledBottom);
    }
  };
  const scrollToSettledBottom = () => {
    if (!restore()) {
      retryNextFrame();
      return;
    }
    const element = followTarget();
    if (!element) {
      return;
    }
    const scrollHeight = element.scrollHeight;
    if (scrollHeight <= element.clientHeight) {
      onShortContent(element);
      return;
    }
    scrollToTail(element);
    if (!layoutSettled(scrollHeight, isLogScrollAtBottom(element))) {
      retryNextFrame();
    }
  };
  rafId = requestAnimationFrame(scrollToSettledBottom);
  return () => {
    if (rafId !== undefined) {
      cancelAnimationFrame(rafId);
    }
  };
};

const isScrollKey = (event: KeyboardEvent): boolean =>
  ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Spacebar'].includes(
    event.key
  );

const isUpwardScrollKey = (event: KeyboardEvent): boolean =>
  ['ArrowUp', 'PageUp', 'Home'].includes(event.key) ||
  ((event.key === ' ' || event.key === 'Spacebar') && event.shiftKey);

export const useLogScrollRestoration = ({
  rootRef,
  isActive = true,
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
  const isTailFollowingRef = useRef(true);
  const knownScrollPositionRef = useRef<KnownScrollPosition | null>(null);
  const forceTailRestoreRef = useRef(forceTailOnNextRestore);
  const previousCacheKeyRef = useRef(cacheKey);
  const previousIsActiveRef = useRef(isActive);
  const pointerScrollActiveRef = useRef(false);
  const userScrollGestureDeadlineRef = useRef(0);

  const setTailFollowing = useCallback(
    (isTailFollowing: boolean) => {
      if (isTailFollowingRef.current === isTailFollowing) {
        return;
      }
      isTailFollowingRef.current = isTailFollowing;
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

  const persistScrollPosition = useCallback(
    (scrollEl: HTMLElement, isTailFollowing: boolean) => {
      knownScrollPositionRef.current = captureScrollPosition(scrollEl);
      setScrollPosition(cacheKey, { scrollTop: scrollEl.scrollTop, isTailFollowing });
    },
    [cacheKey, setScrollPosition]
  );

  const scrollToTail = useCallback(
    (scrollEl: HTMLElement) => {
      scrollEl.scrollTop = scrollEl.scrollHeight;
      persistScrollPosition(scrollEl, true);
    },
    [persistScrollPosition]
  );

  useLayoutEffect(() => {
    // The scroll container is conditionally mounted after loading. Re-check it
    // when rows arrive so scrolling does not depend on a later refresh. The
    // layout cleanup also captures the final position before React detaches it.
    void rowCount;
    const scrollEl = getScrollContainer();
    if (!scrollEl) {
      return;
    }

    const persistKnownPosition = () => {
      const knownPosition = knownScrollPositionRef.current;
      if (!scrollRestoredRef.current || !knownPosition || knownPosition.element !== scrollEl) {
        return;
      }
      setScrollPosition(cacheKey, {
        scrollTop: knownPosition.scrollTop,
        isTailFollowing: isTailFollowingRef.current,
      });
    };

    const captureAndPersistKnownIntent = () => {
      if (!isActive || !scrollEl.isConnected || !hasUserScrollGesture()) {
        persistKnownPosition();
        return;
      }
      const knownPosition = knownScrollPositionRef.current;
      setTailFollowing(
        shouldFollowTailAfterUserScroll(scrollEl, knownPosition, isTailFollowingRef.current)
      );
      knownScrollPositionRef.current = captureScrollPosition(scrollEl);
      persistKnownPosition();
    };

    const markUserScrollGesture = () => {
      userScrollGestureDeadlineRef.current = Date.now() + USER_SCROLL_GESTURE_WINDOW_MS;
    };
    const hasUserScrollGesture = () =>
      pointerScrollActiveRef.current || Date.now() <= userScrollGestureDeadlineRef.current;

    const handleScroll = () => {
      if (!isActive || !scrollEl.isConnected) {
        persistKnownPosition();
        return;
      }
      if (!hasUserScrollGesture()) {
        persistKnownPosition();
        return;
      }
      const knownPosition = knownScrollPositionRef.current;
      setTailFollowing(
        shouldFollowTailAfterUserScroll(scrollEl, knownPosition, isTailFollowingRef.current)
      );
      markUserScrollGesture();
      knownScrollPositionRef.current = captureScrollPosition(scrollEl);
      persistKnownPosition();
    };

    const handleWheel = (event: WheelEvent) => {
      if (!isActive || event.deltaY === 0) {
        return;
      }
      markUserScrollGesture();
      if (event.deltaY < 0 && scrollEl.scrollTop > 0) {
        setTailFollowing(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isActive || !isScrollKey(event)) {
        return;
      }
      markUserScrollGesture();
      if (isUpwardScrollKey(event) && scrollEl.scrollTop > 0) {
        setTailFollowing(false);
      }
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (!isActive || (event.pointerType === 'mouse' && event.target !== scrollEl)) {
        return;
      }
      pointerScrollActiveRef.current = true;
      markUserScrollGesture();
    };
    const handlePointerEnd = () => {
      if (!pointerScrollActiveRef.current) {
        return;
      }
      pointerScrollActiveRef.current = false;
      markUserScrollGesture();
    };

    scrollEl.addEventListener('scroll', handleScroll, { passive: true });
    scrollEl.addEventListener('wheel', handleWheel, { passive: true });
    scrollEl.addEventListener('keydown', handleKeyDown);
    scrollEl.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointerup', handlePointerEnd);
    window.addEventListener('pointercancel', handlePointerEnd);
    return () => {
      scrollEl.removeEventListener('scroll', handleScroll);
      scrollEl.removeEventListener('wheel', handleWheel);
      scrollEl.removeEventListener('keydown', handleKeyDown);
      scrollEl.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointerup', handlePointerEnd);
      window.removeEventListener('pointercancel', handlePointerEnd);
      pointerScrollActiveRef.current = false;
      captureAndPersistKnownIntent();
    };
  }, [cacheKey, getScrollContainer, isActive, rowCount, setScrollPosition, setTailFollowing]);

  const restoreScrollPosition = useCallback((): boolean => {
    if (!isActive) {
      return false;
    }
    if (scrollRestoredRef.current || rowCount === 0) {
      return scrollRestoredRef.current;
    }

    const scrollEl = getScrollContainer();
    if (!scrollEl || scrollEl.scrollHeight <= scrollEl.clientHeight) {
      return false;
    }

    const maxScrollTop = scrollEl.scrollHeight - scrollEl.clientHeight;
    const savedPosition = forceTailRestoreRef.current ? undefined : getScrollPosition(cacheKey);
    const shouldFollowTail = savedPosition?.isTailFollowing !== false;
    const targetScrollTop = shouldFollowTail
      ? maxScrollTop
      : Math.min(savedPosition.scrollTop, maxScrollTop);

    scrollEl.scrollTop = targetScrollTop;
    knownScrollPositionRef.current = captureScrollPosition(scrollEl);
    setTailFollowing(shouldFollowTail);
    scrollRestoredRef.current = true;
    forceTailRestoreRef.current = false;
    return true;
  }, [cacheKey, getScrollContainer, getScrollPosition, isActive, rowCount, setTailFollowing]);

  // After a restore, pins the view to the tail, or back to the remembered
  // offset: this container's own, else the saved one (the view mode changed).
  const reapplyRestoredScroll = useCallback(
    (scrollEl: HTMLElement) => {
      if (isTailFollowingRef.current) {
        scrollEl.scrollTop = scrollEl.scrollHeight;
      } else {
        const knownPosition = knownScrollPositionRef.current;
        const rememberedScrollTop =
          knownPosition?.element === scrollEl
            ? knownPosition.scrollTop
            : getScrollPosition(cacheKey)?.scrollTop;
        if (rememberedScrollTop !== undefined) {
          const maxScrollTop = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
          scrollEl.scrollTop = Math.min(rememberedScrollTop, maxScrollTop);
        }
      }
      persistScrollPosition(scrollEl, isTailFollowingRef.current);
    },
    [cacheKey, getScrollPosition, persistScrollPosition]
  );

  useLayoutEffect(() => {
    const wasActive = previousIsActiveRef.current;
    previousIsActiveRef.current = isActive;
    if (!isActive || !wasActive) {
      // A hidden or just-shown tab has no scroll gesture in progress.
      pointerScrollActiveRef.current = false;
      userScrollGestureDeadlineRef.current = 0;
    }
    const scrollEl = isActive ? getScrollContainer() : null;
    if (!scrollEl) {
      return;
    }
    const alreadyRestoredHere =
      wasActive &&
      scrollRestoredRef.current &&
      knownScrollPositionRef.current?.element === scrollEl;
    if (!alreadyRestoredHere && restoreScrollPosition()) {
      reapplyRestoredScroll(scrollEl);
    }
  }, [getScrollContainer, isActive, reapplyRestoredScroll, restoreScrollPosition]);

  useEffect(() => {
    void rowCount;
    void tailFollowSignal;
    if (!isActive || rowCount === 0) {
      return;
    }

    // The container to keep at the tail, or null while not following it.
    const followTarget = () =>
      scrollRestoredRef.current && isTailFollowingRef.current ? getScrollContainer() : null;
    if (restoreScrollPosition() && !followTarget()) {
      return;
    }
    return followTailUntilLayoutSettles({
      restore: restoreScrollPosition,
      followTarget,
      scrollToTail,
      onShortContent: (element) => {
        knownScrollPositionRef.current = captureScrollPosition(element);
      },
    });
  }, [
    getScrollContainer,
    isActive,
    restoreScrollPosition,
    rowCount,
    scrollToTail,
    tailFollowSignal,
  ]);

  useEffect(() => {
    void rowCount;
    if (!isActive) {
      return;
    }
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
        if (!restoreScrollPosition() || !isTailFollowingRef.current) {
          return;
        }
        const element = getScrollContainer();
        if (element) {
          scrollToTail(element);
        }
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
  }, [getScrollContainer, isActive, restoreScrollPosition, rowCount, scrollToTail]);

  const resumeTailFollowing = useCallback(() => {
    const scrollEl = getScrollContainer();
    if (!scrollEl) {
      return;
    }
    userScrollGestureDeadlineRef.current = 0;
    pointerScrollActiveRef.current = false;
    setTailFollowing(true);
    scrollRestoredRef.current = true;
    scrollToTail(scrollEl);
  }, [getScrollContainer, scrollToTail, setTailFollowing]);

  return { getScrollContainer, resetScrollRestoration, resumeTailFollowing };
};
