import { useEffect, useRef } from 'react';
import { useShortcuts } from '@ui/shortcuts';

// Coordinates all keyboard shortcuts for GridTable: pushes a shortcut context,
// disables hover when shortcuts/context menu are active, and registers the
// navigation/open/context-menu bindings expected by table users.

// Ref-counted hover suppression to handle multiple GridTable instances.
// The class is only removed when all tables release their hold.
let hoverSuppressionCount = 0;

function acquireHoverSuppression(): void {
  if (typeof document === 'undefined') {
    return;
  }
  hoverSuppressionCount++;
  if (hoverSuppressionCount === 1) {
    document.body.classList.add('gridtable-disable-hover');
  }
}

function releaseHoverSuppression(): void {
  if (typeof document === 'undefined') {
    return;
  }
  hoverSuppressionCount = Math.max(0, hoverSuppressionCount - 1);
  if (hoverSuppressionCount === 0) {
    document.body.classList.remove('gridtable-disable-hover');
  }
}

type UseGridTableShortcutsOptions = {
  shortcutsActive: boolean;
  enableContextMenu: boolean;
  onOpenFocusedRow: () => boolean;
  onOpenContextMenu: () => boolean;
  moveSelectionByDelta: (delta: number) => boolean;
  jumpToIndex: (index: number) => boolean;
  getPageSizeRef: React.RefObject<number>;
  tableDataLength: number;
  pushShortcutContext: (opts: { view: 'list'; tabActive: 'gridtable'; priority: number }) => void;
  popShortcutContext: () => void;
  isContextMenuVisible: boolean;
};

// Centralizes keyboard shortcut wiring and related side effects (context push/pop,
// hover suppression) so GridTable stays lean.
export function useGridTableShortcuts({
  shortcutsActive,
  enableContextMenu,
  onOpenFocusedRow,
  onOpenContextMenu,
  moveSelectionByDelta,
  jumpToIndex,
  getPageSizeRef,
  tableDataLength,
  pushShortcutContext,
  popShortcutContext,
  isContextMenuVisible,
}: UseGridTableShortcutsOptions) {
  const contextActiveRef = useRef(false);

  useEffect(() => {
    if (shortcutsActive === contextActiveRef.current) {
      return;
    }
    if (shortcutsActive) {
      // Push once per focus activation to prevent context churn on re-renders.
      pushShortcutContext({ view: 'list', tabActive: 'gridtable', priority: 400 });
      contextActiveRef.current = true;
      return;
    }
    // Pop on deactivation instead of relying on cleanup to avoid loops.
    popShortcutContext();
    contextActiveRef.current = false;
  }, [popShortcutContext, pushShortcutContext, shortcutsActive]);

  useEffect(() => {
    return () => {
      if (!contextActiveRef.current) {
        return;
      }
      popShortcutContext();
      contextActiveRef.current = false;
    };
  }, [popShortcutContext]);

  // Track whether this instance currently holds a hover suppression lock
  const hasHoverSuppressionRef = useRef(false);

  useEffect(() => {
    const shouldDisableHover = shortcutsActive || isContextMenuVisible;

    if (shouldDisableHover && !hasHoverSuppressionRef.current) {
      // Acquire suppression if we need it and don't have it
      hasHoverSuppressionRef.current = true;
      acquireHoverSuppression();
    } else if (!shouldDisableHover && hasHoverSuppressionRef.current) {
      // Release suppression if we don't need it but have it
      hasHoverSuppressionRef.current = false;
      releaseHoverSuppression();
    }

    return () => {
      // On unmount, release if we're holding
      if (hasHoverSuppressionRef.current) {
        hasHoverSuppressionRef.current = false;
        releaseHoverSuppression();
      }
    };
  }, [isContextMenuVisible, shortcutsActive]);

  // Keep shortcut registrations stable; context activation controls when they fire.
  useShortcuts(
    [
      {
        key: 'ArrowDown',
        handler: () => moveSelectionByDelta(1),
        description: 'Select next row',
      },
      {
        key: 'ArrowUp',
        handler: () => moveSelectionByDelta(-1),
        description: 'Select previous row',
      },
      {
        key: 'PageDown',
        handler: () => moveSelectionByDelta(getPageSizeRef.current),
        description: 'Page down',
      },
      {
        key: 'PageUp',
        handler: () => moveSelectionByDelta(-getPageSizeRef.current),
        description: 'Page up',
      },
      {
        key: 'Home',
        handler: () => jumpToIndex(0),
        description: 'Jump to first row',
      },
      {
        key: 'End',
        handler: () => jumpToIndex(tableDataLength - 1),
        description: 'Jump to last row',
      },
      {
        key: 'Enter',
        handler: onOpenFocusedRow,
        description: 'Open focused row',
      },
      {
        key: ' ',
        handler: onOpenFocusedRow,
        description: 'Open focused row',
      },
      {
        key: 'F10',
        modifiers: { shift: true },
        handler: (event) => {
          event?.preventDefault();
          onOpenContextMenu();
        },
        description: 'Open row context menu',
        enabled: enableContextMenu,
      },
    ],
    {
      view: 'list',
      priority: 400,
      whenTabActive: 'gridtable',
      category: 'Grid Table',
    }
  );
}
