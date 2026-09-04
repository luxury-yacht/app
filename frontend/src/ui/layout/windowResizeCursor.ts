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

  targetWindow.addEventListener('mousemove', updateCursor, { capture: true });
  targetWindow.addEventListener('blur', clearCursor);
  targetDocument.addEventListener('mouseleave', clearCursor);

  return () => {
    targetWindow.removeEventListener('mousemove', updateCursor, { capture: true });
    targetWindow.removeEventListener('blur', clearCursor);
    targetDocument.removeEventListener('mouseleave', clearCursor);
    clearCursor();
  };
}
