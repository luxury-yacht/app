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

  const west = clientX < width / 2;
  const north = clientY < height / 2;
  switch (wailsCursor) {
    case 'ew-resize':
      return west ? 'w-resize' : 'e-resize';
    case 'ns-resize':
      return north ? 'n-resize' : 's-resize';
    case 'nwse-resize':
      if (north && west) {
        return 'nw-resize';
      }
      return !north && !west ? 'se-resize' : undefined;
    case 'nesw-resize':
      if (north && !west) {
        return 'ne-resize';
      }
      return !north && west ? 'sw-resize' : undefined;
    default:
      return undefined;
  }
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
