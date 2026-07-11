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
}

const AT_BOTTOM_THRESHOLD_PX = 16;

export const useLogScrollRestoration = ({
  rootRef,
  isParsedView,
  rowCount,
  tailFollowSignal,
  cacheKey,
  getScrollTop,
  setScrollTop,
  forceTailOnNextRestore = false,
}: LogScrollRestorationOptions) => {
  const scrollRestoredRef = useRef(false);
  const wasAtBottomRef = useRef(true);
  const forceTailRestoreRef = useRef(forceTailOnNextRestore);
  const previousCacheKeyRef = useRef(cacheKey);

  const resetScrollRestoration = useCallback((options: { forceTail?: boolean } = {}) => {
    scrollRestoredRef.current = false;
    wasAtBottomRef.current = true;
    forceTailRestoreRef.current = Boolean(options.forceTail);
  }, []);

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
    const scrollEl = getScrollContainer();
    if (!scrollEl) {
      return;
    }

    const handler = () => {
      wasAtBottomRef.current =
        scrollEl.scrollTop + scrollEl.clientHeight >=
        scrollEl.scrollHeight - AT_BOTTOM_THRESHOLD_PX;
      if (!scrollRestoredRef.current) {
        return;
      }
      setScrollTop(cacheKey, scrollEl.scrollTop);
    };

    scrollEl.addEventListener('scroll', handler, { passive: true });
    return () => {
      scrollEl.removeEventListener('scroll', handler);
    };
  }, [cacheKey, getScrollContainer, setScrollTop]);

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
    scrollRestoredRef.current = true;
    forceTailRestoreRef.current = false;
  }, [cacheKey, getScrollContainer, getScrollTop, rowCount]);

  useEffect(() => {
    void rowCount;
    void tailFollowSignal;
    if (!wasAtBottomRef.current || !scrollRestoredRef.current) {
      return;
    }

    const scrollEl = getScrollContainer();
    if (!scrollEl) {
      return;
    }

    let rafId: number | undefined;
    const scrollToBottom = () => {
      const element = getScrollContainer();
      if (!element) {
        return;
      }
      element.scrollTop = element.scrollHeight;
    };

    if (isParsedView) {
      let attempts = 0;
      const maxAttempts = 20;
      const checkAndScroll = () => {
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
  }, [getScrollContainer, isParsedView, tailFollowSignal, rowCount]);

  return { getScrollContainer, resetScrollRestoration };
};
