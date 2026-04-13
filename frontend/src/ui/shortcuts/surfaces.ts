import { useEffect, useRef } from 'react';
import { useOptionalKeyboardContext, type KeyboardSurfaceOptions } from './context';

export function useKeyboardSurface(options: KeyboardSurfaceOptions) {
  const keyboardContext = useOptionalKeyboardContext();
  const surfaceIdRef = useRef<string | null>(null);
  const onKeyDownRef = useRef(options.onKeyDown);
  const onEscapeRef = useRef(options.onEscape);
  const onNativeActionRef = useRef(options.onNativeAction);
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
  const hasOnKeyDown = !!onKeyDown;
  const hasOnEscape = !!onEscape;
  const hasOnNativeAction = !!onNativeAction;

  useEffect(() => {
    onKeyDownRef.current = onKeyDown;
  }, [onKeyDown]);

  useEffect(() => {
    onEscapeRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    onNativeActionRef.current = onNativeAction;
  }, [onNativeAction]);

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
      onKeyDown: hasOnKeyDown ? (event) => onKeyDownRef.current?.(event) : undefined,
      onEscape: hasOnEscape ? (event) => onEscapeRef.current?.(event) : undefined,
      onNativeAction: hasOnNativeAction
        ? (context) => onNativeActionRef.current?.(context)
        : undefined,
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
    hasOnEscape,
    hasOnKeyDown,
    hasOnNativeAction,
    kind,
    keyboardContext,
    priority,
    rootRef,
    suppressShortcuts,
  ]);
}
