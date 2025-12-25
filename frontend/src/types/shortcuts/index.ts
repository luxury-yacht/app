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

export type ViewContext =
  | 'global'
  | 'logs'
  | 'details'
  | 'events'
  | 'yaml'
  | 'list'
  | 'settings'
  | 'object-panel';

export type ResourceContext =
  | 'pods'
  | 'deployments'
  | 'services'
  | 'configmaps'
  | 'secrets'
  | 'nodes'
  | '*'; // Any resource

export interface ShortcutContext {
  view?: ViewContext;
  resourceKind?: ResourceContext;
  objectKind?: string; // Type of object being viewed (e.g., 'secret', 'pod')
  panelOpen?: 'object' | 'logs' | 'settings';
  tabActive?: string; // Active tab within a panel
  priority?: number; // Higher priority wins in conflicts (default: 0)
}

export interface ShortcutDefinition {
  key: string; // The key to press (e.g., 's', 'Enter', 'Delete')
  modifiers?: ShortcutModifiers;
  contexts: ShortcutContext[];
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
