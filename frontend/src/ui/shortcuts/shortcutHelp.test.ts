import { describe, expect, it } from 'vitest';
import { buildShortcutHelpRows } from './shortcutHelp';

describe('buildShortcutHelpRows', () => {
  it('shows each action once, listing every distinct binding in help order', () => {
    const rows = buildShortcutHelpRows({
      category: 'Tables',
      shortcuts: [
        { key: 'Enter', description: 'Open focused row' },
        { key: 'ArrowDown', description: 'Select next row' },
        { key: ' ', description: 'Open focused row' },
        // A second mounted owner can register the same binding again.
        { key: 'ArrowDown', description: 'Select next row' },
        { key: 's', modifiers: { meta: true }, description: 'Save YAML changes' },
        { key: 's', modifiers: { ctrl: true }, description: 'Save YAML changes' },
      ],
    });

    expect(rows).toEqual([
      { description: 'Open focused row', bindings: [{ key: 'Enter' }, { key: ' ' }] },
      { description: 'Select next row', bindings: [{ key: 'ArrowDown' }] },
      {
        description: 'Save YAML changes',
        bindings: [
          { key: 's', modifiers: { meta: true } },
          { key: 's', modifiers: { ctrl: true } },
        ],
      },
    ]);
  });
});
