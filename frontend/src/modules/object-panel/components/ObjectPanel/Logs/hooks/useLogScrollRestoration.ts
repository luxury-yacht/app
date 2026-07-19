import { type RefObject, useCallback, useEffect, useRef } from 'react';

interface LogScrollRestorationOptions {
  rootRef: RefObject<HTMLElement | null>;
  isParsedView: boolean;
  rowCount: number;
  tailFollowSignal: unknown;
  cacheKey: string;
  getScrollTop: (cacheKey: string) => number | undefined;
  setScrollTop: (cacheKey: string, scrollTop: number) => void;
  forceTailOnNextRestore?: boolean;
  onTailFollowingChange?: (isTailFollowing: boolean) => void;
}

const AT_BOTTOM_THRESHOLD_PX = 16;

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
  getScrollTop,
  setScrollTop,
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

    const handler = () => {
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
      setScrollTop(cacheKey, scrollEl.scrollTop);
    };

    scrollEl.addEventListener('scroll', handler, { passive: true });
    return () => {
      scrollEl.removeEventListener('scroll', handler);
    };
  }, [cacheKey, getScrollContainer, rowCount, setScrollTop, setTailFollowing]);

  useEffect(() => {
    if (scrollRestoredRef.current || rowCount === 0) {
      return;
    }

    const scrollEl = getScrollContainer();
    if (!scrollEl || scrollEl.scrollHeight <= scrollEl.clientHeight) {
      return;
    }

    const maxScrollTop = scrollEl.scrollHeight - scrollEl.clientHeight;
    const savedScrollTop = forceTailRestoreRef.current ? undefined : getScrollTop(cacheKey);
    const targetScrollTop =
      savedScrollTop !== null && savedScrollTop !== undefined
        ? Math.min(savedScrollTop, maxScrollTop)
        : maxScrollTop;

    scrollEl.scrollTop = targetScrollTop;
    knownScrollPositionRef.current = captureScrollPosition(scrollEl);
    setTailFollowing(isLogScrollAtBottom(scrollEl));
    scrollRestoredRef.current = true;
    forceTailRestoreRef.current = false;
  }, [cacheKey, getScrollContainer, getScrollTop, rowCount, setTailFollowing]);

  useEffect(() => {
    void rowCount;
    void tailFollowSignal;
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
    if (!shouldFollowTail()) {
      return;
    }

    const scrollEl = getScrollContainer();
    if (!scrollEl) {
      return;
    }

    let rafId: number | undefined;
    const scrollToBottom = () => {
      if (!shouldFollowTail()) {
        return;
      }
      const element = getScrollContainer();
      if (!element) {
        return;
      }
      element.scrollTop = element.scrollHeight;
      knownScrollPositionRef.current = captureScrollPosition(element);
    };

    if (isParsedView) {
      let attempts = 0;
      const maxAttempts = 20;
      const checkAndScroll = () => {
        if (!shouldFollowTail()) {
          return;
        }
        const element = getScrollContainer();
        if (element && element.scrollHeight > element.clientHeight) {
          rafId = requestAnimationFrame(scrollToBottom);
        } else if (attempts < maxAttempts) {
          attempts += 1;
          rafId = requestAnimationFrame(checkAndScroll);
        }
      };
      rafId = requestAnimationFrame(checkAndScroll);
    } else {
      rafId = requestAnimationFrame(scrollToBottom);
    }

    return () => {
      if (rafId !== undefined) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [getScrollContainer, isParsedView, tailFollowSignal, rowCount, setTailFollowing]);

  const resumeTailFollowing = useCallback(() => {
    const scrollEl = getScrollContainer();
    if (!scrollEl) {
      return;
    }
    scrollEl.scrollTop = scrollEl.scrollHeight;
    knownScrollPositionRef.current = captureScrollPosition(scrollEl);
    scrollRestoredRef.current = true;
    setScrollTop(cacheKey, scrollEl.scrollTop);
    setTailFollowing(true);
  }, [cacheKey, getScrollContainer, setScrollTop, setTailFollowing]);

  return { getScrollContainer, resetScrollRestoration, resumeTailFollowing };
};
