/**
 * frontend/src/modules/object-map/useObjectMapG6Palette.ts
 *
 * React hook that observes object-map style changes and exposes the G6 palette
 * read from CSS variables.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { ObjectMapG6Palette } from './objectMapG6Data';
import { readObjectMapG6Palette, sameObjectMapG6Palette } from './objectMapG6Palette';

export const useObjectMapG6Palette = (containerRef: RefObject<HTMLElement | null>) => {
  const [palette, setPalette] = useState<ObjectMapG6Palette | null>(null);
  const [styleVersion, setStyleVersion] = useState(0);
  const paletteRef = useRef<ObjectMapG6Palette | null>(null);
  paletteRef.current = palette;

  const refreshPalette = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const nextPalette = readObjectMapG6Palette(container);
    setPalette((previousPalette) =>
      sameObjectMapG6Palette(previousPalette, nextPalette) ? previousPalette : nextPalette
    );
    setStyleVersion((previous) => previous + 1);
  }, [containerRef]);

  useLayoutEffect(() => {
    refreshPalette();
  }, [refreshPalette]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let frame = 0;
    const schedulePaletteRefresh = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(refreshPalette);
    };
    const observer = new MutationObserver(schedulePaletteRefresh);
    const observed = new Set<HTMLElement>([document.documentElement, document.body, container]);
    const objectMapRoot = container.closest<HTMLElement>('.object-map');
    if (objectMapRoot) observed.add(objectMapRoot);
    observed.forEach((element) => {
      observer.observe(element, {
        attributes: true,
        attributeFilter: ['class', 'style', 'data-appearance-mode', 'data-color-scheme'],
      });
    });
    const colorSchemeQuery =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-color-scheme: dark)')
        : null;
    colorSchemeQuery?.addEventListener('change', schedulePaletteRefresh);
    schedulePaletteRefresh();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      colorSchemeQuery?.removeEventListener('change', schedulePaletteRefresh);
    };
  }, [containerRef, refreshPalette]);

  return {
    palette,
    paletteReady: palette !== null,
    paletteRef,
    styleVersion,
  };
};
