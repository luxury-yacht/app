import './WorkloadsPodsSplit.css';
import type React from 'react';
import { useCallback, useRef, useState } from 'react';

const MIN_UPPER_PERCENT = 25;
const MAX_UPPER_PERCENT = 75;
const RESIZE_STEP = 5;

interface WorkloadsPodsSplitProps {
  upper: React.ReactNode;
  lower: React.ReactNode;
  lowerLabel?: React.ReactNode;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}

const clampAndSnap = (value: number) =>
  Math.min(
    MAX_UPPER_PERCENT,
    Math.max(MIN_UPPER_PERCENT, Math.round(value / RESIZE_STEP) * RESIZE_STEP)
  );

export default function WorkloadsPodsSplit({
  upper,
  lower,
  lowerLabel = 'Pods',
  collapsed: controlledCollapsed,
  onCollapsedChange,
}: WorkloadsPodsSplitProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const resizingRef = useRef(false);
  const [upperPercent, setUpperPercent] = useState(50);
  const [internalCollapsed, setInternalCollapsed] = useState(false);
  const collapsed = controlledCollapsed ?? internalCollapsed;

  const setCollapsed = useCallback(
    (next: boolean) => {
      if (controlledCollapsed === undefined) {
        setInternalCollapsed(next);
      }
      onCollapsedChange?.(next);
    },
    [controlledCollapsed, onCollapsedChange]
  );

  const handleResizeKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLHRElement>) => {
      let next: number | null = null;
      switch (event.key) {
        case 'ArrowUp':
          next = upperPercent - RESIZE_STEP;
          break;
        case 'ArrowDown':
          next = upperPercent + RESIZE_STEP;
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
      setUpperPercent(clampAndSnap(next));
    },
    [upperPercent]
  );

  const resizeFromPointer = useCallback((clientY: number) => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect || rect.height <= 0) {
      return;
    }
    setUpperPercent(clampAndSnap(((clientY - rect.top) / rect.height) * 100));
  }, []);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLHRElement>) => {
      resizingRef.current = true;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      resizeFromPointer(event.clientY);
    },
    [resizeFromPointer]
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLHRElement>) => {
      if (resizingRef.current) {
        resizeFromPointer(event.clientY);
      }
    },
    [resizeFromPointer]
  );

  const stopPointerResize = useCallback((event: React.PointerEvent<HTMLHRElement>) => {
    resizingRef.current = false;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }, []);

  return (
    <div
      ref={rootRef}
      className={`workloads-pods-split workloads-pods-split--${upperPercent}${collapsed ? ' workloads-pods-split--collapsed' : ''}`}
    >
      <section
        className="workloads-pods-split__pane workloads-pods-split__pane--upper"
        aria-label="Workloads"
      >
        {upper}
      </section>
      <div className="workloads-pods-split__divider">
        <hr
          className="workloads-pods-split__resizer"
          aria-label="Resize Workloads and Pods"
          aria-orientation="horizontal"
          aria-valuemin={MIN_UPPER_PERCENT}
          aria-valuemax={MAX_UPPER_PERCENT}
          aria-valuenow={upperPercent}
          tabIndex={collapsed ? -1 : 0}
          onKeyDown={handleResizeKeyDown}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={stopPointerResize}
          onPointerCancel={stopPointerResize}
        />
        <div className="workloads-pods-split__divider-label">{lowerLabel}</div>
        <button
          type="button"
          className="button generic workloads-pods-split__collapse"
          aria-label={collapsed ? 'Expand Pods' : 'Collapse Pods'}
          title={collapsed ? 'Expand Pods' : 'Collapse Pods'}
          onClick={() => setCollapsed(!collapsed)}
        >
          <span aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
        </button>
      </div>
      {!collapsed && (
        <section
          className="workloads-pods-split__pane workloads-pods-split__pane--lower"
          aria-label="Pods"
        >
          {lower}
        </section>
      )}
    </div>
  );
}
