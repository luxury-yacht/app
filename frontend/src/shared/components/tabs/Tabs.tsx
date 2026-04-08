/**
 * frontend/src/shared/components/tabs/Tabs.tsx
 *
 * Universal tab strip base component. Owns rendering, ARIA roles,
 * manual-activation keyboard navigation, sizing, overflow scrolling,
 * and the close-button overlay. Knows nothing about drag, persistence,
 * or system-specific quirks — those live in wrapper components.
 *
 * See docs/plans/shared-tabs-component-design.md for the full design.
 */
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';

export interface TabDescriptor {
  id: string;
  label: ReactNode;
  leading?: ReactNode;
  onClose?: () => void;
  disabled?: boolean;
  ariaControls?: string;
  ariaLabel?: string;
  extraProps?: HTMLAttributes<HTMLButtonElement>;
}

// Keys owned by the base Tabs component. Wrappers must not override these via
// extraProps — if they do, we warn in dev so the bug gets caught early. The
// spread order in the JSX ensures the base's values still win at the DOM level
// even when a warning fires, so ARIA stays correct in production.
const RESERVED_TAB_KEYS = new Set([
  'role',
  'aria-selected',
  'aria-controls',
  'aria-disabled',
  'aria-label',
  'tabIndex',
  'id',
  'onClick',
  'onKeyDown',
]);

function warnReservedKeys(
  tabId: string,
  extraProps: HTMLAttributes<HTMLButtonElement> | undefined
) {
  if (process.env.NODE_ENV === 'production' || !extraProps) return;
  for (const key of Object.keys(extraProps)) {
    if (RESERVED_TAB_KEYS.has(key)) {
      console.warn(
        `<Tabs>: tab "${tabId}" extraProps overrode reserved key "${key}". The base owns this prop. Drop it from extraProps.`
      );
    }
  }
}

export interface TabsProps {
  tabs: TabDescriptor[];
  activeId: string | null;
  onActivate: (id: string) => void;
  'aria-label': string;
  textTransform?: 'none' | 'uppercase';
  tabSizing?: 'fit' | 'equal';
  minTabWidth?: number;
  maxTabWidth?: number;
  overflow?: 'scroll' | 'none';
  className?: string;
  id?: string;
}

export function Tabs({
  tabs,
  activeId,
  onActivate,
  'aria-label': ariaLabel,
  textTransform = 'none',
  tabSizing = 'fit',
  minTabWidth,
  maxTabWidth = 240,
  overflow = 'scroll',
  className: classNameProp,
  id,
}: TabsProps) {
  // Mode-specific default for minTabWidth: 'fit' should size to content
  // (no floor) so short labels like "YAML" don't get bloated; 'equal' needs
  // a floor so tabs sharing a strip don't collapse below readable width.
  // Closeable tabs in 'fit' mode get their own 80px floor via tabs.css to
  // ensure room for the close button overlay.
  const effectiveMinTabWidth = minTabWidth ?? (tabSizing === 'equal' ? 80 : 0);
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const scrollRef = useRef<HTMLDivElement>(null);
  // Single boolean: once the strip overflows, BOTH indicators render. Not
  // tracked per-side. Keeping both mounted at the same time guarantees tab
  // positions are stable across clicks, which makes the scroll math
  // straightforward (no layout shifts to compensate for).
  const [hasOverflow, setHasOverflow] = useState(false);
  // Track whether the strip is scrolled to either extreme so the
  // corresponding chevron can be greyed out.
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);
  // Pending scroll target: while an animation is in flight, hold its
  // destination so rapid clicks can compute the next target from where
  // we're *going* rather than from the intermediate scrollLeft. Cleared
  // by the animation callback itself when the animation finishes.
  const pendingScrollTargetRef = useRef<number | null>(null);
  // Manual rAF animation frame id. We animate scrollLeft ourselves
  // instead of using `scrollTo({ behavior: 'smooth' })` because Firefox's
  // smooth scroll can leave the animation incomplete when interrupted by
  // rapid subsequent calls, stranding scrollLeft at an intermediate
  // value. Manual rAF gives consistent cross-browser behavior.
  const animationFrameRef = useRef<number | null>(null);

  // Scroll one tab at a time when the user clicks an overflow indicator.
  // Both indicators are always present when the strip overflows, so the
  // first tab is always at offsetLeft = indicatorSize and positions never
  // shift between clicks. Find the first tab clipped on the relevant side
  // and scroll so it just clears the indicator.
  const scrollToNextTab = (direction: -1 | 1) => {
    const bar = scrollRef.current;
    if (!bar) return;
    const indicatorSize =
      parseFloat(getComputedStyle(bar).getPropertyValue('--tab-strip-overflow-indicator-size')) ||
      32;

    // If a smooth scroll is already in flight, compute the next target
    // from its destination instead of the intermediate scrollLeft. That
    // makes rapid clicks cumulative: N clicks always advance N tabs.
    const maxScrollLeft = Math.max(0, bar.scrollWidth - bar.clientWidth);
    const barLeft =
      pendingScrollTargetRef.current !== null
        ? Math.max(0, Math.min(maxScrollLeft, pendingScrollTargetRef.current))
        : bar.scrollLeft;
    const barRight = barLeft + bar.clientWidth;
    let target: HTMLButtonElement | null = null;

    if (direction === 1) {
      // First tab whose right edge is hidden past the right indicator.
      for (const tab of tabs) {
        const btn = tabRefs.current.get(tab.id);
        if (!btn) continue;
        if (btn.offsetLeft + btn.offsetWidth > barRight - indicatorSize + 1) {
          target = btn;
          break;
        }
      }
    } else {
      // Last tab whose left edge is hidden before the left indicator.
      for (let i = tabs.length - 1; i >= 0; i--) {
        const btn = tabRefs.current.get(tabs[i].id);
        if (!btn) continue;
        if (btn.offsetLeft < barLeft + indicatorSize - 1) {
          target = btn;
          break;
        }
      }
    }
    if (!target) return;

    const rawTarget =
      direction === 1
        ? target.offsetLeft + target.offsetWidth - bar.clientWidth + indicatorSize
        : target.offsetLeft - indicatorSize;
    const scrollTarget = Math.max(0, Math.min(maxScrollLeft, rawTarget));
    pendingScrollTargetRef.current = scrollTarget;
    animateScrollTo(scrollTarget);
  };

  // Manually animate bar.scrollLeft to `target` over ~250ms using rAF and
  // an ease-out-cubic curve. If called again mid-animation, the existing
  // frame is cancelled and a fresh animation starts from the current
  // scrollLeft to the new target. Clears pendingScrollTargetRef when the
  // animation finishes so subsequent clicks compute fresh from the live
  // scrollLeft.
  const animateScrollTo = (target: number) => {
    const bar = scrollRef.current;
    if (!bar) return;

    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    const DURATION_MS = 250;
    const startTime = performance.now();
    const startScroll = bar.scrollLeft;
    const delta = target - startScroll;
    if (Math.abs(delta) < 0.5) {
      pendingScrollTargetRef.current = null;
      return;
    }

    const step = (now: number) => {
      const progress = Math.min(1, (now - startTime) / DURATION_MS);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - progress, 3);
      bar.scrollLeft = startScroll + delta * eased;
      if (progress < 1) {
        animationFrameRef.current = requestAnimationFrame(step);
      } else {
        animationFrameRef.current = null;
        pendingScrollTargetRef.current = null;
      }
    };
    animationFrameRef.current = requestAnimationFrame(step);
  };

  const focusFirstEnabled = () => {
    const idx = tabs.findIndex((t) => !t.disabled);
    if (idx >= 0) tabRefs.current.get(tabs[idx].id)?.focus();
  };

  const focusLastEnabled = () => {
    for (let i = tabs.length - 1; i >= 0; i--) {
      if (!tabs[i].disabled) {
        tabRefs.current.get(tabs[i].id)?.focus();
        return;
      }
    }
  };

  const focusNextEnabled = (currentIndex: number, direction: 1 | -1) => {
    if (tabs.length === 0) return;
    let next = currentIndex;
    for (let i = 0; i < tabs.length; i++) {
      next = (((next + direction) % tabs.length) + tabs.length) % tabs.length;
      if (!tabs[next].disabled) {
        tabRefs.current.get(tabs[next].id)?.focus();
        return;
      }
    }
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        focusNextEnabled(currentIndex, 1);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        focusNextEnabled(currentIndex, -1);
        break;
      case 'Home':
        event.preventDefault();
        focusFirstEnabled();
        break;
      case 'End':
        event.preventDefault();
        focusLastEnabled();
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (!tabs[currentIndex].disabled) {
          onActivate(tabs[currentIndex].id);
        }
        break;
      case 'Delete':
      case 'Backspace':
        if (tabs[currentIndex].onClose) {
          event.preventDefault();
          tabs[currentIndex].onClose?.();
        }
        break;
    }
  };

  // Measure overflow whenever the strip size or contents change, and
  // update the at-start/at-end flags on scroll so the chevrons can grey
  // out at the extremes.
  useEffect(() => {
    if (overflow !== 'scroll' || !scrollRef.current) {
      setHasOverflow(false);
      setAtStart(true);
      setAtEnd(false);
      return;
    }

    const el = scrollRef.current;
    const measure = () => {
      const max = el.scrollWidth - el.clientWidth;
      setHasOverflow(max > 1);
      setAtStart(el.scrollLeft <= 0);
      setAtEnd(el.scrollLeft >= max - 1);
    };

    measure();
    // ResizeObserver is a global in browsers; in environments without it
    // (e.g. jsdom without a mock) fall back to a one-shot measurement.
    const RO: typeof ResizeObserver | undefined = (globalThis as any).ResizeObserver;
    const observer = RO ? new RO(measure) : null;
    observer?.observe(el);
    el.addEventListener('scroll', measure);
    return () => {
      observer?.disconnect();
      el.removeEventListener('scroll', measure);
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [overflow, tabs]);

  // Auto-scroll the active tab into view when activeId changes (e.g., the
  // consumer programmatically activates a tab that's currently scrolled
  // off-screen).
  useEffect(() => {
    if (overflow !== 'scroll' || !activeId) return;
    const el = tabRefs.current.get(activeId);
    if (typeof el?.scrollIntoView === 'function') {
      el.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
    }
  }, [activeId, overflow]);

  const rootClassName = [
    'tab-strip',
    `tab-strip--sizing-${tabSizing}`,
    textTransform === 'uppercase' ? 'tab-strip--uppercase' : null,
    classNameProp || null,
  ]
    .filter(Boolean)
    .join(' ');

  const style = {
    '--tab-item-min-width': `${effectiveMinTabWidth}px`,
    '--tab-item-max-width': `${maxTabWidth}px`,
  } as CSSProperties;

  const showIndicators = overflow === 'scroll' && hasOverflow;

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      ref={scrollRef}
      className={rootClassName}
      style={style}
      id={id}
    >
      {showIndicators && (
        <button
          type="button"
          className="tab-strip__overflow-indicator tab-strip__overflow-indicator--left"
          aria-label="Scroll tabs left"
          tabIndex={-1}
          disabled={atStart}
          onClick={() => scrollToNextTab(-1)}
        >
          <svg
            className="tab-strip__overflow-icon"
            viewBox="0 0 12 12"
            fill="none"
            aria-hidden="true"
          >
            <path d="M7.5 2.5L4.5 6L7.5 9.5" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        </button>
      )}
      {tabs.map((tab, index) => {
        const isActive = tab.id === activeId;
        const isCloseable = Boolean(tab.onClose);
        warnReservedKeys(tab.id, tab.extraProps);
        return (
          <button
            key={tab.id}
            ref={(el) => {
              if (el) {
                tabRefs.current.set(tab.id, el);
              } else {
                tabRefs.current.delete(tab.id);
              }
            }}
            {...tab.extraProps}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-controls={tab.ariaControls}
            aria-disabled={tab.disabled || undefined}
            aria-label={tab.ariaLabel}
            tabIndex={isActive ? 0 : -1}
            className={`tab-item${isActive ? ' tab-item--active' : ''}${isCloseable ? ' tab-item--closeable' : ''}`}
            onClick={() => {
              if (!tab.disabled) {
                onActivate(tab.id);
              }
            }}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            {tab.leading}
            <span className="tab-item__label">{tab.label}</span>
            {tab.onClose && (
              <span
                className="tab-item__close"
                role="button"
                aria-label="Close"
                tabIndex={-1}
                onClick={(event) => {
                  event.stopPropagation();
                  tab.onClose?.();
                }}
              >
                ×
              </span>
            )}
          </button>
        );
      })}
      {showIndicators && (
        <button
          type="button"
          className="tab-strip__overflow-indicator tab-strip__overflow-indicator--right"
          aria-label="Scroll tabs right"
          tabIndex={-1}
          disabled={atEnd}
          onClick={() => scrollToNextTab(1)}
        >
          <svg
            className="tab-strip__overflow-icon"
            viewBox="0 0 12 12"
            fill="none"
            aria-hidden="true"
          >
            <path d="M4.5 2.5L7.5 6L4.5 9.5" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        </button>
      )}
    </div>
  );
}

/**
 * Backward-compat shim. The previous shared tabs module exposed a no-op
 * `useTabStyles` hook (see `frontend/src/shared/components/tabs/Tabs/index.tsx`).
 * Creating this `Tabs.tsx` shadowed the old `Tabs/index.tsx` directory in
 * module resolution, so any consumer importing `useTabStyles` from
 * `@shared/components/tabs/Tabs` ends up here. Re-export the no-op so the
 * old consumers compile until Phase 2 migrates them off the legacy import.
 */
export const useTabStyles = (): boolean => true;
