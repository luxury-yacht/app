import { useEffect, useRef } from 'react';
import { useOptionalKeyboardContext, type KeyboardSurfaceOptions } from './context';

export function useKeyboardSurface(options: KeyboardSurfaceOptions) {
  const keyboardContext = useOptionalKeyboardContext();
  const surfaceIdRef = useRef<string | null>(null);
  const {
    kind,
    rootRef,
    active,
    priority,
    blocking,
    captureWhenActive,
    suppressShortcuts,
    onKeyDown,
    onEscape,
    onNativeAction,
  } = options;

  useEffect(() => {
    if (!keyboardContext) {
      return;
    }

    const { registerSurface, unregisterSurface, updateSurface } = keyboardContext;

    if (active === false) {
      if (surfaceIdRef.current) {
        unregisterSurface(surfaceIdRef.current);
        surfaceIdRef.current = null;
      }
      return;
    }

    const surfaceOptions: KeyboardSurfaceOptions = {
      kind,
      rootRef,
      active,
      priority,
      blocking,
      captureWhenActive,
      suppressShortcuts,
      onKeyDown,
      onEscape,
      onNativeAction,
    };

    if (!surfaceIdRef.current) {
      surfaceIdRef.current = registerSurface(surfaceOptions);
    } else {
      updateSurface(surfaceIdRef.current, surfaceOptions);
    }

    return () => {
      if (surfaceIdRef.current) {
        unregisterSurface(surfaceIdRef.current);
        surfaceIdRef.current = null;
      }
    };
  }, [
    active,
    blocking,
    captureWhenActive,
    kind,
    keyboardContext,
    onEscape,
    onKeyDown,
    onNativeAction,
    priority,
    rootRef,
    suppressShortcuts,
  ]);
}
