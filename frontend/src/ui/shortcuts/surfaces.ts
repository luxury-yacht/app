import { type RefObject, useEffect, useRef } from 'react';
import { type KeyboardSurfaceOptions, useOptionalKeyboardContext } from './context';

const forwardSurfaceHandler = <Args extends unknown[], Result>(
  enabled: boolean,
  handlerRef: RefObject<((...args: Args) => Result) | undefined>
) => (enabled ? (...args: Args) => handlerRef.current?.(...args) : undefined);

export function useKeyboardSurface(options: KeyboardSurfaceOptions) {
  const keyboardContext = useOptionalKeyboardContext();
  const onKeyDownRef = useRef(options.onKeyDown);
  const onEscapeRef = useRef(options.onEscape);
  const onNativeActionRef = useRef(options.onNativeAction);
  const onApplicationMenuShortcutRef = useRef(options.onApplicationMenuShortcut);
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
    onApplicationMenuShortcut,
  } = options;
  const hasOnKeyDown = !!onKeyDown;
  const hasOnEscape = !!onEscape;
  const hasOnNativeAction = !!onNativeAction;
  const hasOnApplicationMenuShortcut = !!onApplicationMenuShortcut;

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
    onApplicationMenuShortcutRef.current = onApplicationMenuShortcut;
  }, [onApplicationMenuShortcut]);

  useEffect(() => {
    if (!keyboardContext) {
      return;
    }

    if (active === false) {
      return;
    }
    const { registerSurface, unregisterSurface } = keyboardContext;

    const surfaceOptions: KeyboardSurfaceOptions = {
      kind,
      rootRef,
      active,
      priority,
      blocking,
      captureWhenActive,
      suppressShortcuts,
      onKeyDown: forwardSurfaceHandler(hasOnKeyDown, onKeyDownRef),
      onEscape: forwardSurfaceHandler(hasOnEscape, onEscapeRef),
      onNativeAction: forwardSurfaceHandler(hasOnNativeAction, onNativeActionRef),
      onApplicationMenuShortcut: forwardSurfaceHandler(
        hasOnApplicationMenuShortcut,
        onApplicationMenuShortcutRef
      ),
    };

    const surfaceId = registerSurface(surfaceOptions);
    return () => unregisterSurface(surfaceId);
  }, [
    active,
    blocking,
    captureWhenActive,
    hasOnEscape,
    hasOnKeyDown,
    hasOnNativeAction,
    hasOnApplicationMenuShortcut,
    kind,
    keyboardContext,
    priority,
    rootRef,
    suppressShortcuts,
  ]);
}
