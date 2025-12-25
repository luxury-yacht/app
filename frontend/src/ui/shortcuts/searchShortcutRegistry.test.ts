/**
 * frontend/src/ui/shortcuts/searchShortcutRegistry.test.ts
 *
 * Test suite for searchShortcutRegistry.
 * Covers key behaviors and edge cases for searchShortcutRegistry.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  registerSearchShortcutTarget,
  unregisterSearchShortcutTarget,
  focusRegisteredSearchShortcutTarget,
  __clearSearchShortcutTargetsForTest,
} from './searchShortcutRegistry';

describe('searchShortcutRegistry', () => {
  beforeEach(() => {
    __clearSearchShortcutTargetsForTest();
  });

  it('focuses the highest priority active target', () => {
    const lowPriorityFocus = vi.fn();
    const highPriorityFocus = vi.fn();

    registerSearchShortcutTarget({
      isActive: () => true,
      focus: lowPriorityFocus,
      getPriority: () => 1,
      label: 'low',
    });

    registerSearchShortcutTarget({
      isActive: () => true,
      focus: highPriorityFocus,
      getPriority: () => 5,
      label: 'high',
    });

    const handled = focusRegisteredSearchShortcutTarget();
    expect(handled).toBe(true);
    expect(highPriorityFocus).toHaveBeenCalledTimes(1);
    expect(lowPriorityFocus).not.toHaveBeenCalled();
  });

  it('falls back when no active targets exist', () => {
    const focus = vi.fn();
    const id = registerSearchShortcutTarget({
      isActive: () => false,
      focus,
      getPriority: () => 1,
      label: 'inactive',
    });

    const handled = focusRegisteredSearchShortcutTarget();
    expect(handled).toBe(false);
    expect(focus).not.toHaveBeenCalled();

    unregisterSearchShortcutTarget(id);
  });
});
