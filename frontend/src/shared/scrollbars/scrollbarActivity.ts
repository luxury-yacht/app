const SCROLLBAR_ACTIVE_CLASS = 'scrollbar-active';
const DEFAULT_ACTIVE_TIMEOUT_MS = 900;
const DEFAULT_FADE_DURATION_MS = 180;

const activeTimers = new WeakMap<Element, number>();
const opacityAnimations = new WeakMap<
  Element,
  {
    frameId: number;
    value: number;
  }
>();
let initialized = false;

const parseDurationMs = (value: string, fallback = DEFAULT_ACTIVE_TIMEOUT_MS): number => {
  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }

  if (trimmed.endsWith('ms')) {
    const parsed = Number.parseFloat(trimmed.slice(0, -2));
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  if (trimmed.endsWith('s')) {
    const parsed = Number.parseFloat(trimmed.slice(0, -1));
    return Number.isFinite(parsed) ? parsed * 1000 : fallback;
  }

  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const readActiveTimeoutMs = (): number => {
  const styles = getComputedStyle(document.documentElement);
  return parseDurationMs(styles.getPropertyValue('--scrollbar-active-timeout'));
};

const readFadeDurationMs = (direction: 'in' | 'out'): number => {
  const styles = getComputedStyle(document.documentElement);
  const directionalToken =
    direction === 'in' ? '--scrollbar-fade-in-duration' : '--scrollbar-fade-out-duration';
  const directionalDuration = parseDurationMs(
    styles.getPropertyValue(directionalToken),
    Number.NaN
  );
  if (Number.isFinite(directionalDuration)) {
    return directionalDuration;
  }

  return parseDurationMs(
    styles.getPropertyValue('--scrollbar-fade-duration'),
    DEFAULT_FADE_DURATION_MS
  );
};

const readOpacityToken = (tokenName: string, fallback: number): number => {
  const styles = getComputedStyle(document.documentElement);
  const parsed = Number.parseFloat(styles.getPropertyValue(tokenName));
  return Number.isFinite(parsed) ? parsed : fallback;
};

const setScrollbarOpacity = (element: Element, opacity: number): void => {
  if (!(element instanceof HTMLElement)) {
    return;
  }
  element.style.setProperty('--scrollbar-thumb-current-opacity', String(opacity));
};

const clearScrollbarOpacity = (element: Element): void => {
  if (!(element instanceof HTMLElement)) {
    return;
  }
  element.style.removeProperty('--scrollbar-thumb-current-opacity');
};

const getCurrentScrollbarOpacity = (element: Element): number => {
  const animation = opacityAnimations.get(element);
  if (animation) {
    return animation.value;
  }

  if (element instanceof HTMLElement) {
    const inlineOpacity = Number.parseFloat(
      element.style.getPropertyValue('--scrollbar-thumb-current-opacity')
    );
    if (Number.isFinite(inlineOpacity)) {
      return inlineOpacity;
    }
  }

  const styles = getComputedStyle(element);
  const computedOpacity = Number.parseFloat(
    styles.getPropertyValue('--scrollbar-thumb-current-opacity')
  );
  if (Number.isFinite(computedOpacity)) {
    return computedOpacity;
  }

  return readOpacityToken('--scrollbar-thumb-idle-opacity', 0);
};

const animateScrollbarOpacity = (
  element: Element,
  targetOpacity: number,
  onComplete?: () => void
): void => {
  const existingAnimation = opacityAnimations.get(element);
  if (existingAnimation) {
    window.cancelAnimationFrame(existingAnimation.frameId);
  }

  const startOpacity = getCurrentScrollbarOpacity(element);
  setScrollbarOpacity(element, startOpacity);

  const duration = readFadeDurationMs(targetOpacity > startOpacity ? 'in' : 'out');
  if (duration <= 0 || startOpacity === targetOpacity) {
    setScrollbarOpacity(element, targetOpacity);
    opacityAnimations.delete(element);
    onComplete?.();
    return;
  }

  const startedAt = window.performance.now();
  const step = (now: number) => {
    const progress = Math.min(1, (now - startedAt) / duration);
    const easedProgress = 1 - Math.pow(1 - progress, 3);
    const value = startOpacity + (targetOpacity - startOpacity) * easedProgress;
    setScrollbarOpacity(element, value);

    if (progress >= 1) {
      opacityAnimations.delete(element);
      onComplete?.();
      return;
    }

    const frameId = window.requestAnimationFrame(step);
    opacityAnimations.set(element, { frameId, value });
  };

  const frameId = window.requestAnimationFrame(step);
  opacityAnimations.set(element, { frameId, value: startOpacity });
};

const resolveScrollElement = (target: EventTarget | null): Element | null => {
  if (target instanceof Element) {
    return target;
  }
  if (target instanceof Document) {
    return target.scrollingElement ?? target.documentElement;
  }
  return null;
};

const canScroll = (element: Element): boolean => {
  if (!(element instanceof HTMLElement)) {
    return false;
  }
  const styles = getComputedStyle(element);
  const overflowX = styles.overflowX;
  const overflowY = styles.overflowY;
  const scrollsX =
    (overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'overlay') &&
    element.scrollWidth > element.clientWidth;
  const scrollsY =
    (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') &&
    element.scrollHeight > element.clientHeight;
  return scrollsX || scrollsY;
};

const canScrollWithDelta = (element: Element, deltaX: number, deltaY: number): boolean => {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  const styles = getComputedStyle(element);
  const scrollsX =
    (styles.overflowX === 'auto' ||
      styles.overflowX === 'scroll' ||
      styles.overflowX === 'overlay') &&
    element.scrollWidth > element.clientWidth;
  const scrollsY =
    (styles.overflowY === 'auto' ||
      styles.overflowY === 'scroll' ||
      styles.overflowY === 'overlay') &&
    element.scrollHeight > element.clientHeight;

  const canMoveX =
    scrollsX &&
    ((deltaX < 0 && element.scrollLeft > 0) ||
      (deltaX > 0 && element.scrollLeft + element.clientWidth < element.scrollWidth - 1));
  const canMoveY =
    scrollsY &&
    ((deltaY < 0 && element.scrollTop > 0) ||
      (deltaY > 0 && element.scrollTop + element.clientHeight < element.scrollHeight - 1));

  if (Math.abs(deltaX) > Math.abs(deltaY)) {
    return canMoveX || canMoveY;
  }
  return canMoveY || canMoveX;
};

const findScrollableAncestor = (target: EventTarget | null): Element | null => {
  let element = resolveScrollElement(target);
  while (element) {
    if (canScroll(element)) {
      return element;
    }
    element = element.parentElement;
  }
  return document.scrollingElement ?? document.documentElement;
};

const findWheelScrollTarget = (target: EventTarget | null, event: WheelEvent): Element | null => {
  let element = resolveScrollElement(target);
  let nearestScrollableElement: Element | null = null;
  while (element) {
    if (!nearestScrollableElement && canScroll(element)) {
      nearestScrollableElement = element;
    }
    if (canScrollWithDelta(element, event.deltaX, event.deltaY)) {
      return element;
    }
    element = element.parentElement;
  }

  const documentScroller = document.scrollingElement ?? document.documentElement;
  if (canScrollWithDelta(documentScroller, event.deltaX, event.deltaY)) {
    return documentScroller;
  }
  return nearestScrollableElement;
};

const SCROLL_KEYS = new Set([
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'End',
  'Home',
  'PageDown',
  'PageUp',
  ' ',
  'Spacebar',
]);

const markScrollbarActive = (element: Element): void => {
  const activeOpacity = readOpacityToken('--scrollbar-thumb-active-opacity', 1);
  setScrollbarOpacity(element, getCurrentScrollbarOpacity(element));
  element.classList.add(SCROLLBAR_ACTIVE_CLASS);
  animateScrollbarOpacity(element, activeOpacity);

  const terminalElement = element.closest('.shell-tab__terminal');
  if (terminalElement && terminalElement !== element) {
    markScrollbarActive(terminalElement);
  }

  const existingTimer = activeTimers.get(element);
  if (existingTimer !== undefined) {
    window.clearTimeout(existingTimer);
  }

  const timer = window.setTimeout(() => {
    const idleOpacity = readOpacityToken('--scrollbar-thumb-idle-opacity', 0);
    animateScrollbarOpacity(element, idleOpacity, () => {
      element.classList.remove(SCROLLBAR_ACTIVE_CLASS);
      clearScrollbarOpacity(element);
      activeTimers.delete(element);
    });
  }, readActiveTimeoutMs());
  activeTimers.set(element, timer);
};

export const initializeScrollbarActivityTracking = (): void => {
  if (initialized || typeof document === 'undefined') {
    return;
  }
  initialized = true;

  document.addEventListener(
    'scroll',
    (event) => {
      const element = resolveScrollElement(event.target);
      if (element) {
        markScrollbarActive(element);
      }
    },
    { capture: true, passive: true }
  );

  document.addEventListener(
    'wheel',
    (event) => {
      const element = findWheelScrollTarget(event.target, event);
      if (element) {
        markScrollbarActive(element);
      }
    },
    { capture: true, passive: true }
  );

  document.addEventListener(
    'touchmove',
    (event) => {
      const element = findScrollableAncestor(event.target);
      if (element) {
        markScrollbarActive(element);
      }
    },
    { capture: true, passive: true }
  );

  document.addEventListener(
    'keydown',
    (event) => {
      if (!SCROLL_KEYS.has(event.key)) {
        return;
      }
      const element = findScrollableAncestor(document.activeElement);
      if (element) {
        markScrollbarActive(element);
      }
    },
    { capture: true, passive: true }
  );
};
