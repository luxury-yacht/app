/**
 * frontend/src/ui/shortcuts/searchShortcutRegistry.ts
 *
 * Module source for searchShortcutRegistry.
 * Implements searchShortcutRegistry logic for the UI layer.
 */

type SearchShortcutEntry = {
  id: string;
  label?: string;
  isActive: () => boolean;
  focus: () => void;
  getPriority: () => number;
  registeredAt: number;
};

const searchShortcutTargets = new Map<string, SearchShortcutEntry>();
let searchShortcutCounter = 0;

interface RegisterSearchShortcutOptions {
  label?: string;
  isActive: () => boolean;
  focus: () => void;
  getPriority?: () => number;
}

export function registerSearchShortcutTarget({
  label,
  isActive,
  focus,
  getPriority,
}: RegisterSearchShortcutOptions): string {
  const id = `search-shortcut-${++searchShortcutCounter}`;
  searchShortcutTargets.set(id, {
    id,
    label,
    isActive,
    focus,
    getPriority: getPriority ?? (() => 0),
    registeredAt: Date.now(),
  });
  return id;
}

export function unregisterSearchShortcutTarget(id: string | null | undefined) {
  if (!id) {
    return;
  }
  searchShortcutTargets.delete(id);
}

export function focusRegisteredSearchShortcutTarget(): boolean {
  let best: SearchShortcutEntry | null = null;

  for (const entry of searchShortcutTargets.values()) {
    if (!entry.isActive()) {
      continue;
    }

    if (!best) {
      best = entry;
      continue;
    }

    const entryPriority = entry.getPriority();
    const bestPriority = best.getPriority();

    if (entryPriority > bestPriority) {
      best = entry;
      continue;
    }

    if (entryPriority === bestPriority && entry.registeredAt > best.registeredAt) {
      best = entry;
    }
  }

  if (best) {
    best.focus();
    return true;
  }

  return false;
}

// Test helpers
export function __clearSearchShortcutTargetsForTest() {
  searchShortcutTargets.clear();
}
