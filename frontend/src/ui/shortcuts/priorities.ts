// Priority levels for keyboard shortcut scopes, contexts, and individual shortcuts.
// This determines which keyboard handler takes precedence when multiple are active.

// Scopes are broad areas of the application where keyboard shortcuts can be active.
export const KeyboardScopePriority = {
  COMMAND_PALETTE: 200,
  SIDEBAR: 120,
  GRIDTABLE_FILTERS: 100,
  GRIDTABLE_BODY: 90,
  SETTINGS_MODAL: 90,
  CONFIRMATION_MODAL: 95,
  ABOUT_MODAL: 85,
  KUBECONFIG_SELECTOR: 80,
  APP_LOGS_PANEL: 60,
  OBJECT_PANEL: 55,
  DIAGNOSTICS_PANEL: 40,
} as const;

// Contexts are subsections within scopes, with their own priority levels.
export const KeyboardContextPriority = {
  COMMAND_PALETTE: 1100,
  SETTINGS_MODAL: 1000,
  CONFIRMATION_MODAL: 950,
  ABOUT_MODAL: 900,
} as const;

// Individual keyboard shortcuts can also have priority levels to resolve conflicts.
export const KeyboardShortcutPriority = {
  COMMAND_PALETTE: 600,
  APP_LOGS_ESCAPE: 30,
  APP_LOGS_ACTION: 15,
  OBJECT_PANEL_ESCAPE: 30,
} as const;
