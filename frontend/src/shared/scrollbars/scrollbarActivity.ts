import {
  readScrollbarActiveTimeoutMs,
  readScrollbarFadeDurationMs,
  readScrollbarNumberToken,
} from './tokens';

const SCROLLBAR_ACTIVE_CLASS = 'scrollbar-active';
const OVERLAY_SCROLLBAR_EXCLUDED_SELECTOR = [
  'html',
  'body',
  '.dropdown-menu',
  '.dockable-tab-bar',
  '.tab-strip',
  '.xterm-scrollable-element',
  '.xterm-viewport',
].join(',');
const OVERLAY_SCROLLBAR_OWNER_SELECTOR = [
  '.fav-dropdown-panel',
  '.tooltip',
  '.command-palette',
  '.modal-container',
  '.debug-overlay-window',
  '.error-notification',
  '.dockable-panel',
  '.object-panel',
].join(',');

interface OverlayScrollbarElements {
  container: HTMLElement;
  horizontalGutter: HTMLDivElement;
  horizontalThumb: HTMLDivElement;
  verticalGutter: HTMLDivElement;
  verticalThumb: HTMLDivElement;
}

interface OverlayHoverState {
  horizontal: boolean;
  vertical: boolean;
}

const activeTimers = new WeakMap<Element, number>();
const overlayElements = new WeakMap<Element, OverlayScrollbarElements>();
const overlayGeometryTransitionsDisabled = new WeakSet<Element>();
const overlayOwnerElements = new WeakMap<Element, HTMLElement>();
const activeOverlayElements = new Set<Element>();
const overlayHoverStates = new Map<Element, OverlayHoverState>();
const opacityAnimations = new WeakMap<
  Element,
  {
    frameId: number;
    targetOpacity: number;
    value: number;
  }
>();
const pendingOverlayGeometryUpdates = new Set<Element>();
let initialized = false;
let overlayResizeObserver: ResizeObserver | undefined;
let overlayGeometryFrameId: number | undefined;
let scrollbarActivityAbortController: AbortController | undefined;
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

const prefersReducedMotion = (): boolean =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const readFadeDurationMs = (direction: 'in' | 'out'): number => {
  if (prefersReducedMotion()) {
    return 0;
  }

  return readScrollbarFadeDurationMs(direction, document.documentElement);
};

const isOverlayScrollbarElement = (element: Element): element is HTMLElement =>
  element instanceof HTMLElement &&
  !element.matches(OVERLAY_SCROLLBAR_EXCLUDED_SELECTOR) &&
  (overlayElements.has(element) || canScroll(element));

const isActivityIgnoredElement = (element: Element): boolean =>
  element instanceof HTMLElement && element.matches('.dropdown-menu');

const resolveOverlayContainer = (element: HTMLElement): HTMLElement => {
  return element.closest<HTMLElement>(OVERLAY_SCROLLBAR_OWNER_SELECTOR) ?? document.body;
};

const hasScrollableOverflow = (overflow: string): boolean =>
  overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay';

const canScrollAxis = (element: HTMLElement, axis: 'horizontal' | 'vertical'): boolean => {
  const styles = getComputedStyle(element);
  const overflow = axis === 'horizontal' ? styles.overflowX : styles.overflowY;
  const scrollableOverflow = hasScrollableOverflow(overflow);

  if (!scrollableOverflow) {
    return false;
  }

  return axis === 'horizontal'
    ? element.scrollWidth > element.clientWidth
    : element.scrollHeight > element.clientHeight;
};

const toOverlayCoordinateRect = (rect: DOMRect, container: HTMLElement): DOMRect => {
  if (container === document.body) {
    return rect;
  }

  const containerRect = container.getBoundingClientRect();
  const left = rect.left - containerRect.left + container.scrollLeft;
  const top = rect.top - containerRect.top + container.scrollTop;
  const width = rect.width;
  const height = rect.height;
  return toClipRect({ top, left, width, height });
};

const applyOverlayClip = (element: HTMLElement, rect: DOMRect, clipRect: DOMRect): void => {
  const top = Math.max(0, clipRect.top - rect.top);
  const right = Math.max(0, rect.right - clipRect.right);
  const bottom = Math.max(0, rect.bottom - clipRect.bottom);
  const left = Math.max(0, clipRect.left - rect.left);
  element.style.clipPath = `inset(${top}px ${right}px ${bottom}px ${left}px)`;
};

const getOverflowClipRect = (element: HTMLElement): DOMRect => {
  const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
  const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
  const elementRect = element.getBoundingClientRect();
  let top = Math.max(elementRect.top, 0);
  let right = Math.min(elementRect.right, viewportWidth);
  let bottom = Math.min(elementRect.bottom, viewportHeight);
  let left = Math.max(elementRect.left, 0);

  for (
    let ancestor = element.parentElement;
    ancestor && ancestor !== document.body && ancestor !== document.documentElement;
    ancestor = ancestor.parentElement
  ) {
    const styles = getComputedStyle(ancestor);
    const clipsX = styles.overflowX !== 'visible';
    const clipsY = styles.overflowY !== 'visible';
    if (!clipsX && !clipsY) {
      continue;
    }
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

  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);
  return toClipRect({ top, left, width, height });
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
    elements.forEach((scrollbarElement) => {
      overlayGeometryTransitionsDisabled.add(scrollbarElement);
      updateOverlayScrollbarGeometry(scrollbarElement);
    });
  });
};

const scheduleDescendantOverlayGeometryUpdates = (scrolledElement: Element): void => {
  activeOverlayElements.forEach((element) => {
    if (element === scrolledElement || !scrolledElement.contains(element)) {
      return;
    }

    scheduleOverlayGeometryUpdate(element);
  });
};

const getOverlayResizeObserver = (): ResizeObserver | undefined => {
  if (typeof ResizeObserver === 'undefined') {
    return undefined;
  }

  overlayResizeObserver ??= new ResizeObserver((entries) => {
    entries.forEach((entry) => {
      scheduleOverlayGeometryUpdate(entry.target);
    });
  });
  return overlayResizeObserver;
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

const createOverlayAxis = (element: HTMLElement, axis: 'horizontal' | 'vertical') => {
  const thumb = document.createElement('div');
  thumb.className = `scrollbar-overlay-thumb scrollbar-overlay-thumb--${axis}`;
  thumb.dataset.scrollbarAxis = axis;
  const gutter = document.createElement('div');
  gutter.className = `scrollbar-overlay-gutter scrollbar-overlay-gutter--${axis}`;
  gutter.dataset.scrollbarAxis = axis;
  thumb.addEventListener('pointerdown', (event) => startOverlayScrollbarDrag(event, element, axis));
  gutter.addEventListener('pointerdown', (event) => pageOverlayScrollbar(event, element, axis));
  return { thumb, gutter };
};

const ensureOverlayScrollbars = (element: Element) => {
  if (!isOverlayScrollbarElement(element)) {
    return undefined;
  }
  const container = resolveOverlayContainer(element);

  const existing = overlayElements.get(element);
  if (existing) {
    if (existing.container !== container) {
      container.append(
        existing.verticalGutter,
        existing.horizontalGutter,
        existing.verticalThumb,
        existing.horizontalThumb
      );
      existing.container = container;
    }
    return existing;
  }

  const { thumb: verticalThumb, gutter: verticalGutter } = createOverlayAxis(element, 'vertical');
  const { thumb: horizontalThumb, gutter: horizontalGutter } = createOverlayAxis(
    element,
    'horizontal'
  );

  container.append(verticalGutter, horizontalGutter, verticalThumb, horizontalThumb);

  const overlay = {
    container,
    horizontalGutter,
    horizontalThumb,
    verticalGutter,
    verticalThumb,
  };
  overlayElements.set(element, overlay);
  overlayOwnerElements.set(verticalGutter, element);
  overlayOwnerElements.set(verticalThumb, element);
  overlayOwnerElements.set(horizontalGutter, element);
  overlayOwnerElements.set(horizontalThumb, element);
  getOverlayResizeObserver()?.observe(element);
  return overlay;
};

const removeOverlayScrollbars = (element: Element): void => {
  const overlay = overlayElements.get(element);
  if (!overlay) {
    activeOverlayElements.delete(element);
    overlayHoverStates.delete(element);
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
  pendingOverlayGeometryUpdates.delete(element);
  overlayGeometryTransitionsDisabled.delete(element);
  overlayElements.delete(element);
  activeOverlayElements.delete(element);
  overlayHoverStates.delete(element);
  if (element instanceof HTMLElement) {
    element.classList.remove(SCROLLBAR_ACTIVE_CLASS);
    clearScrollbarOpacity(element);
  }
};

interface OverlayGeometryContext {
  rect: DOMRect;
  clipRect: DOMRect;
  scrollbarWidth: number;
  scrollbarHeight: number;
  thumbInset: number;
  minThumbSize: number;
  hoverScale: number;
  activeOpacity: number;
  hoverState?: OverlayHoverState;
}

const setOverlayPosition = (
  overlay: OverlayScrollbarElements,
  position: 'absolute' | 'fixed'
): void => {
  overlay.verticalGutter.style.position = position;
  overlay.verticalThumb.style.position = position;
  overlay.horizontalGutter.style.position = position;
  overlay.horizontalThumb.style.position = position;
};

const readOverlayGeometryContext = (
  element: HTMLElement,
  overlay: OverlayScrollbarElements
): OverlayGeometryContext => ({
  rect: toOverlayCoordinateRect(element.getBoundingClientRect(), overlay.container),
  clipRect: toOverlayCoordinateRect(getOverflowClipRect(element), overlay.container),
  scrollbarWidth: readScrollbarNumberToken('--scrollbar-width', 10),
  scrollbarHeight: readScrollbarNumberToken('--scrollbar-height', 10),
  thumbInset: readScrollbarNumberToken('--scrollbar-thumb-inset', 3),
  minThumbSize: readScrollbarNumberToken('--scrollbar-min-thumb-size', 32),
  hoverScale: readScrollbarNumberToken('--scrollbar-hover-scale', 1.75),
  activeOpacity: getCurrentScrollbarOpacity(element),
  hoverState: overlayHoverStates.get(element),
});

const hideVerticalOverlay = (overlay: OverlayScrollbarElements): void => {
  overlay.verticalGutter.style.display = 'none';
  overlay.verticalThumb.style.display = 'none';
};

const hideHorizontalOverlay = (overlay: OverlayScrollbarElements): void => {
  overlay.horizontalGutter.style.display = 'none';
  overlay.horizontalThumb.style.display = 'none';
};

const toClipRect = ({
  top,
  left,
  width,
  height,
}: {
  top: number;
  left: number;
  width: number;
  height: number;
}): DOMRect =>
  ({
    bottom: top + height,
    height,
    left,
    right: left + width,
    top,
    width,
    x: left,
    y: top,
    toJSON: () => undefined,
  }) as DOMRect;

const computeOverlayThumbGeometry = (
  trackSize: number,
  viewportSize: number,
  contentSize: number,
  scrollOffset: number,
  minThumbSize: number
) => {
  const size = Math.max(
    minThumbSize,
    Math.min(trackSize, (viewportSize / contentSize) * trackSize)
  );
  const offset = (scrollOffset / Math.max(1, contentSize - viewportSize)) * (trackSize - size);
  return { size, offset };
};

const updateVerticalOverlayGeometry = (
  element: HTMLElement,
  overlay: OverlayScrollbarElements,
  context: OverlayGeometryContext,
  enabled: boolean
): void => {
  const { rect, clipRect, thumbInset, minThumbSize, hoverScale, activeOpacity, hoverState } =
    context;
  if (!enabled || rect.height <= 0 || clipRect.height <= 0) {
    hideVerticalOverlay(overlay);
    return;
  }

  const trackHeight = rect.height - thumbInset * 2;
  const { size: thumbHeight, offset } = computeOverlayThumbGeometry(
    trackHeight,
    element.clientHeight,
    element.scrollHeight,
    element.scrollTop,
    minThumbSize
  );
  const thumbTop = rect.top + thumbInset + offset;
  const verticalScale = hoverState?.vertical ? hoverScale : 1;
  const gutterWidth = context.scrollbarWidth * verticalScale;
  const gutterInset = thumbInset * verticalScale;
  const thumbWidth = Math.max(1, context.scrollbarWidth - thumbInset * 2) * verticalScale;

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
  applyOverlayClip(overlay.verticalGutter, rect, clipRect);

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
  applyOverlayClip(
    overlay.verticalThumb,
    toClipRect({
      top: thumbTop,
      left: rect.right - gutterWidth,
      width: gutterWidth,
      height: thumbHeight,
    }),
    clipRect
  );
};

const updateHorizontalOverlayGeometry = (
  element: HTMLElement,
  overlay: OverlayScrollbarElements,
  context: OverlayGeometryContext,
  enabled: boolean
): void => {
  const { rect, clipRect, thumbInset, minThumbSize, hoverScale, activeOpacity, hoverState } =
    context;
  if (!enabled || rect.width <= 0 || clipRect.width <= 0) {
    hideHorizontalOverlay(overlay);
    return;
  }

  const trackWidth = rect.width - thumbInset * 2;
  const { size: thumbWidth, offset } = computeOverlayThumbGeometry(
    trackWidth,
    element.clientWidth,
    element.scrollWidth,
    element.scrollLeft,
    minThumbSize
  );
  const thumbLeft = rect.left + thumbInset + offset;
  const horizontalScale = hoverState?.horizontal ? hoverScale : 1;
  const gutterHeight = context.scrollbarHeight * horizontalScale;
  const gutterInset = thumbInset * horizontalScale;
  const thumbHeight = Math.max(1, context.scrollbarHeight - thumbInset * 2) * horizontalScale;

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
  applyOverlayClip(overlay.horizontalGutter, rect, clipRect);

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
  applyOverlayClip(
    overlay.horizontalThumb,
    toClipRect({
      top: rect.bottom - gutterHeight,
      left: thumbLeft,
      width: thumbWidth,
      height: gutterHeight,
    }),
    clipRect
  );
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

  const position = overlay.container === document.body ? 'fixed' : 'absolute';
  setOverlayPosition(overlay, position);

  const hasVerticalScrollbar = canScrollAxis(element, 'vertical');
  const hasHorizontalScrollbar = canScrollAxis(element, 'horizontal');

  if (!hasVerticalScrollbar && !hasHorizontalScrollbar) {
    removeOverlayScrollbars(element);
    return;
  }

  const context = readOverlayGeometryContext(element, overlay);
  updateVerticalOverlayGeometry(element, overlay, context, hasVerticalScrollbar);
  updateHorizontalOverlayGeometry(element, overlay, context, hasHorizontalScrollbar);
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
    markScrollbarActive(element);
  } else {
    overlayGeometryTransitionsDisabled.delete(element);
    overlayHoverStates.delete(element);
    updateOverlayScrollbarGeometry(element);
  }
};

const clearOverlayHoverStates = (exceptElement?: Element): void => {
  overlayHoverStates.forEach((_state, element) => {
    if (element === exceptElement || !(element instanceof HTMLElement)) {
      return;
    }
    overlayGeometryTransitionsDisabled.delete(element);
    overlayHoverStates.delete(element);
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

const resolveOverlayHover = (
  element: HTMLElement,
  clientX: number,
  clientY: number,
  hoverZoneSize: number
): OverlayHoverState | null => {
  const rect = element.getBoundingClientRect();
  const isInside =
    clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
  if (!isInside) {
    return null;
  }
  const hasVerticalScrollbar = canScrollAxis(element, 'vertical');
  const hasHorizontalScrollbar = canScrollAxis(element, 'horizontal');
  let vertical =
    hasVerticalScrollbar && clientX >= rect.right - hoverZoneSize && clientX <= rect.right;
  const horizontal =
    hasHorizontalScrollbar && clientY >= rect.bottom - hoverZoneSize && clientY <= rect.bottom;
  if (vertical && horizontal) {
    const distanceToRight = rect.right - clientX;
    const distanceToBottom = rect.bottom - clientY;
    vertical = distanceToRight <= distanceToBottom;
  }
  return { horizontal: horizontal && !vertical, vertical };
};

const updateOverlayHoverAtPoint = (clientX: number, clientY: number): void => {
  if (activeDrag) {
    return;
  }
  const hoverZoneSize = readScrollbarNumberToken('--scrollbar-hover-zone-size', 16);
  for (const element of collectOverlayHoverCandidates(clientX, clientY)) {
    const hover = resolveOverlayHover(element, clientX, clientY, hoverZoneSize);
    if (hover && (hover.vertical || hover.horizontal)) {
      setOverlayHoverState(element, hover);
      clearOverlayHoverStates(element);
      return;
    }
  }
  clearOverlayHoverStates();
};

const updateOverlayHoverFromPointer = (event: PointerEvent): void => {
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
  const thumbInset = readScrollbarNumberToken('--scrollbar-thumb-inset', 3);
  const vertical = axis === 'vertical';
  const viewportSize = vertical ? element.clientHeight : element.clientWidth;
  const trackSize = Math.max(1, (vertical ? rect.height : rect.width) - thumbInset * 2);
  const { offset } = computeOverlayThumbGeometry(
    trackSize,
    viewportSize,
    vertical ? element.scrollHeight : element.scrollWidth,
    vertical ? element.scrollTop : element.scrollLeft,
    readScrollbarNumberToken('--scrollbar-min-thumb-size', 32)
  );
  const thumbStart = (vertical ? rect.top : rect.left) + thumbInset + offset;
  const pointerPosition = vertical ? event.clientY : event.clientX;
  const delta = (pointerPosition < thumbStart ? -1 : 1) * viewportSize;
  scrollByPixels(element, vertical ? 0 : delta, vertical ? delta : 0);

  updateOverlayScrollbarGeometry(element);
}

function startOverlayScrollbarDrag(
  event: PointerEvent,
  element: HTMLElement,
  axis: 'horizontal' | 'vertical'
): void {
  event.preventDefault();
  if (event.currentTarget instanceof HTMLElement) {
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  markScrollbarActive(element);

  const rect = getOverflowClipRect(element);
  const thumbInset = readScrollbarNumberToken('--scrollbar-thumb-inset', 3);
  const trackSize =
    axis === 'vertical' ? rect.height - thumbInset * 2 : rect.width - thumbInset * 2;
  const maxScroll =
    axis === 'vertical'
      ? Math.max(0, element.scrollHeight - element.clientHeight)
      : Math.max(0, element.scrollWidth - element.clientWidth);
  const visibleSize = axis === 'vertical' ? element.clientHeight : element.clientWidth;
  const scrollSize = axis === 'vertical' ? element.scrollHeight : element.scrollWidth;
  const { size: thumbSize } = computeOverlayThumbGeometry(
    trackSize,
    visibleSize,
    scrollSize,
    0,
    readScrollbarNumberToken('--scrollbar-min-thumb-size', 32)
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

  if (event.currentTarget instanceof HTMLElement) {
    event.currentTarget.classList.add('scrollbar-overlay-thumb--dragging');
  }
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

  return readScrollbarNumberToken('--scrollbar-thumb-idle-opacity', 0);
};

const animateScrollbarOpacity = (
  element: Element,
  targetOpacity: number,
  onComplete?: () => void
): void => {
  const existingAnimation = opacityAnimations.get(element);
  if (existingAnimation?.targetOpacity === targetOpacity) {
    return;
  }

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
    const easedProgress = 1 - (1 - progress) ** 3;
    const value = startOpacity + (targetOpacity - startOpacity) * easedProgress;
    setScrollbarOpacity(element, value);

    if (progress >= 1) {
      opacityAnimations.delete(element);
      onComplete?.();
      return;
    }

    const frameId = window.requestAnimationFrame(step);
    opacityAnimations.set(element, { frameId, targetOpacity, value });
  };

  const frameId = window.requestAnimationFrame(step);
  opacityAnimations.set(element, { frameId, targetOpacity, value: startOpacity });
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
  if (target instanceof Node) {
    return target.parentElement;
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
  const scrollsX = hasScrollableOverflow(overflowX) && element.scrollWidth > element.clientWidth;
  const scrollsY = hasScrollableOverflow(overflowY) && element.scrollHeight > element.clientHeight;
  return scrollsX || scrollsY;
};

const canScrollWithDelta = (element: Element, deltaX: number, deltaY: number): boolean => {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  const styles = getComputedStyle(element);
  const scrollsX =
    hasScrollableOverflow(styles.overflowX) && element.scrollWidth > element.clientWidth;
  const scrollsY =
    hasScrollableOverflow(styles.overflowY) && element.scrollHeight > element.clientHeight;

  const canMoveX =
    scrollsX &&
    ((deltaX < 0 && element.scrollLeft > 0) ||
      (deltaX > 0 && element.scrollLeft + element.clientWidth < element.scrollWidth - 1));
  const canMoveY =
    scrollsY &&
    ((deltaY < 0 && element.scrollTop > 0) ||
      (deltaY > 0 && element.scrollTop + element.clientHeight < element.scrollHeight - 1));

  return canMoveX || canMoveY;
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

    const idleOpacity = readScrollbarNumberToken('--scrollbar-thumb-idle-opacity', 0);
    animateScrollbarOpacity(element, idleOpacity, () => {
      if (isScrollbarHeldOpen(element)) {
        return;
      }

      element.classList.remove(SCROLLBAR_ACTIVE_CLASS);
      clearScrollbarOpacity(element);
      activeTimers.delete(element);
      removeOverlayScrollbars(element);
    });
  }, readScrollbarActiveTimeoutMs());
  activeTimers.set(element, timer);
};

const markScrollbarActive = (element: Element): void => {
  if (isActivityIgnoredElement(element)) {
    return;
  }

  const activeOpacity = readScrollbarNumberToken('--scrollbar-thumb-active-opacity', 1);
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

  scheduleScrollbarInactive(element);
};

export const initializeScrollbarActivityTracking = (): void => {
  if (initialized || typeof document === 'undefined') {
    return;
  }
  initialized = true;
  scrollbarActivityAbortController = new AbortController();
  const signal = scrollbarActivityAbortController.signal;

  document.addEventListener(
    'scroll',
    (event) => {
      const element = resolveScrollElement(event.target);
      if (element) {
        scheduleDescendantOverlayGeometryUpdates(element);
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
      document.querySelectorAll('.scrollbar-overlay-thumb--dragging').forEach((element) => {
        element.classList.remove('scrollbar-overlay-thumb--dragging');
      });
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

  if (overlayGeometryFrameId !== undefined) {
    window.cancelAnimationFrame(overlayGeometryFrameId);
    overlayGeometryFrameId = undefined;
  }

  const elements = new Set<Element>([...activeOverlayElements, ...overlayHoverStates.keys()]);
  elements.forEach(removeOverlayScrollbars);
  activeOverlayElements.clear();
  overlayHoverStates.clear();
  pendingOverlayGeometryUpdates.clear();
  overlayResizeObserver?.disconnect();
  overlayResizeObserver = undefined;
};
