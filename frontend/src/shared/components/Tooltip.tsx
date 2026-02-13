/**
 * frontend/src/shared/components/Tooltip.tsx
 *
 * Reusable, portal-based Tooltip component.
 * Uses the shared .tooltip CSS class from styles/components/tooltips.css for
 * base styling, arrows, and variant colours.
 *
 * Features:
 *  - Portal rendering (position: fixed via .tooltip--portal)
 *  - Viewport-aware auto-flip (top ↔ bottom)
 *  - Zoom-aware positioning via ZoomContext
 *  - Hover (with configurable delay) or click trigger
 *  - Optional arrow indicator (rotated-square style from tooltips.css)
 *  - Default circled "i" icon when no children are provided
 */

import React, { useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { useZoom } from '@core/contexts/ZoomContext';
import './Tooltip.css';

export interface TooltipProps {
  /** Rich content (JSX) or plain text shown inside the tooltip */
  content: React.ReactNode;
  /** Trigger element — when omitted a circled "i" icon is rendered */
  children?: React.ReactNode;
  /** Preferred placement; auto-flips when insufficient viewport space */
  placement?: 'top' | 'bottom';
  /** How the tooltip is activated */
  trigger?: 'hover' | 'click';
  /** Delay in ms before the tooltip appears on hover */
  hoverDelay?: number;
  /** Visual variant — maps to modifier class on .tooltip */
  variant?: 'default' | 'dark' | 'light' | 'accent' | 'error' | 'warning';
  /** Show the directional arrow indicator */
  showArrow?: boolean;
  /** Override the tooltip max-width (px) */
  maxWidth?: number;
  /** Override the tooltip min-width (px) */
  minWidth?: number;
  /** Extra class name on the tooltip popup element */
  className?: string;
  /** When true the tooltip is completely suppressed */
  disabled?: boolean;
  /** Render trigger as inline <span> (true, default) or block <div> (false).
   *  Use false when wrapping block-level children like ResourceBar. */
  inline?: boolean;
  /** Keep tooltip open while hovering over the tooltip content itself.
   *  Enables interacting with buttons/links inside the tooltip.
   *  Adds pointer-events and a grace period when crossing the gap. */
  interactive?: boolean;
}

/** Minimum viewport space (px) before the tooltip flips to the other side */
const FLIP_THRESHOLD = 200;

const Tooltip: React.FC<TooltipProps> = ({
  content,
  children,
  placement = 'top',
  trigger = 'hover',
  hoverDelay = 250,
  variant = 'default',
  showArrow = true,
  maxWidth,
  minWidth,
  className,
  disabled = false,
  inline = true,
  interactive = false,
}) => {
  const [visible, setVisible] = useState(false);
  const [resolvedPlacement, setResolvedPlacement] = useState(placement);
  const [style, setStyle] = useState<React.CSSProperties>({});

  const triggerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Separate ref for the grace-period hide timer (interactive mode) */
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Grace period (ms) for the mouse to travel from trigger to tooltip */
  const INTERACTIVE_GRACE = 100;

  const { zoomLevel } = useZoom();

  // ------------------------------------------------------------------
  // Positioning — runs after the tooltip is rendered so we can measure it
  // ------------------------------------------------------------------
  useLayoutEffect(() => {
    if (!visible || !triggerRef.current || !tooltipRef.current) return;

    const zoomFactor = zoomLevel / 100;
    const triggerRect = triggerRef.current.getBoundingClientRect();
    const tooltipEl = tooltipRef.current;

    // getBoundingClientRect, offsetWidth/Height, and CSS left/top are all in
    // the same CSS coordinate space — no zoom conversion needed between them.
    // Only window.innerWidth/Height are "unzoomed" (see ZoomContext docs).
    const tooltipWidth = tooltipEl.offsetWidth;
    const tooltipHeight = tooltipEl.offsetHeight;

    const gap = 6;

    // Viewport dimensions in CSS coordinates
    const viewportWidth = window.innerWidth / zoomFactor;
    const viewportHeight = window.innerHeight / zoomFactor;

    // Determine placement — flip if not enough space
    const spaceAbove = triggerRect.top;
    const spaceBelow = viewportHeight - triggerRect.bottom;
    let effectivePlacement = placement;

    if (placement === 'top' && spaceAbove < FLIP_THRESHOLD) {
      effectivePlacement = 'bottom';
    } else if (placement === 'bottom' && spaceBelow < FLIP_THRESHOLD) {
      effectivePlacement = 'top';
    }
    setResolvedPlacement(effectivePlacement);

    // Horizontal: centre on the trigger, constrained to viewport
    const padding = 8;
    const centreX = triggerRect.left + triggerRect.width / 2 - tooltipWidth / 2;
    const clampedX = Math.max(
      padding,
      Math.min(centreX, viewportWidth - tooltipWidth - padding)
    );

    // Vertical: above or below the trigger
    let top: number;
    if (effectivePlacement === 'top') {
      top = triggerRect.top - gap - tooltipHeight;
    } else {
      top = triggerRect.bottom + gap;
    }

    setStyle({ left: clampedX, top });
  }, [visible, placement, zoomLevel]);

  // ------------------------------------------------------------------
  // Cleanup timer on unmount
  // ------------------------------------------------------------------
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  // ------------------------------------------------------------------
  // Outside-click handler for click-trigger mode
  // ------------------------------------------------------------------
  useEffect(() => {
    if (trigger !== 'click' || !visible) return;

    const handleOutside = (e: MouseEvent) => {
      if (
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node) &&
        tooltipRef.current &&
        !tooltipRef.current.contains(e.target as Node)
      ) {
        setVisible(false);
      }
    };

    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [trigger, visible]);

  // ------------------------------------------------------------------
  // Event handlers
  // ------------------------------------------------------------------

  /** Cancel any pending hide (used in interactive mode). */
  const cancelHide = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  /** Schedule a hide after the grace period (interactive mode)
   *  or hide immediately (non-interactive). */
  const scheduleHide = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (interactive) {
      hideTimerRef.current = setTimeout(() => setVisible(false), INTERACTIVE_GRACE);
    } else {
      setVisible(false);
    }
  }, [interactive, INTERACTIVE_GRACE]);

  const handleMouseEnter = useCallback(() => {
    if (disabled || trigger !== 'hover') return;
    cancelHide();
    timerRef.current = setTimeout(() => setVisible(true), hoverDelay);
  }, [disabled, trigger, hoverDelay, cancelHide]);

  const handleMouseLeave = useCallback(() => {
    if (trigger !== 'hover') return;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    scheduleHide();
  }, [trigger, scheduleHide]);

  /** When the mouse enters the tooltip popup (interactive mode). */
  const handleTooltipMouseEnter = useCallback(() => {
    if (!interactive) return;
    cancelHide();
  }, [interactive, cancelHide]);

  /** When the mouse leaves the tooltip popup (interactive mode). */
  const handleTooltipMouseLeave = useCallback(() => {
    if (!interactive) return;
    scheduleHide();
  }, [interactive, scheduleHide]);

  const handleClick = useCallback(() => {
    if (disabled || trigger !== 'click') return;
    setVisible((v) => !v);
  }, [disabled, trigger]);

  // ------------------------------------------------------------------
  // Build tooltip class list
  // ------------------------------------------------------------------
  const tooltipClasses = [
    'tooltip',
    'tooltip--portal',
    interactive ? 'tooltip--interactive' : '',
    variant !== 'default' ? variant : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  const inlineStyle: React.CSSProperties = { ...style };
  if (maxWidth !== undefined) inlineStyle.maxWidth = maxWidth;
  if (minWidth !== undefined) inlineStyle.minWidth = minWidth;

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  const portalTarget = typeof document !== 'undefined' ? document.body : null;

  // Use <span> for inline contexts (e.g. icon in text) or <div> for block
  // contexts (e.g. wrapping a ResourceBar).
  const TriggerTag = inline ? 'span' : 'div';
  const triggerClass = inline ? 'tooltip-trigger' : 'tooltip-trigger tooltip-trigger--block';

  return (
    <>
      <TriggerTag
        ref={triggerRef}
        className={triggerClass}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
      >
        {children ?? <span className="tooltip-info-icon">i</span>}
      </TriggerTag>

      {visible &&
        !disabled &&
        portalTarget &&
        createPortal(
          <div
            ref={tooltipRef}
            className={tooltipClasses}
            style={inlineStyle}
            data-placement={showArrow ? resolvedPlacement : undefined}
            onMouseEnter={handleTooltipMouseEnter}
            onMouseLeave={handleTooltipMouseLeave}
          >
            {content}
          </div>,
          portalTarget
        )}
    </>
  );
};

export default Tooltip;
