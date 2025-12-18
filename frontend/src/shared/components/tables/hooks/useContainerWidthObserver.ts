import { useEffect, useMemo } from 'react';
import type { RefObject } from 'react';

// Observes the GridTable wrapper width and reports changes so callers can
// reconcile column widths to the available space. Supports custom containers
// and injected window/ResizeObserver for testing.

interface ContainerWidthObserverOptions {
  tableRef: RefObject<HTMLElement | null>;
  onContainerWidth: (width: number) => void;
  tableDataLength: number;
  resolveContainer?: (tableElement: HTMLElement | null) => HTMLElement | null;
  windowImpl?: Window;
  resizeObserverImpl?: typeof ResizeObserver;
}

export function useContainerWidthObserver({
  tableRef,
  onContainerWidth,
  tableDataLength,
  resolveContainer,
  windowImpl,
  resizeObserverImpl,
}: ContainerWidthObserverOptions) {
  const targetWindow = useMemo(() => {
    if (windowImpl) {
      return windowImpl;
    }
    if (typeof window !== 'undefined') {
      return window;
    }
    return null;
  }, [windowImpl]);

  const resolveTargetContainer = useMemo(() => {
    if (resolveContainer) {
      return resolveContainer;
    }
    return (tableElement: HTMLElement | null) =>
      tableElement?.closest('.gridtable-wrapper') as HTMLElement | null;
  }, [resolveContainer]);

  useEffect(() => {
    if (!targetWindow) {
      return;
    }

    const getContainer = () => resolveTargetContainer(tableRef.current);
    const handleResize = () => {
      const container = getContainer();
      if (!container) {
        return;
      }
      const width = container.clientWidth;
      if (typeof width === 'number' && width > 0) {
        onContainerWidth(width);
      }
    };

    handleResize();

    targetWindow.addEventListener('resize', handleResize);

    let resizeObserver: ResizeObserver | null = null;
    const ObserverCtor =
      resizeObserverImpl ?? (typeof ResizeObserver !== 'undefined' ? ResizeObserver : undefined);

    if (ObserverCtor) {
      resizeObserver = new ObserverCtor(() => handleResize());
      const container = getContainer();
      if (container) {
        resizeObserver.observe(container);
      }
    }

    return () => {
      targetWindow.removeEventListener('resize', handleResize);
      resizeObserver?.disconnect();
    };
  }, [
    targetWindow,
    resolveTargetContainer,
    tableRef,
    onContainerWidth,
    resizeObserverImpl,
    tableDataLength,
  ]);
}
