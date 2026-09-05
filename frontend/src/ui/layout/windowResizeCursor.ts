export type DirectionalWindowResizeCursor =
  | 'n-resize'
  | 'ne-resize'
  | 'e-resize'
  | 'se-resize'
  | 's-resize'
  | 'sw-resize'
  | 'w-resize'
  | 'nw-resize';

interface ResolveDirectionalWindowResizeCursorOptions {
  wailsCursor: string;
  clientX: number;
  clientY: number;
  width: number;
  height: number;
}

type WindowResizeQuadrant = 'nw' | 'ne' | 'sw' | 'se';

const directionalResizeCursors = new Set<DirectionalWindowResizeCursor>([
  'n-resize',
  'ne-resize',
  'e-resize',
  'se-resize',
  's-resize',
  'sw-resize',
  'w-resize',
  'nw-resize',
]);

const projectedResizeCursors: Readonly<
  Record<string, Readonly<Partial<Record<WindowResizeQuadrant, DirectionalWindowResizeCursor>>>>
> = {
  'ew-resize': {
    nw: 'w-resize',
    ne: 'e-resize',
    sw: 'w-resize',
    se: 'e-resize',
  },
  'ns-resize': {
    nw: 'n-resize',
    ne: 'n-resize',
    sw: 's-resize',
    se: 's-resize',
  },
  'nwse-resize': {
    nw: 'nw-resize',
    se: 'se-resize',
  },
  'nesw-resize': {
    ne: 'ne-resize',
    sw: 'sw-resize',
  },
};

const resolveWindowResizeQuadrant = (
  clientX: number,
  clientY: number,
  width: number,
  height: number
): WindowResizeQuadrant => {
  const verticalHalf = clientY < height / 2 ? 'n' : 's';
  const horizontalHalf = clientX < width / 2 ? 'w' : 'e';
  return `${verticalHalf}${horizontalHalf}`;
};

export function resolveDirectionalWindowResizeCursor({
  wailsCursor,
  clientX,
  clientY,
  width,
  height,
}: ResolveDirectionalWindowResizeCursorOptions): DirectionalWindowResizeCursor | undefined {
  if (directionalResizeCursors.has(wailsCursor as DirectionalWindowResizeCursor)) {
    return wailsCursor as DirectionalWindowResizeCursor;
  }
  if (width <= 0 || height <= 0) {
    return undefined;
  }

  const quadrant = resolveWindowResizeQuadrant(clientX, clientY, width, height);
  return projectedResizeCursors[wailsCursor]?.[quadrant];
}

export function installDirectionalWindowResizeCursor(
  targetWindow: Window = window,
  targetDocument: Document = document
): () => void {
  const frame = targetDocument.createElement('div');
  frame.className = 'window-resize-frame';
  frame.setAttribute('aria-hidden', 'true');
  const handleSize = getWindowResizeHandleSize();
  frame.style.setProperty('--window-resize-handle-width', `${handleSize.width}px`);
  frame.style.setProperty('--window-resize-handle-height', `${handleSize.height}px`);
  for (const edge of ['top', 'right', 'bottom', 'left']) {
    const surface = targetDocument.createElement('div');
    surface.className = `window-resize-frame-${edge}`;
    frame.appendChild(surface);
  }
  // Native scrollbars consume the drag after mouse-down. These transparent
  // surfaces keep the outer resize strip in the DOM; Wails still owns all
  // edge detection, button tracking, and native resize invocation.
  targetDocument.body.appendChild(frame);
  const updateFrameBounds = () => {
    const root = targetDocument.documentElement;
    const zoom = Number.parseFloat(targetWindow.getComputedStyle(root).zoom) || 1;
    frame.style.setProperty(
      '--window-resize-right-inset',
      `${Math.max(0, targetWindow.innerWidth - root.clientWidth * zoom)}px`
    );
    frame.style.setProperty(
      '--window-resize-bottom-inset',
      `${Math.max(0, targetWindow.innerHeight - root.clientHeight * zoom)}px`
    );
  };
  updateFrameBounds();
  targetWindow.addEventListener('resize', updateFrameBounds);
  const observer =
    typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(updateFrameBounds);
  observer?.observe(targetDocument.documentElement);
  let projectedCursor: DirectionalWindowResizeCursor | undefined;
  const clearCursor = () => {
    const body = targetDocument.body;
    if (!body) {
      return;
    }
    if (projectedCursor && body.style.cursor === projectedCursor) {
      body.style.cursor = '';
    }
    projectedCursor = undefined;
    delete body.dataset.windowResizeCursor;
  };
  const updateCursor = (event: MouseEvent) => {
    const body = targetDocument.body;
    if (!body) {
      return;
    }

    // The Wails runtime runs its capture listener first and writes its active
    // resize cursor to body.style. Preserve that hit-test result while using
    // the direction-specific cursor name selected by native window frames.
    const cursor = resolveDirectionalWindowResizeCursor({
      wailsCursor: body.style.cursor,
      clientX: event.clientX,
      clientY: event.clientY,
      width: targetWindow.innerWidth,
      height: targetWindow.innerHeight,
    });
    if (cursor) {
      body.style.cursor = cursor;
      projectedCursor = cursor;
      body.dataset.windowResizeCursor = cursor;
    } else {
      clearCursor();
    }
  };

  const handleMouseLeave = (event: MouseEvent) => {
    if (event.target === targetDocument.documentElement) {
      clearCursor();
    }
  };

  targetWindow.addEventListener('mousemove', updateCursor, { capture: true });
  targetWindow.addEventListener('blur', clearCursor);
  targetDocument.addEventListener('mouseleave', handleMouseLeave, { capture: true });

  return () => {
    observer?.disconnect();
    targetWindow.removeEventListener('resize', updateFrameBounds);
    frame.remove();
    targetWindow.removeEventListener('mousemove', updateCursor, { capture: true });
    targetWindow.removeEventListener('blur', clearCursor);
    targetDocument.removeEventListener('mouseleave', handleMouseLeave, { capture: true });
    clearCursor();
  };
}

import { getWindowResizeHandleSize } from '@/core/desktop-runtime';
