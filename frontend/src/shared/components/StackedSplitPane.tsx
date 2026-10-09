import './StackedSplitPane.css';
import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

const MIN_UPPER_PERCENT = 10;
const MAX_UPPER_PERCENT = 90;
const KEYBOARD_RESIZE_STEP_PX = 16;

interface StackedSplitPaneProps {
  upper: React.ReactNode;
  lower: React.ReactNode;
  /** Accessible names of the two regions; the resizer names both. */
  upperLabel: string;
  lowerLabel: string;
  collapsed?: boolean;
}

const clampResizePercent = (value: number) =>
  Math.round(Math.min(MAX_UPPER_PERCENT, Math.max(MIN_UPPER_PERCENT, value)) * 1000) / 1000;

/** Two tables stacked vertically with a resizable boundary; the lower one can collapse. */
export default function StackedSplitPane({
  upper,
  lower,
  upperLabel,
  lowerLabel,
  collapsed = false,
}: Readonly<StackedSplitPaneProps>) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const resizingRef = useRef(false);
  const resizeStartRef = useRef({ clientY: 0, upperPercent: 50 });
  const [isResizing, setIsResizing] = useState(false);
  const [upperPercent, setUpperPercent] = useState(50);

  useEffect(() => {
    if (!isResizing) {
      return;
    }
    document.body.classList.add('stacked-split-resizing');
    return () => document.body.classList.remove('stacked-split-resizing');
  }, [isResizing]);

  const applyUpperPercent = useCallback((value: number) => {
    const next = clampResizePercent(value);
    rootRef.current?.style.setProperty('--stacked-split-upper-size', `${next}%`);
    setUpperPercent(next);
  }, []);

  const handleResizeKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLHRElement>) => {
      const rootHeight = rootRef.current?.getBoundingClientRect().height ?? 0;
      const keyboardStepPercent = rootHeight > 0 ? (KEYBOARD_RESIZE_STEP_PX / rootHeight) * 100 : 2;
      let next: number | null = null;
      switch (event.key) {
        case 'ArrowUp':
          next = upperPercent - keyboardStepPercent;
          break;
        case 'ArrowDown':
          next = upperPercent + keyboardStepPercent;
          break;
        case 'Home':
          next = MIN_UPPER_PERCENT;
          break;
        case 'End':
          next = MAX_UPPER_PERCENT;
          break;
        default:
          return;
      }
      event.preventDefault();
      applyUpperPercent(next);
    },
    [applyUpperPercent, upperPercent]
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLHRElement>) => {
      event.preventDefault();
      resizingRef.current = true;
      resizeStartRef.current = { clientY: event.clientY, upperPercent };
      setIsResizing(true);
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    [upperPercent]
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLHRElement>) => {
      const rootHeight = rootRef.current?.getBoundingClientRect().height ?? 0;
      if (!resizingRef.current || rootHeight <= 0) {
        return;
      }
      const deltaPercent = ((event.clientY - resizeStartRef.current.clientY) / rootHeight) * 100;
      applyUpperPercent(resizeStartRef.current.upperPercent + deltaPercent);
    },
    [applyUpperPercent]
  );

  const stopPointerResize = useCallback((event: React.PointerEvent<HTMLHRElement>) => {
    resizingRef.current = false;
    setIsResizing(false);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }, []);

  return (
    <div
      ref={rootRef}
      className={`stacked-split${collapsed ? ' stacked-split--collapsed' : ''}${isResizing ? ' stacked-split--resizing' : ''}`}
    >
      <section className="stacked-split__pane stacked-split__pane--upper" aria-label={upperLabel}>
        {upper}
      </section>
      {!collapsed && (
        <hr
          className="stacked-split__resizer"
          aria-label={`Resize ${upperLabel} and ${lowerLabel}`}
          aria-orientation="horizontal"
          aria-valuemin={MIN_UPPER_PERCENT}
          aria-valuemax={MAX_UPPER_PERCENT}
          aria-valuenow={upperPercent}
          tabIndex={0}
          onKeyDown={handleResizeKeyDown}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={stopPointerResize}
          onPointerCancel={stopPointerResize}
        />
      )}
      <section className="stacked-split__pane stacked-split__pane--lower" aria-label={lowerLabel}>
        {lower}
      </section>
    </div>
  );
}
