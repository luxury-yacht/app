import type {
  RegisteredShortcut,
  ShortcutGroup,
  ShortcutHelpRow,
  ShortcutMap,
} from '@/types/shortcuts';
import { getShortcutKey } from './utils';

const CATEGORY_ORDER: Readonly<Record<string, number>> = {
  Navigation: 0,
  Search: 1,
  'Windows & Panels': 2,
  Zoom: 3,
  'Resource Data': 4,
  Tables: 5,
  YAML: 6,
  Logs: 7,
  'Settings & Tools': 8,
};

function compareHelpShortcuts(a: RegisteredShortcut, b: RegisteredShortcut): number {
  return (
    (a.helpOrder ?? Number.MAX_SAFE_INTEGER) - (b.helpOrder ?? Number.MAX_SAFE_INTEGER) ||
    a.description.localeCompare(b.description) ||
    getShortcutKey(a.key, a.modifiers).localeCompare(getShortcutKey(b.key, b.modifiers))
  );
}

export function buildShortcutHelpGroups(shortcuts: ShortcutMap): ShortcutGroup[] {
  const groups = new Map<string, RegisteredShortcut[]>();
  const available = Array.from(shortcuts.values())
    .flat()
    .filter((shortcut) => shortcut.enabled !== false || shortcut.discoverable);

  for (const shortcut of available) {
    const category = shortcut.category || 'General';
    const group = groups.get(category) ?? [];
    group.push(shortcut);
    groups.set(category, group);
  }

  return Array.from(groups.entries())
    .sort(
      ([a], [b]) =>
        (CATEGORY_ORDER[a] ?? Number.MAX_SAFE_INTEGER) -
          (CATEGORY_ORDER[b] ?? Number.MAX_SAFE_INTEGER) || a.localeCompare(b)
    )
    .map(([category, group]) => {
      group.sort(compareHelpShortcuts);
      return {
        category,
        shortcuts: group.map(({ key, modifiers, description }) => ({
          key,
          modifiers,
          description,
        })),
      };
    });
}

/**
 * Collapse a help group's registrations into one row per action. Rows keep
 * the group's help order; a binding registered twice for the same action
 * (for example by two mounted owners) is listed once.
 */
export function buildShortcutHelpRows(group: ShortcutGroup): ShortcutHelpRow[] {
  const rows = new Map<string, ShortcutHelpRow>();
  const seenBindings = new Set<string>();

  for (const { key, modifiers, description } of group.shortcuts) {
    const bindingId = `${description}\u0000${getShortcutKey(key, modifiers)}`;
    if (seenBindings.has(bindingId)) {
      continue;
    }
    seenBindings.add(bindingId);
    const row = rows.get(description) ?? { description, bindings: [] };
    row.bindings.push(modifiers ? { key, modifiers } : { key });
    rows.set(description, row);
  }

  return Array.from(rows.values());
}
