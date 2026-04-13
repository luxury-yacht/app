/**
 * frontend/src/ui/layout/DebugOverlay.tsx
 *
 * Shared floating debug overlay shell.
 * Portals to document.body and stays isolated from the app layout so debug
 * tooling can be dragged, resized, selected, and inspected without affecting
 * the rest of the app.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CloseIcon } from '@shared/components/icons/MenuIcons';
import './DebugOverlay.css';

interface DebugOverlayProps {
  title: string;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  testId?: string;
  overlayRef?: React.Ref<HTMLDivElement>;
  onClose?: () => void;
}

type OverlayLayout = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const DEBUG_OVERLAY_MIN_WIDTH = 320;
const DEBUG_OVERLAY_MIN_HEIGHT = 180;
const DEBUG_OVERLAY_BASE_Z_INDEX = 20000;

let topDebugOverlayZIndex = DEBUG_OVERLAY_BASE_Z_INDEX;

const nextDebugOverlayZIndex = () => {
  topDebugOverlayZIndex += 1;
  return topDebugOverlayZIndex;
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const getViewportSize = () => ({
  width: typeof window === 'undefined' ? 1440 : window.innerWidth,
  height: typeof window === 'undefined' ? 900 : window.innerHeight,
});

const getDefaultLayout = (testId?: string): OverlayLayout => {
  const viewport = getViewportSize();
  const width = clamp(Math.round(viewport.width * 0.28), 360, 520);
  const height = clamp(Math.round(viewport.height * 0.42), 280, 520);

  const defaults: Record<string, { x: number; y: number }> = {
    'panel-debug-overlay': { x: 40, y: 90 },
    'keyboard-focus-overlay': { x: 440, y: 90 },
    'error-debug-overlay': { x: 840, y: 90 },
  };

  const fallback = { x: 80, y: 80 };
  const origin = (testId && defaults[testId]) || fallback;

  return {
    x: clamp(origin.x, 12, Math.max(12, viewport.width - width - 12)),
    y: clamp(origin.y, 12, Math.max(12, viewport.height - height - 12)),
    width,
    height,
  };
};

type PointerInteraction =
  | {
      kind: 'drag';
      pointerId: number;
      startX: number;
      startY: number;
      layout: OverlayLayout;
    }
  | {
      kind: 'resize';
      pointerId: number;
      startX: number;
      startY: number;
      layout: OverlayLayout;
    };

export const DebugOverlay: React.FC<DebugOverlayProps> = ({
  title,
  children,
  className,
  bodyClassName,
  testId,
  overlayRef,
  onClose,
}) => {
  const [isMounted, setIsMounted] = useState(false);
  const [layout, setLayout] = useState<OverlayLayout>(() => getDefaultLayout(testId));
  const [zIndex, setZIndex] = useState(() => nextDebugOverlayZIndex());
  const interactionRef = useRef<PointerInteraction | null>(null);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const interaction = interactionRef.current;
      if (!interaction) {
        return;
      }

      const viewport = getViewportSize();

      if (interaction.kind === 'drag') {
        setLayout((current) => {
          const nextX = clamp(
            interaction.layout.x + (event.clientX - interaction.startX),
            0,
            Math.max(0, viewport.width - current.width)
          );
          const nextY = clamp(
            interaction.layout.y + (event.clientY - interaction.startY),
            0,
            Math.max(0, viewport.height - current.height)
          );
          return { ...current, x: nextX, y: nextY };
        });
        return;
      }

      if (interaction.kind === 'resize') {
        setLayout({
          ...interaction.layout,
          width: clamp(
            interaction.layout.width + (event.clientX - interaction.startX),
            DEBUG_OVERLAY_MIN_WIDTH,
            Math.max(DEBUG_OVERLAY_MIN_WIDTH, viewport.width - interaction.layout.x)
          ),
          height: clamp(
            interaction.layout.height + (event.clientY - interaction.startY),
            DEBUG_OVERLAY_MIN_HEIGHT,
            Math.max(DEBUG_OVERLAY_MIN_HEIGHT, viewport.height - interaction.layout.y)
          ),
        });
      }
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (interactionRef.current?.pointerId !== event.pointerId) {
        return;
      }
      interactionRef.current = null;
    };

    const handleResize = () => {
      const viewport = getViewportSize();
      setLayout((current) => ({
        width: Math.min(current.width, Math.max(DEBUG_OVERLAY_MIN_WIDTH, viewport.width - 12)),
        height: Math.min(current.height, Math.max(DEBUG_OVERLAY_MIN_HEIGHT, viewport.height - 12)),
        x: clamp(current.x, 0, Math.max(0, viewport.width - current.width)),
        y: clamp(current.y, 0, Math.max(0, viewport.height - current.height)),
      }));
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  const bringToFront = () => {
    setZIndex(nextDebugOverlayZIndex());
  };

  const startInteraction = (
    event: React.PointerEvent<HTMLElement>,
    kind: PointerInteraction['kind']
  ) => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    bringToFront();
    interactionRef.current = {
      kind,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      layout,
    };
  };

  const overlayClassName = useMemo(
    () => (className ? `debug-overlay-window ${className}` : 'debug-overlay-window'),
    [className]
  );
  const resolvedBodyClassName = bodyClassName
    ? `debug-overlay__body ${bodyClassName}`
    : 'debug-overlay__body';

  if (!isMounted || typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div className="debug-overlay-layer">
      <div
        ref={(node) => {
          if (typeof overlayRef === 'function') {
            overlayRef(node);
          } else if (overlayRef && 'current' in overlayRef) {
            (overlayRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
          }
        }}
        className={overlayClassName}
        data-testid={testId}
        style={{
          left: `${layout.x}px`,
          top: `${layout.y}px`,
          width: `${layout.width}px`,
          height: `${layout.height}px`,
          zIndex,
        }}
        onPointerDown={bringToFront}
      >
        <div
          className="debug-overlay__header"
          onPointerDown={(event) => startInteraction(event, 'drag')}
        >
          <span className="debug-overlay__title">{title}</span>
          {onClose ? (
            <button
              type="button"
              className="debug-overlay__close"
              onClick={onClose}
              aria-label="Close debug overlay"
              title="Close"
            >
              <CloseIcon width={14} height={14} />
            </button>
          ) : null}
        </div>
        <div className={resolvedBodyClassName}>{children}</div>
        <div
          className="debug-overlay__resize-handle"
          onPointerDown={(event) => startInteraction(event, 'resize')}
          role="separator"
          aria-label="Resize debug overlay"
        />
      </div>
    </div>,
    document.body
  );
};
