/**
 * frontend/src/shared/components/tables/hooks/useGridTableShortcuts.ts
 *
 * React hook for useGridTableShortcuts.
 * Encapsulates state and side effects for the shared components.
 */

import { useShortcuts } from '@ui/shortcuts';
import { useEffect, useRef } from 'react';
import { isMacPlatform } from '@/utils/platform';

// Coordinates all keyboard shortcuts for GridTable, disables hover when
// shortcuts/context menu are active, and registers the navigation/open/
// context-menu bindings expected by table users.

// Set-based hover suppression to handle multiple GridTable instances.
// The class is only removed when all tables release their hold.
// Using a Set of instance IDs instead of an integer counter prevents
// desync on HMR, where the module re-evaluates but active instances
// from the previous module may not have cleaned up.
const hoverSuppressors = new Set<symbol>();

function acquireHoverSuppression(id: symbol): void {
  if (typeof document === 'undefined') {
    return;
  }
  hoverSuppressors.add(id);
  if (hoverSuppressors.size === 1) {
    document.body.classList.add('gridtable-disable-hover');
  }
}

function releaseHoverSuppression(id: symbol): void {
  if (typeof document === 'undefined') {
    return;
  }
  hoverSuppressors.delete(id);
  if (hoverSuppressors.size === 0) {
    document.body.classList.remove('gridtable-disable-hover');
  }
}

type UseGridTableShortcutsOptions = {
  shortcutsActive: boolean;
  enableContextMenu: boolean;
  onOpenFocusedRow: () => boolean;
  /** Space's only action; without it the shortcut is off and Space does nothing. */
  onToggleFocusedRow?: () => boolean;
  onOpenContextMenu: () => boolean;
  /** One row up or down in screen order (into and out of expanded row details). */
  moveRow: (delta: 1 | -1) => boolean;
  /** Up or down a page of this table's rows. */
  moveSelectionByDelta: (delta: number) => boolean;
  jumpToStart: () => boolean;
  jumpToEnd: () => boolean;
  /** The next or previous row of the top table, skipping expanded tables. */
  moveParentRow?: (delta: 1 | -1) => boolean;
  getPageSizeRef: React.RefObject<number>;
  isContextMenuVisible: boolean;
  // Page navigation for paginated tables. Ctrl+Arrow is used off macOS and
  // Command+Arrow on macOS, leaving plain arrows to horizontal scrolling.
  // False can-flags leave even the modified shortcut unhandled.
  onPagePrevious?: () => void;
  onPageNext?: () => void;
  canPagePrevious?: boolean;
  canPageNext?: boolean;
};

// Centralizes keyboard shortcut wiring and related side effects (hover
// suppression) so GridTable stays lean.
export function useGridTableShortcuts({
  shortcutsActive,
  enableContextMenu,
  onOpenFocusedRow,
  onToggleFocusedRow,
  onOpenContextMenu,
  moveRow,
  moveSelectionByDelta,
  jumpToStart,
  jumpToEnd,
  moveParentRow,
  getPageSizeRef,
  isContextMenuVisible,
  onPagePrevious,
  onPageNext,
  canPagePrevious = false,
  canPageNext = false,
}: UseGridTableShortcutsOptions) {
  // Stable identity for this hook instance, used by the hover suppression Set.
  const suppressionIdRef = useRef<symbol | null>(null);
  if (!suppressionIdRef.current) {
    suppressionIdRef.current = Symbol('grid-hover-suppressor');
  }
  const suppressionId = suppressionIdRef.current;
  const pageNavigationModifiers = isMacPlatform() ? { meta: true } : { ctrl: true };

  useEffect(() => {
    const shouldDisableHover = shortcutsActive || isContextMenuVisible;

    if (shouldDisableHover) {
      acquireHoverSuppression(suppressionId);
    } else {
      releaseHoverSuppression(suppressionId);
    }

    return () => {
      releaseHoverSuppression(suppressionId);
    };
  }, [isContextMenuVisible, shortcutsActive, suppressionId]);

  // Keep shortcut registrations stable; context activation controls when they fire.
  useShortcuts(
    [
      {
        key: 'ArrowDown',
        handler: () => moveRow(1),
        description: 'Select next row',
        helpOrder: 10,
      },
      {
        key: 'ArrowUp',
        handler: () => moveRow(-1),
        description: 'Select previous row',
        helpOrder: 11,
      },
      {
        key: 'ArrowDown',
        modifiers: { alt: true },
        handler: () => moveParentRow?.(1) ?? false,
        description: 'Next row, skipping expanded tables',
        helpOrder: 12,
        enabled: Boolean(moveParentRow),
      },
      {
        key: 'ArrowUp',
        modifiers: { alt: true },
        handler: () => moveParentRow?.(-1) ?? false,
        description: 'Previous row, skipping expanded tables',
        helpOrder: 13,
        enabled: Boolean(moveParentRow),
      },
      {
        key: 'PageDown',
        handler: () => moveSelectionByDelta(getPageSizeRef.current),
        description: 'Page down',
        helpOrder: 30,
      },
      {
        key: 'PageUp',
        handler: () => moveSelectionByDelta(-getPageSizeRef.current),
        description: 'Page up',
        helpOrder: 31,
      },
      {
        key: 'Home',
        handler: jumpToStart,
        description: 'Jump to first row',
        helpOrder: 20,
      },
      {
        key: 'End',
        handler: jumpToEnd,
        description: 'Jump to last row',
        helpOrder: 21,
      },
      {
        key: 'Enter',
        handler: onOpenFocusedRow,
        description: 'Open focused row',
        helpOrder: 50,
      },
      {
        key: ' ',
        handler: () => onToggleFocusedRow?.() ?? false,
        description: 'Expand or collapse focused row',
        helpOrder: 51,
        enabled: Boolean(onToggleFocusedRow),
      },
      {
        key: 'F10',
        modifiers: { shift: true },
        handler: (event) => {
          event?.preventDefault();
          onOpenContextMenu();
        },
        description: 'Open row context menu',
        helpOrder: 60,
        enabled: enableContextMenu,
      },
      {
        key: 'ArrowLeft',
        modifiers: pageNavigationModifiers,
        handler: () => {
          if (!onPagePrevious || !canPagePrevious) {
            return false;
          }
          onPagePrevious();
          return true;
        },
        description: 'Previous page',
        helpOrder: 40,
        enabled: Boolean(onPagePrevious),
      },
      {
        key: 'ArrowRight',
        modifiers: pageNavigationModifiers,
        handler: () => {
          if (!onPageNext || !canPageNext) {
            return false;
          }
          onPageNext();
          return true;
        },
        description: 'Next page',
        helpOrder: 41,
        enabled: Boolean(onPageNext),
      },
    ],
    {
      enabled: shortcutsActive,
      priority: 400,
      category: 'Tables',
    }
  );
}
