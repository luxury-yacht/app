/**
 * frontend/src/ui/shortcuts/index.ts
 *
 * Barrel exports for shortcuts.
 * Re-exports public APIs for the UI layer.
 */

// Main exports for keyboard/shortcut module
export { KeyboardProvider, useKeyboardContext } from './context';
export { useShortcut, useShortcuts } from './hooks';
export { GlobalShortcuts } from './components/GlobalShortcuts';
export { useSearchShortcutTarget } from './useSearchShortcutTarget';
export { useKeyboardNavigationScope } from './keyboardNavigationContext';
