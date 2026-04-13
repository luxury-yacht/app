/**
 * frontend/src/types/shortcuts/index.ts
 *
 * Barrel exports for shortcuts.
 * Re-exports public APIs for the frontend.
 */

// Keyboard shortcut system types

export interface ShortcutModifiers {
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean; // Cmd on Mac, Windows key on Windows
}

export interface ShortcutDefinition {
  key: string; // The key to press (e.g., 's', 'Enter', 'Delete')
  modifiers?: ShortcutModifiers;
  priority?: number; // Higher priority wins in conflicts (default: 0)
  handler: (event?: KeyboardEvent) => void | boolean; // Return false to prevent default
  description: string;
  category?: string; // For grouping in help menu
  enabled?: boolean; // Can be dynamically disabled
}

export interface RegisteredShortcut extends ShortcutDefinition {
  id: string; // Unique identifier for the shortcut
}

// Utility type for shortcut maps
export type ShortcutMap = Map<string, RegisteredShortcut[]>;

// For displaying shortcuts in help
export interface ShortcutGroup {
  category: string;
  shortcuts: Array<{
    key: string;
    modifiers?: ShortcutModifiers;
    description: string;
  }>;
}
