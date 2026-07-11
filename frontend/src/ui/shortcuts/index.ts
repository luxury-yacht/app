/**
 * frontend/src/ui/shortcuts/index.ts
 *
 * Barrel exports for shortcuts.
 * Re-exports public APIs for the UI layer.
 */

export { GlobalShortcuts } from './components/GlobalShortcuts';
// Main exports for keyboard/shortcut module
export { KeyboardProvider, useKeyboardContext } from './context';
export { useShortcut, useShortcuts } from './hooks';
export { useKeyboardSurface } from './surfaces';
export { useSearchShortcutTarget } from './useSearchShortcutTarget';
