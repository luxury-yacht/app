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

  useLayoutEffect(() => {
    const wasActive = previousIsActiveRef.current;
    previousIsActiveRef.current = isActive;
    if (!isActive) {
      pointerScrollActiveRef.current = false;
      userScrollGestureDeadlineRef.current = 0;
      return;
    }

    if (!wasActive) {
      pointerScrollActiveRef.current = false;
      userScrollGestureDeadlineRef.current = 0;
    }

    const scrollEl = getScrollContainer();
    if (!scrollEl) {
      return;
    }
    const knownPosition = knownScrollPositionRef.current;
    const scrollContainerChanged = knownPosition?.element !== scrollEl;
    if (wasActive && scrollRestoredRef.current && !scrollContainerChanged) {
      return;
    }
    if (!restoreScrollPosition()) {
      return;
    }

    if (isTailFollowingRef.current) {
      scrollEl.scrollTop = scrollEl.scrollHeight;
    } else {
      const restoredPosition = knownScrollPositionRef.current;
      const rememberedScrollTop =
        restoredPosition?.element === scrollEl
          ? restoredPosition.scrollTop
          : getScrollPosition(cacheKey)?.scrollTop;
      const maxScrollTop = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
      if (rememberedScrollTop !== undefined) {
        scrollEl.scrollTop = Math.min(rememberedScrollTop, maxScrollTop);
      }
    }
    knownScrollPositionRef.current = captureScrollPosition(scrollEl);
    setScrollPosition(cacheKey, {
      scrollTop: scrollEl.scrollTop,
      isTailFollowing: isTailFollowingRef.current,
    });
  }, [
    cacheKey,
    getScrollContainer,
    getScrollPosition,
    isActive,
    restoreScrollPosition,
    setScrollPosition,
  ]);

  useEffect(() => {
    void rowCount;
    void tailFollowSignal;
    if (!isActive || rowCount === 0) {
      return;
    }

    const shouldFollowTail = () => {
      const element = getScrollContainer();
      if (!element || !scrollRestoredRef.current) {
        return false;
      }
      return isTailFollowingRef.current;
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
      setScrollPosition(cacheKey, {
        scrollTop: element.scrollTop,
        isTailFollowing: true,
      });
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
  }, [
    cacheKey,
    getScrollContainer,
    isActive,
    restoreScrollPosition,
    rowCount,
    setScrollPosition,
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
  }, [cacheKey, getScrollContainer, isActive, restoreScrollPosition, rowCount, setScrollPosition]);

  const resumeTailFollowing = useCallback(() => {
    const scrollEl = getScrollContainer();
    if (!scrollEl) {
      return;
    }
    userScrollGestureDeadlineRef.current = 0;
    pointerScrollActiveRef.current = false;
    setTailFollowing(true);
    scrollEl.scrollTop = scrollEl.scrollHeight;
    knownScrollPositionRef.current = captureScrollPosition(scrollEl);
    scrollRestoredRef.current = true;
    setScrollPosition(cacheKey, {
      scrollTop: scrollEl.scrollTop,
      isTailFollowing: true,
    });
  }, [cacheKey, getScrollContainer, setScrollPosition, setTailFollowing]);

  return { getScrollContainer, resetScrollRestoration, resumeTailFollowing };
};
