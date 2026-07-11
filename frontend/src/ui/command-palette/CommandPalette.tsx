/**
 * frontend/src/ui/command-palette/CommandPalette.tsx
 *
 * Module source for CommandPalette.
 * Implements CommandPalette logic for the UI layer.
 */

import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { ErrorBoundary } from '@shared/components/errors/ErrorBoundary';
import { getKindColorClass } from '@shared/utils/kindBadgeColors';
import { buildRequiredObjectReference } from '@shared/utils/objectIdentity';
import { withStableListKeys } from '@shared/utils/stableListKeys';
import { useKeyboardContext, useShortcut, useShortcuts } from '@ui/shortcuts';
import { KeyboardShortcutPriority } from '@ui/shortcuts/priorities';
import { useKeyboardSurface } from '@ui/shortcuts/surfaces';
import { EventsOn } from '@wailsjs/runtime/runtime';
import type React from 'react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEventBus } from '@/core/events';
import { fetchSnapshot } from '@/core/refresh/client';
import { buildClusterScope } from '@/core/refresh/clusterScope';
import type { CatalogItem, CatalogSnapshotPayload } from '@/core/refresh/types';
import { useShortNames } from '@/hooks/useShortNames';
import { aliasToKindMap, canonicalKinds, getDisplayKind } from '@/utils/kindAliasMap';
import { isMacPlatform } from '@/utils/platform';
import type { Command } from './CommandPaletteCommands';
import './CommandPalette.css';

interface CommandPaletteProps {
  commands?: Command[];
}

// Define category order - easily adjustable
const CATEGORY_ORDER = [
  'Application',
  'Settings',
  'View',
  'Navigation',
  'Favorites',
  'Namespaces',
  'Kubeconfigs',
  'General', // Fallback for any uncategorized commands
];

const CATALOG_RESULT_LIMIT = 20;
const CATALOG_SEARCH_DEBOUNCE_MS = 200;

const normalizeKindClass = (value: string) => getKindColorClass(value);

export interface ParsedQueryTokens {
  kindTokens: string[];
  otherTokens: string[];
}

export const parseQueryTokens = (query: string): ParsedQueryTokens => {
  const rawTokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);

  const kindTokens: string[] = [];
  const otherTokens: string[] = [];
  const seenKindTokens = new Set<string>();

  rawTokens.forEach((token) => {
    if (!token) {
      return;
    }

    const normalizedToken = token.replace(/s$/, '');
    const matchedKind = aliasToKindMap.get(token) ?? aliasToKindMap.get(normalizedToken);
    if (matchedKind) {
      const canonical = matchedKind.toLowerCase();
      if (!seenKindTokens.has(canonical)) {
        kindTokens.push(canonical);
        seenKindTokens.add(canonical);
      }
      return;
    }

    if (token.length >= 3) {
      const normalized = normalizedToken.length >= 3 ? normalizedToken : token;
      const lower = normalized.toLowerCase();
      const partialMatches = canonicalKinds.filter((kind) => kind.startsWith(lower));
      if (partialMatches.length === 1) {
        const canonical = partialMatches[0];
        if (!seenKindTokens.has(canonical)) {
          kindTokens.push(canonical);
          seenKindTokens.add(canonical);
        }
        return;
      }
    }

    if (token.includes('/')) {
      const [namespacePart, namePart] = token.split('/', 2);
      if (namePart) {
        otherTokens.push(namePart);
      }
      if (namespacePart) {
        otherTokens.push(namespacePart);
      }
      return;
    }

    otherTokens.push(token);
  });

  return { kindTokens, otherTokens };
};

// The palette is either a general search or a single-category picker; one
// union (instead of a boolean per picker) makes overlapping modes
// unrepresentable, so switching pickers can never leave a stale mode behind.
type PaletteSelectMode = 'none' | 'namespaces' | 'kubeconfigs';

type PaletteItem =
  | {
      type: 'command';
      command: Command;
    }
  | {
      type: 'catalog';
      item: CatalogItem;
    };

type CatalogDisplayEntry = {
  item: CatalogItem;
  kindLabel: string;
  kindClass: string;
  displayName: string;
};

type ScoredCatalogEntry = CatalogDisplayEntry & { score: number };

export function buildCatalogDisplayEntries(
  items: CatalogItem[],
  tokens: ParsedQueryTokens,
  useShortResourceNames: boolean,
  limit: number = CATALOG_RESULT_LIMIT
): CatalogDisplayEntry[] {
  if (items.length === 0 || limit <= 0) {
    return [];
  }

  const { kindTokens, otherTokens } = tokens;
  const totalTokenCount = kindTokens.length + otherTokens.length;

  const scored: ScoredCatalogEntry[] = items
    .map((item) => {
      const kindLabel = getDisplayKind(item.kind, useShortResourceNames);
      const kindCanonical = item.kind.toLowerCase();
      const displayName = item.namespace ? `${item.namespace}/${item.name}` : item.name;

      let score = 0;

      if (kindTokens.length > 0) {
        if (kindTokens.some((kind) => kind === kindCanonical)) {
          score += 100;
        } else {
          return null;
        }
      }

      const searchableNamespace = item.namespace?.toLowerCase() ?? '';
      const searchableName = item.name.toLowerCase();
      const searchableCombined = `${item.namespace ?? ''}/${item.name}`.toLowerCase();

      for (const token of otherTokens) {
        if (!token) {
          continue;
        }

        const namespaceMatch = searchableNamespace.includes(token);
        const nameMatch = searchableName.includes(token);
        const combinedMatch = searchableCombined.includes(token);

        if (namespaceMatch) {
          score += searchableNamespace === token ? 30 : 20;
        }
        if (nameMatch) {
          score += searchableName === token ? 60 : 40;
        }
        if (!namespaceMatch && !nameMatch && combinedMatch) {
          score += 10;
        }

        if (!namespaceMatch && !nameMatch && !combinedMatch) {
          return null;
        }
      }

      if (totalTokenCount === 0) {
        score += 5;
      }

      return {
        item,
        kindLabel,
        kindClass: normalizeKindClass(item.kind),
        displayName,
        score,
      };
    })
    .filter((entry): entry is ScoredCatalogEntry => entry !== null)
    .sort((a, b) => b.score - a.score || a.displayName.localeCompare(b.displayName));

  return scored.slice(0, limit).map(({ score: _score, ...entry }) => entry);
}

export const CommandPalette = memo(function CommandPaletteComponent({
  commands = [],
}: CommandPaletteProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectMode, setSelectMode] = useState<PaletteSelectMode>('none');
  const [hideCursor, setHideCursor] = useState(false);
  const [mouseSelectionArmed, setMouseSelectionArmed] = useState(false);
  const [catalogResults, setCatalogResults] = useState<CatalogItem[]>([]);
  const [catalogStats, setCatalogStats] = useState<{ total: number; truncated: boolean } | null>(
    null
  );
  const [catalogLoading, setCatalogLoading] = useState(false);
  const catalogAbortRef = useRef<AbortController | null>(null);
  const catalogDebounceRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndexRef = useRef(0);
  // True when the palette was opened straight into a sub-mode (e.g. kubeconfig
  // mode via the "+"/⌘O event). Then Escape closes in one press instead of
  // backing out to a general palette the user never navigated through.
  const openedDirectlyRef = useRef(false);
  const mouseSelectionArmedRef = useRef(false);
  const { hasActiveBlockingSurface } = useKeyboardContext();
  const { openWithObject } = useObjectPanel();
  const { selectedClusterId } = useKubeconfig();
  const useShortResourceNames = useShortNames();
  const parsedTokens = useMemo(() => parseQueryTokens(searchQuery), [searchQuery]);
  const macPlatform = isMacPlatform();
  const focusSearchInput = useCallback(() => {
    const input = inputRef.current;
    if (!input) {
      return false;
    }
    input.focus();
    input.select();
    return true;
  }, []);

  // Filter commands based on search query and mode
  const filteredCommands = useMemo(() => {
    let filteredList = commands;

    // A selection sub-mode narrows the palette to that single category.
    if (selectMode === 'namespaces') {
      filteredList = commands.filter((cmd) => cmd.category === 'Namespaces');
    }
    if (selectMode === 'kubeconfigs') {
      filteredList = commands.filter((cmd) => cmd.category === 'Kubeconfigs');
    }

    if (!searchQuery.trim()) {
      return filteredList;
    }

    const query = searchQuery.toLowerCase();
    return filteredList.filter((command) => {
      const matchesLabel = command.label.toLowerCase().includes(query);
      const matchesDescription = command.description?.toLowerCase().includes(query);
      const matchesCategory = command.category?.toLowerCase().includes(query);
      const matchesKeywords = command.keywords?.some((keyword) =>
        keyword.toLowerCase().includes(query)
      );

      return matchesLabel || matchesDescription || matchesCategory || matchesKeywords;
    });
  }, [commands, searchQuery, selectMode]);

  // Group commands by category
  const groupedCommands = useMemo(() => {
    const groups: Map<string, Command[]> = new Map();

    filteredCommands.forEach((command) => {
      const category = command.category || 'General';
      const existing = groups.get(category) || [];
      groups.set(category, [...existing, command]);
    });

    // Sort categories according to CATEGORY_ORDER
    return Array.from(groups.entries()).sort((a, b) => {
      const indexA = CATEGORY_ORDER.indexOf(a[0]);
      const indexB = CATEGORY_ORDER.indexOf(b[0]);

      // If both are in the order array, sort by their position
      if (indexA !== -1 && indexB !== -1) {
        return indexA - indexB;
      }

      // If only one is in the order array, it comes first
      if (indexA !== -1) {
        return -1;
      }
      if (indexB !== -1) {
        return 1;
      }

      // If neither is in the order array, sort alphabetically
      return a[0].localeCompare(b[0]);
    });
  }, [filteredCommands]);

  const showCatalogSearch = useMemo(
    () => isOpen && selectMode === 'none' && searchQuery.trim().length > 0,
    [isOpen, selectMode, searchQuery]
  );

  useEffect(() => {
    if (catalogDebounceRef.current !== null) {
      window.clearTimeout(catalogDebounceRef.current);
      catalogDebounceRef.current = null;
    }
    if (catalogAbortRef.current) {
      catalogAbortRef.current.abort();
      catalogAbortRef.current = null;
    }

    if (!showCatalogSearch) {
      setCatalogResults([]);
      setCatalogStats(null);
      setCatalogLoading(false);
      return;
    }

    const query = searchQuery.trim();
    if (query.length === 0) {
      setCatalogResults([]);
      setCatalogStats(null);
      setCatalogLoading(false);
      return;
    }

    const activeClusterId = (selectedClusterId ?? '').trim();
    if (!activeClusterId) {
      setCatalogResults([]);
      setCatalogStats(null);
      setCatalogLoading(false);
      return;
    }

    setCatalogResults([]);
    setCatalogStats(null);

    setCatalogLoading(true);

    const timeoutId = window.setTimeout(() => {
      const controller = new AbortController();
      catalogAbortRef.current = controller;

      const params = new URLSearchParams();
      params.set('limit', String(CATALOG_RESULT_LIMIT));
      parsedTokens.kindTokens.forEach((kind) => {
        params.append('kind', kind);
      });
      const primarySearchTerm = parsedTokens.otherTokens[0];
      if (primarySearchTerm) {
        params.set('search', primarySearchTerm);
      } else if (!parsedTokens.kindTokens.length) {
        params.set('search', query);
      }

      const scope = buildClusterScope(activeClusterId, params.toString());

      fetchSnapshot<CatalogSnapshotPayload>('catalog', {
        scope,
        signal: controller.signal,
      })
        .then((result) => {
          if (!result.snapshot) {
            setCatalogResults([]);
            setCatalogStats(null);
            return;
          }
          const payload = result.snapshot.payload;
          const items = payload.items ?? [];
          setCatalogResults(items);
          setCatalogStats({
            total: payload.total,
            truncated: payload.total > items.length,
          });
        })
        .catch((error) => {
          if (error?.name === 'AbortError') {
            return;
          }
          console.error('Catalog search failed', error);
          setCatalogResults([]);
          setCatalogStats(null);
        })
        .finally(() => {
          if (catalogAbortRef.current === controller) {
            catalogAbortRef.current = null;
          }
          setCatalogLoading(false);
        });
    }, CATALOG_SEARCH_DEBOUNCE_MS);

    catalogDebounceRef.current = timeoutId;

    return () => {
      if (catalogDebounceRef.current !== null) {
        window.clearTimeout(catalogDebounceRef.current);
        catalogDebounceRef.current = null;
      }
      if (catalogAbortRef.current) {
        catalogAbortRef.current.abort();
        catalogAbortRef.current = null;
      }
      setCatalogLoading(false);
    };
  }, [showCatalogSearch, searchQuery, parsedTokens, selectedClusterId]);

  const catalogDisplayItems = useMemo<CatalogDisplayEntry[]>(() => {
    if (!showCatalogSearch) {
      return [];
    }
    return buildCatalogDisplayEntries(
      catalogResults,
      parsedTokens,
      useShortResourceNames,
      CATALOG_RESULT_LIMIT
    );
  }, [showCatalogSearch, catalogResults, parsedTokens, useShortResourceNames]);

  const paletteItems = useMemo<PaletteItem[]>(() => {
    const flattened: PaletteItem[] = [];
    groupedCommands.forEach(([_, categoryCommands]) => {
      categoryCommands.forEach((command) => {
        flattened.push({ type: 'command', command });
      });
    });
    catalogDisplayItems.forEach((entry) => {
      flattened.push({ type: 'catalog', item: entry.item });
    });
    return flattened;
  }, [groupedCommands, catalogDisplayItems]);

  const resultsId = 'command-palette-results';
  const selectedOptionId =
    paletteItems.length > 0 ? `command-palette-option-${selectedIndex}` : undefined;
  const inputLabel =
    selectMode === 'namespaces'
      ? 'Select a namespace'
      : selectMode === 'kubeconfigs'
        ? 'Select a kubeconfig'
        : 'Search commands and Kubernetes objects';
  const paletteItemCount = paletteItems.length;

  const hasCommandResults = filteredCommands.length > 0;
  const hasCatalogResults = catalogDisplayItems.length > 0;
  const noResults = !hasCommandResults && !hasCatalogResults && !catalogLoading;

  // Pre-compute indices for rendering without IIFE
  const commandIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    let index = 0;
    groupedCommands.forEach(([_, categoryCommands]) => {
      categoryCommands.forEach((command) => {
        map.set(command.id, index++);
      });
    });
    return map;
  }, [groupedCommands]);
  const catalogBaseIndex = commandIndexMap.size;

  // Reset state when opening
  const open = useCallback(() => {
    setIsOpen(true);
    setSearchQuery('');
    setSelectedIndex(0);
    selectedIndexRef.current = 0;
    mouseSelectionArmedRef.current = false;
    setMouseSelectionArmed(false);
    setSelectMode('none');
    openedDirectlyRef.current = false;
    setHideCursor(false);
    setCatalogResults([]);
    setCatalogStats(null);
    setCatalogLoading(false);
  }, []);

  // Close and reset
  const close = useCallback(() => {
    setIsOpen(false);
    setSearchQuery('');
    setSelectedIndex(0);
    selectedIndexRef.current = 0;
    mouseSelectionArmedRef.current = false;
    setMouseSelectionArmed(false);
    setSelectMode('none');
    openedDirectlyRef.current = false;
    setHideCursor(false);
    setCatalogResults([]);
    setCatalogStats(null);
    setCatalogLoading(false);
  }, []);

  // Switch the open palette into a selection sub-mode with a clean query and
  // selection.
  const enterSelectMode = useCallback((mode: PaletteSelectMode) => {
    setSelectMode(mode);
    setSearchQuery('');
    setSelectedIndex(0);
    selectedIndexRef.current = 0;
  }, []);

  // Execute selected item (command or catalog object)
  const executePaletteItem = useCallback(
    (item: PaletteItem) => {
      if (item.type === 'command') {
        const command = item.command;

        if (command.id === 'select-namespace') {
          enterSelectMode('namespaces');
          return;
        }

        if (command.id === 'select-kubeconfig') {
          enterSelectMode('kubeconfigs');
          return;
        }

        close();
        setTimeout(() => {
          command.action();
        }, 100);
        return;
      }

      const catalogItem = item.item;
      close();
      setTimeout(() => {
        openWithObject(buildRequiredObjectReference(catalogItem));
      }, 100);
    },
    [close, enterSelectMode, openWithObject]
  );

  const updateSelection = useCallback((index: number) => {
    selectedIndexRef.current = index;
    setSelectedIndex(index);
  }, []);

  const markKeyboardNavigation = useCallback(() => {
    setHideCursor((prev) => (prev ? prev : true));
  }, []);

  const getPageSize = useCallback(() => {
    const container = resultsRef.current;
    const firstItem = itemRefs.current[0];
    if (container && firstItem) {
      const itemHeight = firstItem.offsetHeight || 0;
      if (itemHeight > 0) {
        return Math.max(1, Math.floor(container.clientHeight / itemHeight));
      }
    }
    return 10;
  }, []);

  const selectNext = useCallback(() => {
    if (paletteItemCount === 0) {
      return false;
    }
    markKeyboardNavigation();
    const nextIndex =
      selectedIndexRef.current < paletteItemCount - 1 ? selectedIndexRef.current + 1 : 0;
    updateSelection(nextIndex);
    return true;
  }, [paletteItemCount, markKeyboardNavigation, updateSelection]);

  const selectPrevious = useCallback(() => {
    if (paletteItemCount === 0) {
      return false;
    }
    markKeyboardNavigation();
    const previousIndex =
      selectedIndexRef.current > 0 ? selectedIndexRef.current - 1 : paletteItemCount - 1;
    updateSelection(previousIndex);
    return true;
  }, [paletteItemCount, markKeyboardNavigation, updateSelection]);

  const pageDown = useCallback(() => {
    if (paletteItemCount === 0) {
      return false;
    }
    markKeyboardNavigation();
    const pageSize = getPageSize();
    const nextIndex = Math.min(paletteItemCount - 1, selectedIndexRef.current + pageSize);
    updateSelection(nextIndex);
    return true;
  }, [paletteItemCount, markKeyboardNavigation, getPageSize, updateSelection]);

  const pageUp = useCallback(() => {
    if (paletteItemCount === 0) {
      return false;
    }
    markKeyboardNavigation();
    const pageSize = getPageSize();
    const nextIndex = Math.max(0, selectedIndexRef.current - pageSize);
    updateSelection(nextIndex);
    return true;
  }, [paletteItemCount, markKeyboardNavigation, getPageSize, updateSelection]);

  const goHome = useCallback(() => {
    if (paletteItemCount === 0) {
      return false;
    }
    markKeyboardNavigation();
    updateSelection(0);
    return true;
  }, [paletteItemCount, markKeyboardNavigation, updateSelection]);

  const goEnd = useCallback(() => {
    if (paletteItemCount === 0) {
      return false;
    }
    markKeyboardNavigation();
    updateSelection(paletteItemCount - 1);
    return true;
  }, [paletteItemCount, markKeyboardNavigation, updateSelection]);

  const activateSelection = useCallback(() => {
    if (paletteItemCount === 0) {
      return false;
    }
    markKeyboardNavigation();
    const current = paletteItems[selectedIndexRef.current];
    if (!current) {
      return false;
    }
    executePaletteItem(current);
    return true;
  }, [paletteItemCount, markKeyboardNavigation, paletteItems, executePaletteItem]);

  const handleEscapeShortcut = useCallback(() => {
    if (!isOpen) {
      return false;
    }
    if (selectMode !== 'none') {
      // If the palette was opened straight into this sub-mode, Escape closes it;
      // otherwise it backs out to the general palette it was navigated from.
      if (openedDirectlyRef.current) {
        close();
        return true;
      }
      setSelectMode('none');
      setSearchQuery('');
      updateSelection(0);
      setHideCursor(false);
      return true;
    }
    close();
    return true;
  }, [isOpen, selectMode, close, updateSelection]);

  useKeyboardSurface({
    kind: 'palette',
    rootRef: containerRef,
    active: isOpen,
    blocking: true,
    suppressShortcuts: true,
    onKeyDown: (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return false;
      }

      switch (event.key) {
        case 'ArrowDown':
          return selectNext();
        case 'ArrowUp':
          return selectPrevious();
        case 'PageDown':
          return pageDown();
        case 'PageUp':
          return pageUp();
        case 'Home':
          return goHome();
        case 'End':
          return goEnd();
        case 'Enter':
          return activateSelection();
        case 'Escape':
          return handleEscapeShortcut();
        default:
          return false;
      }
    },
  });

  useShortcuts(
    [
      {
        key: 'ArrowDown',
        handler: selectNext,
        description: 'Highlight next result',
        enabled: isOpen,
      },
      {
        key: 'ArrowUp',
        handler: selectPrevious,
        description: 'Highlight previous result',
        enabled: isOpen,
      },
      {
        key: 'PageDown',
        handler: pageDown,
        description: 'Page down',
        enabled: isOpen,
      },
      {
        key: 'PageUp',
        handler: pageUp,
        description: 'Page up',
        enabled: isOpen,
      },
      {
        key: 'Home',
        handler: goHome,
        description: 'Jump to first result',
        enabled: isOpen,
      },
      {
        key: 'End',
        handler: goEnd,
        description: 'Jump to last result',
        enabled: isOpen,
      },
      {
        key: 'Enter',
        handler: activateSelection,
        description: 'Execute selection',
        enabled: isOpen,
      },
      {
        key: 'Escape',
        handler: handleEscapeShortcut,
        description: 'Close command palette',
        enabled: isOpen,
      },
    ],
    {
      priority: KeyboardShortcutPriority.COMMAND_PALETTE,
      category: 'Command Palette',
    }
  );

  const handleInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      e.currentTarget.select();
    }
  }, []);

  const handleGlobalOpenShortcut = useCallback(() => {
    if (!isOpen && !hasActiveBlockingSurface()) {
      open();
      return true;
    }
    return false;
  }, [hasActiveBlockingSurface, isOpen, open]);

  // Register shortcuts for opening the command palette
  useShortcut({
    key: 'p',
    modifiers: macPlatform ? { meta: true, shift: true } : { ctrl: true, shift: true },
    handler: handleGlobalOpenShortcut,
    description: 'Open command palette',
    category: 'Global',
    enabled: true,
    priority: 100,
  });

  // Also open from the native "View → Command Palette" menu item, which emits
  // this runtime event. Held in a ref so the subscription stays stable across
  // the open/close re-renders that recreate handleGlobalOpenShortcut.
  const openShortcutRef = useRef(handleGlobalOpenShortcut);
  useEffect(() => {
    openShortcutRef.current = handleGlobalOpenShortcut;
  }, [handleGlobalOpenShortcut]);
  useEffect(() => {
    const dispose = EventsOn('open-command-palette', () => {
      openShortcutRef.current();
    });
    return dispose;
  }, []);

  // Open the palette directly in a selection sub-mode: kubeconfigs is the
  // "Open Cluster" surface (the "+" in the cluster tab bar, ⌘O, and File →
  // Open Cluster all emit that event); namespaces is the ⇧⌘N shortcut below.
  // open() resets the mode, so set it after.
  const openInSelectMode = useCallback(
    (mode: PaletteSelectMode) => {
      if (isOpen) {
        enterSelectMode(mode);
        return true;
      }
      if (hasActiveBlockingSurface()) {
        return false;
      }
      open();
      setSelectMode(mode);
      openedDirectlyRef.current = true;
      return true;
    },
    [enterSelectMode, hasActiveBlockingSurface, isOpen, open]
  );
  const openInKubeconfigMode = useCallback(() => {
    openInSelectMode('kubeconfigs');
  }, [openInSelectMode]);
  useEventBus('command-palette:open-kubeconfigs', openInKubeconfigMode, [openInKubeconfigMode]);
  const openInNamespaceMode = useCallback(() => openInSelectMode('namespaces'), [openInSelectMode]);
  // The search button in the sidebar's Namespaces header emits this event.
  useEventBus('command-palette:open-namespaces', openInNamespaceMode, [openInNamespaceMode]);
  // Open the palette straight into namespace selection. Registered in the
  // frontend shortcut system (not the native menu), like ⌘⇧P above.
  useShortcut({
    key: 'n',
    modifiers: macPlatform ? { meta: true, shift: true } : { ctrl: true, shift: true },
    handler: openInNamespaceMode,
    description: 'Select namespace',
    category: 'Global',
    enabled: true,
    priority: 100,
  });
  // The header search button opens the palette in its normal (search) mode via
  // the same guarded open path as the keyboard shortcut.
  useEventBus('command-palette:open', () => openShortcutRef.current(), []);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      focusSearchInput();
    }
  }, [focusSearchInput, isOpen]);

  // Truncate itemRefs to match current item count (prevents stale refs when list shrinks)
  useEffect(() => {
    itemRefs.current.length = paletteItems.length;
  }, [paletteItems.length]);

  useEffect(() => {
    selectedIndexRef.current = selectedIndex;
  }, [selectedIndex]);

  useEffect(() => {
    if (paletteItems.length === 0) {
      selectedIndexRef.current = 0;
      setSelectedIndex(0);
      return;
    }
    if (selectedIndexRef.current >= paletteItems.length) {
      const nextIndex = paletteItems.length - 1;
      selectedIndexRef.current = nextIndex;
      setSelectedIndex(nextIndex);
    }
  }, [paletteItems]);

  // Scroll selected item into view
  useEffect(() => {
    const selectedItem = itemRefs.current[selectedIndex];
    if (selectedItem) {
      selectedItem.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth',
      });
    }
  }, [selectedIndex]);

  // Handle clicks outside to close
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        close();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, close]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (!mouseSelectionArmedRef.current) {
        mouseSelectionArmedRef.current = true;
        setMouseSelectionArmed(true);
      }
      setHideCursor(false);
      const targetElement = event.target instanceof HTMLElement ? event.target : null;
      const targetItem = targetElement?.closest<HTMLButtonElement>('.command-palette-item') ?? null;
      const targetIndex = itemRefs.current.indexOf(targetItem);
      if (targetIndex !== -1 && targetIndex !== selectedIndexRef.current) {
        updateSelection(targetIndex);
      }
    };

    container.addEventListener('pointermove', handlePointerMove);
    return () => container.removeEventListener('pointermove', handlePointerMove);
  }, [isOpen, updateSelection]);

  if (!isOpen) {
    return null;
  }

  return (
    <ErrorBoundary
      scope="command-palette"
      fallback={(_, reset) => (
        <div className="command-palette">
          <div className="command-palette-error">
            <h4>Command Palette Error</h4>
            <p>An error occurred. Please try again.</p>
            <button type="button" className="button generic" onClick={reset}>
              Retry
            </button>
            <button type="button" className="button generic" onClick={close}>
              Close
            </button>
          </div>
        </div>
      )}
    >
      <div
        className={[
          'command-palette',
          hideCursor ? 'hide-cursor' : null,
          mouseSelectionArmed ? 'mouse-selection-armed' : null,
        ]
          .filter(Boolean)
          .join(' ')}
        ref={containerRef}
      >
        <div className="command-palette-header">
          <input
            ref={inputRef}
            type="text"
            className="command-palette-input"
            placeholder={
              selectMode === 'namespaces'
                ? 'Select a namespace...'
                : selectMode === 'kubeconfigs'
                  ? 'Select a kubeconfig...'
                  : 'Type a command or search...'
            }
            value={searchQuery}
            role="combobox"
            aria-label={inputLabel}
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls={resultsId}
            aria-activedescendant={selectedOptionId}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleInputKeyDown}
          />
        </div>

        <div
          className="command-palette-results"
          ref={resultsRef}
          id={resultsId}
          role="listbox"
          aria-label={`${inputLabel} results`}
        >
          {noResults ? (
            <div className="command-palette-empty">
              {searchQuery.trim().length > 0
                ? `No commands or objects found for "${searchQuery}"`
                : 'No commands available'}
            </div>
          ) : (
            <>
              {hasCommandResults &&
                groupedCommands.map(([category, categoryCommands]) => (
                  <fieldset key={category} className="command-palette-group">
                    <legend className="command-palette-group-header">{category}</legend>
                    {categoryCommands.map((command) => {
                      const currentIndex = commandIndexMap.get(command.id) ?? 0;
                      const isSelected = currentIndex === selectedIndex;
                      return (
                        <button
                          type="button"
                          key={command.id}
                          ref={(el) => {
                            itemRefs.current[currentIndex] = el;
                          }}
                          className={`command-palette-item ${isSelected ? 'selected' : ''}`}
                          id={`command-palette-option-${currentIndex}`}
                          role="option"
                          aria-selected={isSelected}
                          tabIndex={-1}
                          onClick={() => executePaletteItem({ type: 'command', command })}
                          onMouseEnter={() => {
                            if (mouseSelectionArmedRef.current) {
                              updateSelection(currentIndex);
                            }
                          }}
                        >
                          {command.icon === '✓' ? (
                            <span className="command-palette-item-check" aria-hidden="true">
                              ✓
                            </span>
                          ) : (
                            command.icon && (
                              <span className="command-palette-item-icon">{command.icon}</span>
                            )
                          )}
                          <div className="command-palette-item-content">
                            <div className="command-palette-item-label">
                              {command.renderLabel ?? command.label}
                            </div>
                          </div>
                          {!!command.shortcut && (
                            <div className="keycap">
                              {Array.isArray(command.shortcut) ? (
                                withStableListKeys(command.shortcut, (key) => key).map(
                                  ({ key: stableKey, value: shortcutKey }) => (
                                    <kbd key={stableKey}>{shortcutKey}</kbd>
                                  )
                                )
                              ) : (
                                <kbd>{command.shortcut}</kbd>
                              )}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </fieldset>
                ))}

              {!!(catalogLoading || hasCatalogResults) && (
                <fieldset className="command-palette-group">
                  <legend className="command-palette-group-header">
                    Catalog Results
                    {catalogStats?.truncated && hasCatalogResults
                      ? ` (${catalogDisplayItems.length} / ${catalogStats.total})`
                      : ''}
                  </legend>
                  {catalogLoading && catalogDisplayItems.length === 0 && (
                    <div className="command-palette-loading">Searching catalog…</div>
                  )}
                  {catalogDisplayItems.map((entry, idx) => {
                    const currentIndex = catalogBaseIndex + idx;
                    const isSelected = currentIndex === selectedIndex;
                    return (
                      <button
                        type="button"
                        key={entry.item.uid}
                        ref={(el) => {
                          itemRefs.current[currentIndex] = el;
                        }}
                        className={`command-palette-item ${isSelected ? 'selected' : ''}`}
                        id={`command-palette-option-${currentIndex}`}
                        role="option"
                        aria-selected={isSelected}
                        tabIndex={-1}
                        onClick={() => executePaletteItem({ type: 'catalog', item: entry.item })}
                        onMouseEnter={() => {
                          if (mouseSelectionArmedRef.current) {
                            updateSelection(currentIndex);
                          }
                        }}
                      >
                        <div className="command-palette-item-content">
                          <div className="command-palette-item-label catalog">
                            <span className={`kind-badge ${entry.kindClass}`}>
                              {entry.kindLabel}
                            </span>
                            <span className="command-palette-item-name">{entry.displayName}</span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                  {catalogStats?.truncated && catalogDisplayItems.length > 0 && (
                    <div className="command-palette-note">
                      Showing first {catalogDisplayItems.length} of {catalogStats.total} results.
                      Refine your search to narrow further.
                    </div>
                  )}
                </fieldset>
              )}
            </>
          )}
        </div>

        <div className="command-palette-footer">
          <span className="command-palette-hint">
            <kbd>↑↓</kbd> Navigate
          </span>
          <span className="command-palette-hint">
            <kbd>Enter</kbd> Select
          </span>
          <span className="command-palette-hint">
            <kbd>Esc</kbd> Close
          </span>
        </div>
      </div>
    </ErrorBoundary>
  );
});
