import {
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type WheelEvent,
} from 'react';

import { readScrollbarActiveTimeoutMs, readScrollbarPxToken } from './tokens';

type ScrollbarAxis = 'horizontal' | 'vertical';

export interface VirtualScrollbarMetrics {
  contentSize: number;
  scrollOffset: number;
  viewportSize: number;
}

export interface VirtualScrollbarOptions {
  axis: ScrollbarAxis;
  getHostElement: () => HTMLElement | null;
  getMetrics: () => VirtualScrollbarMetrics | null;
  scrollByWheel?: (event: WheelEvent<HTMLElement>) => void;
  scrollBy: (delta: number) => void;
  scrollTo: (offset: number) => void;
}

interface VirtualScrollbarState {
  active: boolean;
  canScroll: boolean;
  dragging: boolean;
  hovered: boolean;
  thumbOffset: number;
  thumbSize: number;
}

interface VirtualScrollbarDragState {
  maxScrollOffset: number;
  startPointerPosition: number;
  startScrollOffset: number;
  thumbSize: number;
  trackSize: number;
}

const INITIAL_STATE: VirtualScrollbarState = {
  active: false,
  canScroll: false,
  dragging: false,
  hovered: false,
  thumbOffset: 0,
  thumbSize: 0,
};

const getTrackSize = (axis: ScrollbarAxis, host: HTMLElement): number =>
  axis === 'vertical'
    ? host.clientHeight || host.getBoundingClientRect().height || 0
    : host.clientWidth || host.getBoundingClientRect().width || 0;

const getPointerPosition = (axis: ScrollbarAxis, event: PointerEvent<HTMLElement>): number =>
  axis === 'vertical' ? event.clientY : event.clientX;

const isPointerInHoverZone = (
  axis: ScrollbarAxis,
  host: HTMLElement,
  event: PointerEvent<HTMLElement>
): boolean => {
  const rect = host.getBoundingClientRect();
  const hoverZoneSize = readScrollbarPxToken('--scrollbar-hover-zone-size', 16, host);

  if (axis === 'vertical') {
    return (
      event.clientX >= rect.right - hoverZoneSize &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom
    );
  }

  return (
    event.clientX >= rect.left &&
    event.clientX <= rect.right &&
    event.clientY >= rect.bottom - hoverZoneSize &&
    event.clientY <= rect.bottom
  );
};

export const useVirtualScrollbar = ({
  axis,
  getHostElement,
  getMetrics,
  scrollBy,
  scrollByWheel,
  scrollTo,
}: VirtualScrollbarOptions) => {
  const hideTimerRef = useRef<number | null>(null);
  const dragRef = useRef<VirtualScrollbarDragState | null>(null);
  const [state, setState] = useState<VirtualScrollbarState>(INITIAL_STATE);

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current === null) {
      return;
    }
    window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = null;
  }, []);

  const updateGeometry = useCallback(
    (active?: boolean) => {
      const host = getHostElement();
      const metrics = getMetrics();
      if (!host || !metrics) {
        setState((previous) => ({
          ...previous,
          active: active ?? false,
          canScroll: false,
          dragging: false,
          hovered: false,
          thumbOffset: 0,
          thumbSize: 0,
        }));
        return;
      }

      const maxScrollOffset = Math.max(0, metrics.contentSize - metrics.viewportSize);
      const trackSize = getTrackSize(axis, host);
      if (maxScrollOffset <= 0 || trackSize <= 0) {
        setState((previous) => ({
          ...previous,
          active: active ?? previous.active,
          canScroll: false,
          thumbOffset: 0,
          thumbSize: 0,
        }));
        return;
      }

      const minThumbSize = readScrollbarPxToken('--scrollbar-min-thumb-size', 32, host);
      const thumbSize = Math.max(
        Math.min(trackSize, minThumbSize),
        Math.min(trackSize, (metrics.viewportSize / metrics.contentSize) * trackSize)
      );
      const maxThumbOffset = Math.max(0, trackSize - thumbSize);
      const thumbOffset = (metrics.scrollOffset / maxScrollOffset) * maxThumbOffset;

      setState((previous) => ({
        ...previous,
        active: active ?? previous.active,
        canScroll: true,
        thumbOffset: Math.max(0, Math.min(maxThumbOffset, thumbOffset)),
        thumbSize,
      }));
    },
    [axis, getHostElement, getMetrics]
  );

  const scheduleHide = useCallback(() => {
    clearHideTimer();
    const host = getHostElement();
    hideTimerRef.current = window.setTimeout(() => {
      setState((previous) => {
        if (previous.hovered || previous.dragging) {
          return previous;
        }
        return { ...previous, active: false };
      });
    }, readScrollbarActiveTimeoutMs(host));
  }, [clearHideTimer, getHostElement]);

  const show = useCallback(() => {
    updateGeometry(true);
    scheduleHide();
  }, [scheduleHide, updateGeometry]);

  const reset = useCallback(() => {
    clearHideTimer();
    dragRef.current = null;
    setState(INITIAL_STATE);
  }, [clearHideTimer]);

  const onSurfacePointerMove = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (!state.canScroll || state.dragging) {
        return;
      }
      const host = getHostElement();
      if (!host) {
        return;
      }

      const hovered = isPointerInHoverZone(axis, host, event);
      setState((previous) => {
        if (previous.hovered === hovered && previous.active === (hovered || previous.active)) {
          return previous;
        }
        return { ...previous, active: hovered ? true : previous.active, hovered };
      });

      if (hovered) {
        clearHideTimer();
      } else {
        scheduleHide();
      }
    },
    [axis, clearHideTimer, getHostElement, scheduleHide, state.canScroll, state.dragging]
  );

  const onSurfacePointerLeave = useCallback(() => {
    if (dragRef.current) {
      return;
    }
    setState((previous) => ({ ...previous, hovered: false }));
    scheduleHide();
  }, [scheduleHide]);

  const onTrackPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || event.target !== event.currentTarget) {
        return;
      }
      const host = getHostElement();
      const metrics = getMetrics();
      if (!host || !metrics) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const hostRect = host.getBoundingClientRect();
      const trackStart = axis === 'vertical' ? hostRect.top : hostRect.left;
      const pointerPosition = getPointerPosition(axis, event);
      const direction = pointerPosition < trackStart + state.thumbOffset ? -1 : 1;
      scrollBy(direction * metrics.viewportSize);
      show();
    },
    [axis, getHostElement, getMetrics, scrollBy, show, state.thumbOffset]
  );

  const onThumbPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const host = getHostElement();
      const metrics = getMetrics();
      if (event.button !== 0 || !host || !metrics) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);

      dragRef.current = {
        maxScrollOffset: Math.max(0, metrics.contentSize - metrics.viewportSize),
        startPointerPosition: getPointerPosition(axis, event),
        startScrollOffset: metrics.scrollOffset,
        thumbSize: state.thumbSize,
        trackSize: getTrackSize(axis, host),
      };
      clearHideTimer();
      setState((previous) => ({
        ...previous,
        active: true,
        dragging: true,
        hovered: true,
      }));
    },
    [axis, clearHideTimer, getHostElement, getMetrics, state.thumbSize]
  );

  const onThumbPointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      const maxThumbTravel = Math.max(1, drag.trackSize - drag.thumbSize);
      const nextScrollOffset =
        drag.startScrollOffset +
        ((getPointerPosition(axis, event) - drag.startPointerPosition) / maxThumbTravel) *
          drag.maxScrollOffset;
      scrollTo(Math.max(0, Math.min(drag.maxScrollOffset, Math.round(nextScrollOffset))));
      updateGeometry(true);
    },
    [axis, scrollTo, updateGeometry]
  );

  const onThumbPointerUp = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.releasePointerCapture(event.pointerId);
      dragRef.current = null;
      const host = getHostElement();
      const hovered = host ? isPointerInHoverZone(axis, host, event) : false;
      setState((previous) => ({
        ...previous,
        dragging: false,
        hovered,
      }));
      if (hovered) {
        clearHideTimer();
      } else {
        scheduleHide();
      }
    },
    [axis, clearHideTimer, getHostElement, scheduleHide]
  );

  const onWheel = useCallback(
    (event: WheelEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (scrollByWheel) {
        scrollByWheel(event);
      } else {
        const delta = axis === 'vertical' ? event.deltaY : event.deltaX || event.deltaY;
        if (delta !== 0) {
          scrollBy(Math.sign(delta));
        }
      }
      show();
    },
    [axis, scrollBy, scrollByWheel, show]
  );

  const className = [
    'scrollbar-virtual',
    `scrollbar-virtual--${axis}`,
    state.active ? 'scrollbar-virtual--active' : '',
    state.hovered || state.dragging ? 'scrollbar-virtual--hovered' : '',
    state.dragging ? 'scrollbar-virtual--dragging' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const style = {
    '--scrollbar-virtual-thumb-offset': `${state.thumbOffset}px`,
    '--scrollbar-virtual-thumb-size': `${state.thumbSize}px`,
  } as CSSProperties;

  const scrollbar = state.canScroll ? (
    <div
      aria-hidden="true"
      className={className}
      data-scrollbar-axis={axis}
      onPointerDown={onTrackPointerDown}
      onWheel={onWheel}
      style={style}
    >
      <div
        className="scrollbar-virtual-thumb"
        onPointerDown={onThumbPointerDown}
        onPointerMove={onThumbPointerMove}
        onPointerUp={onThumbPointerUp}
      />
    </div>
  ) : null;

  return {
    onSurfacePointerLeave,
    onSurfacePointerMove,
    reset,
    scrollbar,
    show,
    state,
    updateGeometry,
  };
};
