/**
 * frontend/src/shared/components/tabs/dragCoordinator/TabDragProvider.tsx
 *
 * Scopes a single tab drag operation. Holds the current payload and a
 * registry of drop targets. Built on HTML5 native drag events.
 *
 * Future seam: when Wails v3 multi-window arrives (or a fake equivalent
 * lands), `onTearOff` will fire on `dragend` events that fall outside
 * any registered target AND outside the window bounds. The seam is
 * stubbed today and not wired by any consumer.
 */
import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import type { TabDragPayload } from './types';

export interface DropTargetRegistration {
  element: HTMLElement;
  accepts: ReadonlyArray<TabDragPayload['kind']>;
  onDrop: (payload: TabDragPayload, event: DragEvent) => void;
  onDragEnter?: (payload: TabDragPayload) => void;
  onDragLeave?: () => void;
}

interface TabDragContextValue {
  currentDrag: TabDragPayload | null;
  beginDrag: (payload: TabDragPayload) => void;
  endDrag: () => void;
  registerTarget: (id: number, registration: DropTargetRegistration) => void;
  unregisterTarget: (id: number) => void;
}

export const TabDragContext = createContext<TabDragContextValue>({
  currentDrag: null,
  beginDrag: () => {},
  endDrag: () => {},
  registerTarget: () => {},
  unregisterTarget: () => {},
});

export interface TabDragProviderProps {
  children: ReactNode;
  /**
   * Future. Fires on `dragend` when no target consumed the drop AND the
   * cursor is outside the window bounds. Wrappers can implement this to
   * spawn a new floating panel or (eventually) a new OS window.
   */
  onTearOff?: (payload: TabDragPayload, cursor: { x: number; y: number }) => void;
}

export function TabDragProvider({ children, onTearOff }: TabDragProviderProps) {
  const [currentDrag, setCurrentDrag] = useState<TabDragPayload | null>(null);
  const targetsRef = useRef<Map<number, DropTargetRegistration>>(new Map());
  const lastDragRef = useRef<TabDragPayload | null>(null);

  const beginDrag = useCallback((payload: TabDragPayload) => {
    lastDragRef.current = payload;
    setCurrentDrag(payload);
  }, []);

  const endDrag = useCallback(() => {
    lastDragRef.current = null;
    setCurrentDrag(null);
  }, []);

  const registerTarget = useCallback((id: number, registration: DropTargetRegistration) => {
    targetsRef.current.set(id, registration);
  }, []);

  const unregisterTarget = useCallback((id: number) => {
    targetsRef.current.delete(id);
  }, []);

  // Tear-off seam: a global dragend listener that fires onTearOff when
  // no drop target consumed the drag AND the cursor is outside the
  // window bounds. Stubbed for now — no production consumer wires it.
  useEffect(() => {
    if (!onTearOff) return;
    const handler = (event: DragEvent) => {
      const payload = lastDragRef.current;
      if (!payload) return;
      if (event.dataTransfer && event.dataTransfer.dropEffect !== 'none') return;
      const { clientX, clientY } = event;
      if (
        clientX < 0 ||
        clientY < 0 ||
        clientX > window.innerWidth ||
        clientY > window.innerHeight
      ) {
        onTearOff(payload, { x: clientX, y: clientY });
      }
    };
    document.addEventListener('dragend', handler);
    return () => document.removeEventListener('dragend', handler);
  }, [onTearOff]);

  const value = useMemo<TabDragContextValue>(
    () => ({
      currentDrag,
      beginDrag,
      endDrag,
      registerTarget,
      unregisterTarget,
    }),
    [currentDrag, beginDrag, endDrag, registerTarget, unregisterTarget]
  );

  return <TabDragContext.Provider value={value}>{children}</TabDragContext.Provider>;
}
