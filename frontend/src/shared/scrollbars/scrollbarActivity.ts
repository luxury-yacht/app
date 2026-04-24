const SCROLLBAR_ACTIVE_CLASS = 'scrollbar-active';
const OVERLAY_SCROLLBAR_EXCLUDED_SELECTOR = [
  'html',
  'body',
  '.dockable-tab-bar',
  '.tab-strip',
  '.xterm-scrollable-element',
  '.xterm-viewport',
].join(',');
const DEFAULT_ACTIVE_TIMEOUT_MS = 900;
const DEFAULT_FADE_DURATION_MS = 180;

const activeTimers = new WeakMap<Element, number>();
const overlayElements = new WeakMap<
  Element,
  {
    horizontalGutter: HTMLDivElement;
    horizontalThumb: HTMLDivElement;
    verticalGutter: HTMLDivElement;
    verticalThumb: HTMLDivElement;
  }
>();
const overlayGeometryTransitionsDisabled = new WeakSet<Element>();
const overlayOwnerElements = new WeakMap<Element, HTMLElement>();
const activeOverlayElements = new Set<Element>();
const overlayHoverStates = new WeakMap<
  Element,
  {
    horizontal: boolean;
    vertical: boolean;
  }
>();
const hoveredOverlayElements = new Set<Element>();
const opacityAnimations = new WeakMap<
  Element,
  {
    frameId: number;
    value: number;
  }
>();
const resizeObservedOverlayElements = new WeakSet<Element>();
const pendingOverlayGeometryUpdates = new Set<Element>();
let initialized = false;
let overlayResizeObserver: ResizeObserver | undefined;
let overlayMutationObserver: MutationObserver | undefined;
let overlayGeometryFrameId: number | undefined;
let activeOverlayGeometryFrameId: number | undefined;
let hoverRefreshFrameId: number | undefined;
let scrollbarActivityAbortController: AbortController | undefined;
let lastPointerPosition: { clientX: number; clientY: number } | undefined;
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

const prefersReducedMotion = (): boolean =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const readFadeDurationMs = (direction: 'in' | 'out'): number => {
  if (prefersReducedMotion()) {
    return 0;
  }

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

const readNumberToken = (tokenName: string, fallback: number): number => {
  const styles = getComputedStyle(document.documentElement);
  const parsed = Number.parseFloat(styles.getPropertyValue(tokenName));
  return Number.isFinite(parsed) ? parsed : fallback;
};

const isOverlayScrollbarElement = (element: Element): element is HTMLElement =>
  element instanceof HTMLElement &&
  !element.matches(OVERLAY_SCROLLBAR_EXCLUDED_SELECTOR) &&
  (overlayElements.has(element) || canScroll(element));

const getOverflowClipRect = (element: HTMLElement): DOMRect => {
  const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
  const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
  const elementRect = element.getBoundingClientRect();
  let top = Math.max(elementRect.top, 0);
  let right = Math.min(elementRect.right, viewportWidth);
  let bottom = Math.min(elementRect.bottom, viewportHeight);
  let left = Math.max(elementRect.left, 0);

  let ancestor = element.parentElement;
  while (ancestor && ancestor !== document.body && ancestor !== document.documentElement) {
    const styles = getComputedStyle(ancestor);
    const clipsX = styles.overflowX !== 'visible';
    const clipsY = styles.overflowY !== 'visible';
    if (clipsX || clipsY) {
      const ancestorRect = ancestor.getBoundingClientRect();
      if (clipsX) {
        left = Math.max(left, ancestorRect.left);
        right = Math.min(right, ancestorRect.right);
      }
      if (clipsY) {
        top = Math.max(top, ancestorRect.top);
        bottom = Math.min(bottom, ancestorRect.bottom);
      }
    }
    ancestor = ancestor.parentElement;
  }

  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);
  return {
    bottom: top + height,
    height,
    left,
    right: left + width,
    top,
    width,
    x: left,
    y: top,
    toJSON: () => undefined,
  } as DOMRect;
};

const scheduleOverlayGeometryUpdate = (element: Element): void => {
  if (!isOverlayScrollbarElement(element)) {
    return;
  }

  pendingOverlayGeometryUpdates.add(element);
  if (overlayGeometryFrameId !== undefined) {
    return;
  }

  overlayGeometryFrameId = window.requestAnimationFrame(() => {
    overlayGeometryFrameId = undefined;
    const elements = Array.from(pendingOverlayGeometryUpdates);
    pendingOverlayGeometryUpdates.clear();
    elements.forEach((element) => {
      overlayGeometryTransitionsDisabled.add(element);
      updateOverlayScrollbarGeometry(element);
    });
  });
};

const startActiveOverlayGeometryTracking = (): void => {
  if (activeOverlayGeometryFrameId !== undefined) {
    return;
  }

  activeOverlayGeometryFrameId = window.requestAnimationFrame(() => {
    activeOverlayGeometryFrameId = undefined;
    activeOverlayElements.forEach((element) => {
      overlayGeometryTransitionsDisabled.add(element);
      updateOverlayScrollbarGeometry(element);
    });
    if (activeOverlayElements.size > 0) {
      startActiveOverlayGeometryTracking();
    }
  });
};

const scheduleOverlayHoverRefresh = (): void => {
  if (!lastPointerPosition || hoverRefreshFrameId !== undefined) {
    return;
  }

  hoverRefreshFrameId = window.requestAnimationFrame(() => {
    hoverRefreshFrameId = undefined;
    if (lastPointerPosition) {
      updateOverlayHoverAtPoint(lastPointerPosition.clientX, lastPointerPosition.clientY);
    }
  });
};

const getOverlayResizeObserver = (): ResizeObserver | undefined => {
  if (typeof ResizeObserver === 'undefined') {
    return undefined;
  }

  overlayResizeObserver ??= new ResizeObserver((entries) => {
    entries.forEach((entry) => scheduleOverlayGeometryUpdate(entry.target));
  });
  return overlayResizeObserver;
};

const observeOverlayElementResize = (element: Element): void => {
  if (resizeObservedOverlayElements.has(element)) {
    return;
  }

  const observer = getOverlayResizeObserver();
  if (!observer) {
    return;
  }

  observer.observe(element);
  resizeObservedOverlayElements.add(element);
};

const setOverlayGeometryTransitions = (element: Element, disabled: boolean): void => {
  const overlay = overlayElements.get(element);
  if (!overlay) {
    return;
  }

  for (const overlayElement of [
    overlay.verticalGutter,
    overlay.verticalThumb,
    overlay.horizontalGutter,
    overlay.horizontalThumb,
  ]) {
    overlayElement.classList.toggle('scrollbar-overlay--geometry-updating', disabled);
  }
};

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

  const verticalGutter = document.createElement('div');
  verticalGutter.className = 'scrollbar-overlay-gutter scrollbar-overlay-gutter--vertical';
  verticalGutter.dataset.scrollbarAxis = 'vertical';

  const horizontalThumb = document.createElement('div');
  horizontalThumb.className = 'scrollbar-overlay-thumb scrollbar-overlay-thumb--horizontal';
  horizontalThumb.dataset.scrollbarAxis = 'horizontal';

  const horizontalGutter = document.createElement('div');
  horizontalGutter.className = 'scrollbar-overlay-gutter scrollbar-overlay-gutter--horizontal';
  horizontalGutter.dataset.scrollbarAxis = 'horizontal';

  verticalThumb.addEventListener('pointerdown', (event) =>
    startOverlayScrollbarDrag(event, element, 'vertical')
  );
  horizontalThumb.addEventListener('pointerdown', (event) =>
    startOverlayScrollbarDrag(event, element, 'horizontal')
  );
  verticalGutter.addEventListener('pointerdown', (event) =>
    pageOverlayScrollbar(event, element, 'vertical')
  );
  horizontalGutter.addEventListener('pointerdown', (event) =>
    pageOverlayScrollbar(event, element, 'horizontal')
  );

  document.body.append(verticalGutter, horizontalGutter, verticalThumb, horizontalThumb);

  const overlay = { horizontalGutter, horizontalThumb, verticalGutter, verticalThumb };
  overlayElements.set(element, overlay);
  overlayOwnerElements.set(verticalGutter, element);
  overlayOwnerElements.set(verticalThumb, element);
  overlayOwnerElements.set(horizontalGutter, element);
  overlayOwnerElements.set(horizontalThumb, element);
  observeOverlayElementResize(element);
  return overlay;
};

const removeOverlayScrollbars = (element: Element): void => {
  const overlay = overlayElements.get(element);
  if (!overlay) {
    activeOverlayElements.delete(element);
    overlayHoverStates.delete(element);
    hoveredOverlayElements.delete(element);
    pendingOverlayGeometryUpdates.delete(element);
    overlayGeometryTransitionsDisabled.delete(element);
    return;
  }

  const activeTimer = activeTimers.get(element);
  if (activeTimer !== undefined) {
    window.clearTimeout(activeTimer);
    activeTimers.delete(element);
  }

  const opacityAnimation = opacityAnimations.get(element);
  if (opacityAnimation) {
    window.cancelAnimationFrame(opacityAnimation.frameId);
    opacityAnimations.delete(element);
  }

  overlay.verticalGutter.remove();
  overlay.verticalThumb.remove();
  overlay.horizontalGutter.remove();
  overlay.horizontalThumb.remove();
  overlayOwnerElements.delete(overlay.verticalGutter);
  overlayOwnerElements.delete(overlay.verticalThumb);
  overlayOwnerElements.delete(overlay.horizontalGutter);
  overlayOwnerElements.delete(overlay.horizontalThumb);
  overlayResizeObserver?.unobserve(element);
  resizeObservedOverlayElements.delete(element);
  pendingOverlayGeometryUpdates.delete(element);
  overlayGeometryTransitionsDisabled.delete(element);
  overlayElements.delete(element);
  activeOverlayElements.delete(element);
  overlayHoverStates.delete(element);
  hoveredOverlayElements.delete(element);
  if (element instanceof HTMLElement) {
    element.classList.remove(SCROLLBAR_ACTIVE_CLASS);
    clearScrollbarOpacity(element);
  }
};

const updateOverlayScrollbarGeometry = (element: Element): void => {
  if (!isOverlayScrollbarElement(element)) {
    return;
  }

  if (!element.isConnected) {
    removeOverlayScrollbars(element);
    return;
  }

  const overlay = ensureOverlayScrollbars(element);
  if (!overlay) {
    return;
  }
  const shouldDisableGeometryTransitions = overlayGeometryTransitionsDisabled.has(element);
  setOverlayGeometryTransitions(element, shouldDisableGeometryTransitions);

  const rect = getOverflowClipRect(element);
  const scrollbarWidth = readPxToken('--scrollbar-width', 10);
  const scrollbarHeight = readPxToken('--scrollbar-height', 10);
  const thumbInset = readPxToken('--scrollbar-thumb-inset', 3);
  const minThumbSize = readPxToken('--scrollbar-min-thumb-size', 32);
  const hoverScale = readNumberToken('--scrollbar-hover-scale', 1.75);
  const activeOpacity = getCurrentScrollbarOpacity(element);
  const hoverState = overlayHoverStates.get(element);

  const hasVerticalScrollbar = element.scrollHeight > element.clientHeight;
  const hasHorizontalScrollbar = element.scrollWidth > element.clientWidth;

  if (!hasVerticalScrollbar && !hasHorizontalScrollbar) {
    removeOverlayScrollbars(element);
    return;
  }

  if (hasVerticalScrollbar && rect.height > 0) {
    const trackHeight = rect.height - thumbInset * 2;
    const thumbHeight = Math.max(
      minThumbSize,
      Math.min(trackHeight, (element.clientHeight / element.scrollHeight) * trackHeight)
    );
    const maxScrollTop = Math.max(1, element.scrollHeight - element.clientHeight);
    const thumbTop =
      rect.top + thumbInset + (element.scrollTop / maxScrollTop) * (trackHeight - thumbHeight);
    const baseThumbWidth = Math.max(1, scrollbarWidth - thumbInset * 2);
    const verticalScale = hoverState?.vertical ? hoverScale : 1;
    const thumbWidth = baseThumbWidth * verticalScale;
    const gutterWidth = scrollbarWidth * verticalScale;
    const gutterInset = thumbInset * verticalScale;

    overlay.verticalGutter.style.display = 'block';
    overlay.verticalGutter.classList.toggle(
      'scrollbar-overlay-gutter--visible',
      Boolean(hoverState?.vertical)
    );
    overlay.verticalGutter.style.left = `${rect.right - gutterWidth}px`;
    overlay.verticalGutter.style.top = `${rect.top}px`;
    overlay.verticalGutter.style.width = `${gutterWidth}px`;
    overlay.verticalGutter.style.height = `${rect.height}px`;
    overlay.verticalGutter.style.transform = '';

    overlay.verticalThumb.style.display = 'block';
    overlay.verticalThumb.classList.toggle(
      'scrollbar-overlay-thumb--hovered',
      Boolean(hoverState?.vertical)
    );
    overlay.verticalThumb.style.left = `${rect.right - gutterInset - thumbWidth}px`;
    overlay.verticalThumb.style.top = `${thumbTop}px`;
    overlay.verticalThumb.style.width = `${thumbWidth}px`;
    overlay.verticalThumb.style.height = `${thumbHeight}px`;
    overlay.verticalThumb.style.opacity = String(activeOpacity);
    overlay.verticalThumb.style.transform = '';
  } else {
    overlay.verticalGutter.style.display = 'none';
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
    const baseThumbHeight = Math.max(1, scrollbarHeight - thumbInset * 2);
    const horizontalScale = hoverState?.horizontal ? hoverScale : 1;
    const thumbHeight = baseThumbHeight * horizontalScale;
    const gutterHeight = scrollbarHeight * horizontalScale;
    const gutterInset = thumbInset * horizontalScale;

    overlay.horizontalGutter.style.display = 'block';
    overlay.horizontalGutter.classList.toggle(
      'scrollbar-overlay-gutter--visible',
      Boolean(hoverState?.horizontal)
    );
    overlay.horizontalGutter.style.left = `${rect.left}px`;
    overlay.horizontalGutter.style.top = `${rect.bottom - gutterHeight}px`;
    overlay.horizontalGutter.style.width = `${rect.width}px`;
    overlay.horizontalGutter.style.height = `${gutterHeight}px`;
    overlay.horizontalGutter.style.transform = '';

    overlay.horizontalThumb.style.display = 'block';
    overlay.horizontalThumb.classList.toggle(
      'scrollbar-overlay-thumb--hovered',
      Boolean(hoverState?.horizontal)
    );
    overlay.horizontalThumb.style.left = `${thumbLeft}px`;
    overlay.horizontalThumb.style.top = `${rect.bottom - gutterInset - thumbHeight}px`;
    overlay.horizontalThumb.style.width = `${thumbWidth}px`;
    overlay.horizontalThumb.style.height = `${thumbHeight}px`;
    overlay.horizontalThumb.style.opacity = String(activeOpacity);
    overlay.horizontalThumb.style.transform = '';
  } else {
    overlay.horizontalGutter.style.display = 'none';
    overlay.horizontalThumb.style.display = 'none';
  }
};

const setOverlayHoverState = (
  element: HTMLElement,
  hoverState: { horizontal: boolean; vertical: boolean }
): void => {
  const hasHover = hoverState.horizontal || hoverState.vertical;
  const previousState = overlayHoverStates.get(element);
  if (
    previousState?.horizontal === hoverState.horizontal &&
    previousState.vertical === hoverState.vertical
  ) {
    if (hasHover) {
      markScrollbarActive(element);
    }
    return;
  }

  if (hasHover) {
    overlayGeometryTransitionsDisabled.delete(element);
    overlayHoverStates.set(element, hoverState);
    hoveredOverlayElements.add(element);
    markScrollbarActive(element);
  } else {
    overlayGeometryTransitionsDisabled.delete(element);
    overlayHoverStates.delete(element);
    hoveredOverlayElements.delete(element);
    updateOverlayScrollbarGeometry(element);
  }
};

const clearOverlayHoverStates = (exceptElement?: Element): void => {
  hoveredOverlayElements.forEach((element) => {
    if (element === exceptElement || !(element instanceof HTMLElement)) {
      return;
    }
    overlayGeometryTransitionsDisabled.delete(element);
    overlayHoverStates.delete(element);
    hoveredOverlayElements.delete(element);
    updateOverlayScrollbarGeometry(element);
  });
};

const collectOverlayHoverCandidates = (clientX: number, clientY: number): HTMLElement[] => {
  const candidates: HTMLElement[] = [];
  const seen = new Set<Element>();

  for (const elementAtPoint of document.elementsFromPoint(clientX, clientY)) {
    const overlayOwner = overlayOwnerElements.get(elementAtPoint);
    if (overlayOwner && !seen.has(overlayOwner)) {
      seen.add(overlayOwner);
      candidates.push(overlayOwner);
      continue;
    }

    let element: Element | null = elementAtPoint;
    while (element) {
      if (isOverlayScrollbarElement(element) && !seen.has(element)) {
        seen.add(element);
        candidates.push(element);
        break;
      }
      element = element.parentElement;
    }
  }

  activeOverlayElements.forEach((element) => {
    if (element instanceof HTMLElement && !seen.has(element)) {
      seen.add(element);
      candidates.push(element);
    }
  });

  return candidates;
};

const updateOverlayHoverAtPoint = (clientX: number, clientY: number): void => {
  if (activeDrag) {
    return;
  }

  const hoverZoneSize = readPxToken('--scrollbar-hover-zone-size', 16);
  for (const element of collectOverlayHoverCandidates(clientX, clientY)) {
    const rect = element.getBoundingClientRect();
    const isInside =
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom;
    if (!isInside) {
      continue;
    }

    const hasVerticalScrollbar = element.scrollHeight > element.clientHeight;
    const hasHorizontalScrollbar = element.scrollWidth > element.clientWidth;
    let vertical =
      hasVerticalScrollbar && clientX >= rect.right - hoverZoneSize && clientX <= rect.right;
    const horizontal =
      hasHorizontalScrollbar && clientY >= rect.bottom - hoverZoneSize && clientY <= rect.bottom;

    if (vertical && horizontal) {
      const distanceToRight = rect.right - clientX;
      const distanceToBottom = rect.bottom - clientY;
      vertical = distanceToRight <= distanceToBottom;
    }

    if (vertical || horizontal) {
      setOverlayHoverState(element, { horizontal: horizontal && !vertical, vertical });
      clearOverlayHoverStates(element);
      return;
    }
  }

  clearOverlayHoverStates();
};

const updateOverlayHoverFromPointer = (event: PointerEvent): void => {
  lastPointerPosition = { clientX: event.clientX, clientY: event.clientY };
  updateOverlayHoverAtPoint(event.clientX, event.clientY);
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

const scrollByPixels = (element: HTMLElement, deltaX: number, deltaY: number): void => {
  element.scrollLeft += deltaX;
  element.scrollTop += deltaY;
};

const getWheelDeltaPixels = (event: WheelEvent, element: HTMLElement) => {
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    return {
      x: event.deltaX * element.clientWidth,
      y: event.deltaY * element.clientHeight,
    };
  }

  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight);
    const linePixels = Number.isFinite(lineHeight) ? lineHeight : 16;
    return {
      x: event.deltaX * linePixels,
      y: event.deltaY * linePixels,
    };
  }

  return { x: event.deltaX, y: event.deltaY };
};

function pageOverlayScrollbar(
  event: PointerEvent,
  element: HTMLElement,
  axis: 'horizontal' | 'vertical'
): void {
  event.preventDefault();
  markScrollbarActive(element);

  const rect = getOverflowClipRect(element);
  const thumbInset = readPxToken('--scrollbar-thumb-inset', 3);
  if (axis === 'vertical') {
    const trackHeight = Math.max(1, rect.height - thumbInset * 2);
    const thumbHeight = Math.max(
      readPxToken('--scrollbar-min-thumb-size', 32),
      Math.min(trackHeight, (element.clientHeight / element.scrollHeight) * trackHeight)
    );
    const maxScrollTop = Math.max(1, element.scrollHeight - element.clientHeight);
    const thumbTop =
      rect.top + thumbInset + (element.scrollTop / maxScrollTop) * (trackHeight - thumbHeight);
    const direction = event.clientY < thumbTop ? -1 : 1;
    scrollByPixels(element, 0, direction * element.clientHeight);
  } else {
    const trackWidth = Math.max(1, rect.width - thumbInset * 2);
    const thumbWidth = Math.max(
      readPxToken('--scrollbar-min-thumb-size', 32),
      Math.min(trackWidth, (element.clientWidth / element.scrollWidth) * trackWidth)
    );
    const maxScrollLeft = Math.max(1, element.scrollWidth - element.clientWidth);
    const thumbLeft =
      rect.left + thumbInset + (element.scrollLeft / maxScrollLeft) * (trackWidth - thumbWidth);
    const direction = event.clientX < thumbLeft ? -1 : 1;
    scrollByPixels(element, direction * element.clientWidth, 0);
  }

  updateOverlayScrollbarGeometry(element);
}

function startOverlayScrollbarDrag(
  event: PointerEvent,
  element: HTMLElement,
  axis: 'horizontal' | 'vertical'
): void {
  event.preventDefault();
  event.currentTarget instanceof HTMLElement &&
    event.currentTarget.setPointerCapture(event.pointerId);
  markScrollbarActive(element);

  const rect = getOverflowClipRect(element);
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
    const overlayOwner = overlayOwnerElements.get(target);
    if (overlayOwner) {
      return overlayOwner;
    }
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

const isScrollbarHeldOpen = (element: Element): boolean =>
  overlayHoverStates.has(element) || activeDrag?.element === element;

const scheduleScrollbarInactive = (element: Element): void => {
  const existingTimer = activeTimers.get(element);
  if (existingTimer !== undefined) {
    window.clearTimeout(existingTimer);
  }

  const timer = window.setTimeout(() => {
    if (isScrollbarHeldOpen(element)) {
      scheduleScrollbarInactive(element);
      return;
    }

    const idleOpacity = readOpacityToken('--scrollbar-thumb-idle-opacity', 0);
    animateScrollbarOpacity(element, idleOpacity, () => {
      if (isScrollbarHeldOpen(element)) {
        return;
      }

      element.classList.remove(SCROLLBAR_ACTIVE_CLASS);
      clearScrollbarOpacity(element);
      activeTimers.delete(element);
      removeOverlayScrollbars(element);
    });
  }, readActiveTimeoutMs());
  activeTimers.set(element, timer);
};

const markScrollbarActive = (element: Element): void => {
  const activeOpacity = readOpacityToken('--scrollbar-thumb-active-opacity', 1);
  if (isOverlayScrollbarElement(element)) {
    ensureOverlayScrollbars(element);
    activeOverlayElements.add(element);
    updateOverlayScrollbarGeometry(element);
    startActiveOverlayGeometryTracking();
  }
  setScrollbarOpacity(element, getCurrentScrollbarOpacity(element));
  element.classList.add(SCROLLBAR_ACTIVE_CLASS);
  animateScrollbarOpacity(element, activeOpacity);

  const terminalElement = element.closest('.shell-tab__terminal');
  if (terminalElement && terminalElement !== element) {
    markScrollbarActive(terminalElement);
  }

  scheduleScrollbarInactive(element);
};

export const initializeScrollbarActivityTracking = (): void => {
  if (initialized || typeof document === 'undefined') {
    return;
  }
  initialized = true;
  scrollbarActivityAbortController = new AbortController();
  const signal = scrollbarActivityAbortController.signal;
  if (typeof MutationObserver !== 'undefined') {
    overlayMutationObserver = new MutationObserver(scheduleOverlayHoverRefresh);
    overlayMutationObserver.observe(document.body, {
      attributes: true,
      childList: true,
      subtree: true,
    });
  }

  document.addEventListener(
    'scroll',
    (event) => {
      const element = resolveScrollElement(event.target);
      if (element) {
        overlayGeometryTransitionsDisabled.add(element);
        updateOverlayScrollbarGeometry(element);
        markScrollbarActive(element);
      }
    },
    { capture: true, passive: true, signal }
  );

  document.addEventListener(
    'wheel',
    (event) => {
      const overlayOwner =
        event.target instanceof Element ? overlayOwnerElements.get(event.target) : undefined;
      if (overlayOwner) {
        const delta = getWheelDeltaPixels(event, overlayOwner);
        scrollByPixels(overlayOwner, delta.x, delta.y);
        overlayGeometryTransitionsDisabled.add(overlayOwner);
        markScrollbarActive(overlayOwner);
        updateOverlayScrollbarGeometry(overlayOwner);
        event.preventDefault();
        return;
      }

      const element = findWheelScrollTarget(event.target, event);
      if (element) {
        markScrollbarActive(element);
      }
    },
    { capture: true, passive: false, signal }
  );

  document.addEventListener(
    'touchmove',
    (event) => {
      const element = findScrollableAncestor(event.target);
      if (element) {
        markScrollbarActive(element);
      }
    },
    { capture: true, passive: true, signal }
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
    { capture: true, passive: true, signal }
  );

  window.addEventListener(
    'resize',
    () => {
      activeOverlayElements.forEach((element) => {
        overlayGeometryTransitionsDisabled.add(element);
        updateOverlayScrollbarGeometry(element);
      });
    },
    { passive: true, signal }
  );

  document.addEventListener(
    'pointermove',
    (event) => {
      if (!activeDrag) {
        updateOverlayHoverFromPointer(event);
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
      overlayGeometryTransitionsDisabled.add(activeDrag.element);
      markScrollbarActive(activeDrag.element);
      updateOverlayScrollbarGeometry(activeDrag.element);
    },
    { passive: true, signal }
  );

  document.addEventListener(
    'pointerup',
    (event) => {
      const draggedElement = activeDrag?.element;
      document
        .querySelectorAll('.scrollbar-overlay-thumb--dragging')
        .forEach((element) => element.classList.remove('scrollbar-overlay-thumb--dragging'));
      activeDrag = undefined;
      if (draggedElement) {
        updateOverlayHoverFromPointer(event);
        markScrollbarActive(draggedElement);
      }
    },
    { passive: true, signal }
  );

  document.addEventListener(
    'pointerleave',
    () => {
      lastPointerPosition = undefined;
      clearOverlayHoverStates();
    },
    {
      passive: true,
      signal,
    }
  );
  window.addEventListener(
    'blur',
    () => {
      lastPointerPosition = undefined;
      clearOverlayHoverStates();
    },
    { passive: true, signal }
  );
};

export const __resetScrollbarActivityTrackingForTest = (): void => {
  scrollbarActivityAbortController?.abort();
  scrollbarActivityAbortController = undefined;
  initialized = false;
  activeDrag = undefined;
  lastPointerPosition = undefined;

  if (overlayGeometryFrameId !== undefined) {
    window.cancelAnimationFrame(overlayGeometryFrameId);
    overlayGeometryFrameId = undefined;
  }
  if (activeOverlayGeometryFrameId !== undefined) {
    window.cancelAnimationFrame(activeOverlayGeometryFrameId);
    activeOverlayGeometryFrameId = undefined;
  }
  if (hoverRefreshFrameId !== undefined) {
    window.cancelAnimationFrame(hoverRefreshFrameId);
    hoverRefreshFrameId = undefined;
  }

  const elements = new Set<Element>([...activeOverlayElements, ...hoveredOverlayElements]);
  elements.forEach(removeOverlayScrollbars);
  activeOverlayElements.clear();
  hoveredOverlayElements.clear();
  pendingOverlayGeometryUpdates.clear();
  overlayResizeObserver?.disconnect();
  overlayResizeObserver = undefined;
  overlayMutationObserver?.disconnect();
  overlayMutationObserver = undefined;
};
