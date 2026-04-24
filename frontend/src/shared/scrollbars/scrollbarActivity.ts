const SCROLLBAR_ACTIVE_CLASS = 'scrollbar-active';
const OVERLAY_SCROLLBAR_SELECTOR = [
  '.view-content--cluster-overview',
  '.gridtable-wrapper',
  '.dockable-panel__content',
  '.object-panel-content',
  '.recent-events__list',
].join(',');
const DEFAULT_ACTIVE_TIMEOUT_MS = 900;
const DEFAULT_FADE_DURATION_MS = 180;

const activeTimers = new WeakMap<Element, number>();
const overlayElements = new WeakMap<
  Element,
  {
    horizontalThumb: HTMLDivElement;
    verticalThumb: HTMLDivElement;
  }
>();
const activeOverlayElements = new Set<Element>();
const opacityAnimations = new WeakMap<
  Element,
  {
    frameId: number;
    value: number;
  }
>();
let initialized = false;
let activeDrag:
  | {
      axis: 'horizontal' | 'vertical';
      element: HTMLElement;
      maxScroll: number;
      startPointerPosition: number;
      startScrollPosition: number;
      trackSize: number;
      thumbSize: number;
    }
  | undefined;

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

const readPxToken = (tokenName: string, fallback: number): number => {
  const styles = getComputedStyle(document.documentElement);
  const value = styles.getPropertyValue(tokenName).trim();
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const isOverlayScrollbarElement = (element: Element): element is HTMLElement =>
  element instanceof HTMLElement && element.matches(OVERLAY_SCROLLBAR_SELECTOR);

const ensureOverlayScrollbars = (element: Element) => {
  if (!isOverlayScrollbarElement(element)) {
    return undefined;
  }

  const existing = overlayElements.get(element);
  if (existing) {
    return existing;
  }

  const verticalThumb = document.createElement('div');
  verticalThumb.className = 'scrollbar-overlay-thumb scrollbar-overlay-thumb--vertical';
  verticalThumb.dataset.scrollbarAxis = 'vertical';

  const horizontalThumb = document.createElement('div');
  horizontalThumb.className = 'scrollbar-overlay-thumb scrollbar-overlay-thumb--horizontal';
  horizontalThumb.dataset.scrollbarAxis = 'horizontal';

  verticalThumb.addEventListener('pointerdown', (event) =>
    startOverlayScrollbarDrag(event, element, 'vertical')
  );
  horizontalThumb.addEventListener('pointerdown', (event) =>
    startOverlayScrollbarDrag(event, element, 'horizontal')
  );

  document.body.append(verticalThumb, horizontalThumb);

  const overlay = { horizontalThumb, verticalThumb };
  overlayElements.set(element, overlay);
  return overlay;
};

const removeOverlayScrollbars = (element: Element): void => {
  const overlay = overlayElements.get(element);
  if (!overlay) {
    return;
  }

  overlay.verticalThumb.remove();
  overlay.horizontalThumb.remove();
  overlayElements.delete(element);
  activeOverlayElements.delete(element);
};

const updateOverlayScrollbarGeometry = (element: Element): void => {
  if (!isOverlayScrollbarElement(element)) {
    return;
  }

  const overlay = ensureOverlayScrollbars(element);
  if (!overlay) {
    return;
  }

  const rect = element.getBoundingClientRect();
  const scrollbarWidth = readPxToken('--scrollbar-width', 10);
  const scrollbarHeight = readPxToken('--scrollbar-height', 10);
  const thumbInset = readPxToken('--scrollbar-thumb-inset', 3);
  const minThumbSize = readPxToken('--scrollbar-min-thumb-size', 32);
  const activeOpacity = getCurrentScrollbarOpacity(element);

  const hasVerticalScrollbar = element.scrollHeight > element.clientHeight;
  const hasHorizontalScrollbar = element.scrollWidth > element.clientWidth;

  if (hasVerticalScrollbar && rect.height > 0) {
    const trackHeight = rect.height - thumbInset * 2;
    const thumbHeight = Math.max(
      minThumbSize,
      Math.min(trackHeight, (element.clientHeight / element.scrollHeight) * trackHeight)
    );
    const maxScrollTop = Math.max(1, element.scrollHeight - element.clientHeight);
    const thumbTop =
      rect.top + thumbInset + (element.scrollTop / maxScrollTop) * (trackHeight - thumbHeight);

    overlay.verticalThumb.style.display = 'block';
    overlay.verticalThumb.style.left = `${rect.right - scrollbarWidth + thumbInset}px`;
    overlay.verticalThumb.style.top = `${thumbTop}px`;
    overlay.verticalThumb.style.width = `${Math.max(1, scrollbarWidth - thumbInset * 2)}px`;
    overlay.verticalThumb.style.height = `${thumbHeight}px`;
    overlay.verticalThumb.style.opacity = String(activeOpacity);
  } else {
    overlay.verticalThumb.style.display = 'none';
  }

  if (hasHorizontalScrollbar && rect.width > 0) {
    const trackWidth = rect.width - thumbInset * 2;
    const thumbWidth = Math.max(
      minThumbSize,
      Math.min(trackWidth, (element.clientWidth / element.scrollWidth) * trackWidth)
    );
    const maxScrollLeft = Math.max(1, element.scrollWidth - element.clientWidth);
    const thumbLeft =
      rect.left + thumbInset + (element.scrollLeft / maxScrollLeft) * (trackWidth - thumbWidth);

    overlay.horizontalThumb.style.display = 'block';
    overlay.horizontalThumb.style.left = `${thumbLeft}px`;
    overlay.horizontalThumb.style.top = `${rect.bottom - scrollbarHeight + thumbInset}px`;
    overlay.horizontalThumb.style.width = `${thumbWidth}px`;
    overlay.horizontalThumb.style.height = `${Math.max(1, scrollbarHeight - thumbInset * 2)}px`;
    overlay.horizontalThumb.style.opacity = String(activeOpacity);
  } else {
    overlay.horizontalThumb.style.display = 'none';
  }
};

const setScrollbarOpacity = (element: Element, opacity: number): void => {
  if (!(element instanceof HTMLElement)) {
    return;
  }
  element.style.setProperty('--scrollbar-thumb-current-opacity', String(opacity));
  const overlay = overlayElements.get(element);
  if (overlay) {
    overlay.verticalThumb.style.opacity = String(opacity);
    overlay.horizontalThumb.style.opacity = String(opacity);
  }
};

const clearScrollbarOpacity = (element: Element): void => {
  if (!(element instanceof HTMLElement)) {
    return;
  }
  element.style.removeProperty('--scrollbar-thumb-current-opacity');
};

function startOverlayScrollbarDrag(
  event: PointerEvent,
  element: HTMLElement,
  axis: 'horizontal' | 'vertical'
): void {
  event.preventDefault();
  event.currentTarget instanceof HTMLElement &&
    event.currentTarget.setPointerCapture(event.pointerId);
  markScrollbarActive(element);

  const rect = element.getBoundingClientRect();
  const thumbInset = readPxToken('--scrollbar-thumb-inset', 3);
  const trackSize =
    axis === 'vertical' ? rect.height - thumbInset * 2 : rect.width - thumbInset * 2;
  const maxScroll =
    axis === 'vertical'
      ? Math.max(0, element.scrollHeight - element.clientHeight)
      : Math.max(0, element.scrollWidth - element.clientWidth);
  const visibleSize = axis === 'vertical' ? element.clientHeight : element.clientWidth;
  const scrollSize = axis === 'vertical' ? element.scrollHeight : element.scrollWidth;
  const thumbSize = Math.max(
    readPxToken('--scrollbar-min-thumb-size', 32),
    Math.min(trackSize, (visibleSize / scrollSize) * trackSize)
  );

  activeDrag = {
    axis,
    element,
    maxScroll,
    startPointerPosition: axis === 'vertical' ? event.clientY : event.clientX,
    startScrollPosition: axis === 'vertical' ? element.scrollTop : element.scrollLeft,
    trackSize,
    thumbSize,
  };

  event.currentTarget instanceof HTMLElement &&
    event.currentTarget.classList.add('scrollbar-overlay-thumb--dragging');
}

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
  if (isOverlayScrollbarElement(element)) {
    ensureOverlayScrollbars(element);
    activeOverlayElements.add(element);
    updateOverlayScrollbarGeometry(element);
  }
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
      removeOverlayScrollbars(element);
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
        updateOverlayScrollbarGeometry(element);
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

  window.addEventListener(
    'resize',
    () => {
      activeOverlayElements.forEach(updateOverlayScrollbarGeometry);
    },
    { passive: true }
  );

  document.addEventListener(
    'pointermove',
    (event) => {
      if (!activeDrag) {
        return;
      }
      const pointerPosition = activeDrag.axis === 'vertical' ? event.clientY : event.clientX;
      const delta = pointerPosition - activeDrag.startPointerPosition;
      const maxThumbTravel = Math.max(1, activeDrag.trackSize - activeDrag.thumbSize);
      const nextScroll =
        activeDrag.startScrollPosition + (delta / maxThumbTravel) * activeDrag.maxScroll;

      if (activeDrag.axis === 'vertical') {
        activeDrag.element.scrollTop = nextScroll;
      } else {
        activeDrag.element.scrollLeft = nextScroll;
      }
      markScrollbarActive(activeDrag.element);
      updateOverlayScrollbarGeometry(activeDrag.element);
    },
    { passive: true }
  );

  document.addEventListener(
    'pointerup',
    () => {
      document
        .querySelectorAll('.scrollbar-overlay-thumb--dragging')
        .forEach((element) => element.classList.remove('scrollbar-overlay-thumb--dragging'));
      activeDrag = undefined;
    },
    { passive: true }
  );
};
