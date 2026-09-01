/**
 * Docked-panel resize interactions.
 *
 * Native floating windows are resized and moved by the operating system. This
 * hook deliberately owns only the right and bottom dock separators.
 */

import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getContentBounds } from './dockablePanelLayout';
import type { DockPosition } from './useDockablePanelState';

interface DockablePanelState {
  position: DockPosition;
  size: { width: number; height: number };
  isOpen: boolean;
  setSize: (size: { width: number; height: number }) => void;
}

interface DockablePanelDragResizeOptions {
  panelState: DockablePanelState;
  safeMinWidth: number;
  safeMinHeight: number;
  isMaximized: boolean;
}

const KEYBOARD_RESIZE_STEP = 16;
type DockedPosition = 'right' | 'bottom';
type DockedResizeAction = number | 'minimum' | 'maximum';

const DOCKED_RESIZE_ACTIONS: Record<DockedPosition, Partial<Record<string, DockedResizeAction>>> = {
  right: {
    ArrowLeft: KEYBOARD_RESIZE_STEP,
    ArrowRight: -KEYBOARD_RESIZE_STEP,
    Home: 'minimum',
    End: 'maximum',
  },
  bottom: {
    ArrowUp: KEYBOARD_RESIZE_STEP,
    ArrowDown: -KEYBOARD_RESIZE_STEP,
    Home: 'minimum',
    End: 'maximum',
  },
};

const calculateDockedKeyboardSize = (
  key: string,
  position: DockedPosition,
  current: number,
  minimum: number,
  maximum: number
): number | null => {
  const action = DOCKED_RESIZE_ACTIONS[position][key];
  if (action === undefined) {
    return null;
  }
  if (action === 'minimum') {
    return minimum;
  }
  if (action === 'maximum') {
    return maximum;
  }
  return Math.min(Math.max(current + action, minimum), maximum);
};

export function useDockablePanelDragResize(options: DockablePanelDragResizeOptions) {
  const { panelState, safeMinWidth, safeMinHeight, isMaximized } = options;
  const panelStateRef = useRef(panelState);
  const [isResizing, setIsResizing] = useState(false);
  const [resizeDirection, setResizeDirection] = useState<'n' | 'w' | ''>('');
  const resizeStartRef = useRef({ width: 0, height: 0, pointer: 0 });

  useEffect(() => {
    panelStateRef.current = panelState;
  }, [panelState]);

  const handleMouseDownResize = useCallback(
    (event: ReactMouseEvent, direction: string) => {
      if (isMaximized || (direction !== 'n' && direction !== 'w')) {
        return;
      }
      event.stopPropagation();
      event.preventDefault();
      setIsResizing(true);
      setResizeDirection(direction);
      resizeStartRef.current = {
        width: panelState.size.width,
        height: panelState.size.height,
        pointer: direction === 'w' ? event.clientX : event.clientY,
      };
    },
    [isMaximized, panelState.size.height, panelState.size.width]
  );

  const handleDockedKeyboardResize = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>, position: DockedPosition) => {
      const content = getContentBounds();
      const isRight = position === 'right';
      const minimum = isRight ? safeMinWidth : safeMinHeight;
      const maximum = Math.max(minimum, isRight ? content.width : content.height);
      const current = isRight ? panelState.size.width : panelState.size.height;
      const next = calculateDockedKeyboardSize(event.key, position, current, minimum, maximum);
      if (next === null) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      panelState.setSize({
        width: isRight ? next : panelState.size.width,
        height: isRight ? panelState.size.height : next,
      });
    },
    [panelState, safeMinHeight, safeMinWidth]
  );

  useEffect(() => {
    if (!isResizing || !resizeDirection) {
      return;
    }

    const handleMouseMove = (event: MouseEvent) => {
      const current = panelStateRef.current;
      const content = getContentBounds();
      const start = resizeStartRef.current;
      if (resizeDirection === 'w') {
        current.setSize({
          width: Math.max(
            safeMinWidth,
            Math.min(content.width, start.width - (event.clientX - start.pointer))
          ),
          height: current.size.height,
        });
        return;
      }
      current.setSize({
        width: current.size.width,
        height: Math.max(
          safeMinHeight,
          Math.min(content.height, start.height - (event.clientY - start.pointer))
        ),
      });
    };

    const stopResize = () => {
      setIsResizing(false);
      setResizeDirection('');
    };

    document.body.classList.add(
      'dockable-panel-resizing',
      `dockable-panel-resizing-${resizeDirection}`
    );
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', stopResize, { once: true });
    return () => {
      document.body.classList.remove(
        'dockable-panel-resizing',
        'dockable-panel-resizing-n',
        'dockable-panel-resizing-w'
      );
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', stopResize);
    };
  }, [isResizing, resizeDirection, safeMinHeight, safeMinWidth]);

  useEffect(() => {
    if (!panelState.isOpen && isResizing) {
      setIsResizing(false);
      setResizeDirection('');
    }
  }, [isResizing, panelState.isOpen]);

  return {
    isResizing,
    handleMouseDownResize,
    handleDockedKeyboardResize,
  };
}
