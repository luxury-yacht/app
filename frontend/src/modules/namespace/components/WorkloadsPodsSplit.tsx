import './WorkloadsPodsSplit.css';
import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

const MIN_UPPER_PERCENT = 10;
const MAX_UPPER_PERCENT = 90;
const KEYBOARD_RESIZE_STEP_PX = 16;

interface WorkloadsPodsSplitProps {
  upper: React.ReactNode;
  lower: React.ReactNode;
  collapsed?: boolean;
}

const clampResizePercent = (value: number) =>
  Math.round(Math.min(MAX_UPPER_PERCENT, Math.max(MIN_UPPER_PERCENT, value)) * 1000) / 1000;

export default function WorkloadsPodsSplit({
  upper,
  lower,
  collapsed = false,
}: WorkloadsPodsSplitProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const resizingRef = useRef(false);
  const resizeStartRef = useRef({ clientY: 0, upperPercent: 50 });
  const [isResizing, setIsResizing] = useState(false);
  const [upperPercent, setUpperPercent] = useState(50);

  useEffect(() => {
    if (!isResizing) {
      return;
    }
    document.body.classList.add('workloads-pods-resizing');
    return () => document.body.classList.remove('workloads-pods-resizing');
  }, [isResizing]);

  const applyUpperPercent = useCallback((value: number) => {
    const next = clampResizePercent(value);
    rootRef.current?.style.setProperty('--workloads-pods-upper-size', `${next}%`);
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
      className={`workloads-pods-split${collapsed ? ' workloads-pods-split--collapsed' : ''}${isResizing ? ' workloads-pods-split--resizing' : ''}`}
    >
      <section
        className="workloads-pods-split__pane workloads-pods-split__pane--upper"
        aria-label="Workloads"
      >
        {upper}
      </section>
      {!collapsed && (
        <hr
          className="workloads-pods-split__resizer"
          aria-label="Resize Workloads and Pods"
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
      <section
        className="workloads-pods-split__pane workloads-pods-split__pane--lower"
        aria-label="Pods"
      >
        {lower}
      </section>
    </div>
  );
}
