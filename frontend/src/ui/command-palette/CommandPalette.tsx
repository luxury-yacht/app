/**
 * frontend/src/ui/command-palette/CommandPalette.tsx
 *
 * Module source for CommandPalette.
 * Implements CommandPalette logic for the UI layer.
 */

import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { ListboxOptionButton } from '@shared/components/aria/ListboxOptionButton';
import { ErrorBoundary } from '@shared/components/errors/ErrorBoundary';
import { useModalFocusTrap } from '@shared/components/modals/useModalFocusTrap';
import { kindDisplayName } from '@shared/kinds/kindDisplay';
import { getKindColorClass } from '@shared/utils/kindBadgeColors';
import { buildRequiredObjectReference } from '@shared/utils/objectIdentity';
import { withStableListKeys } from '@shared/utils/stableListKeys';
import { useKeyboardContext, useShortcut, useShortcuts } from '@ui/shortcuts';
import { KeyboardShortcutPriority } from '@ui/shortcuts/priorities';
import { modifiersMatch } from '@ui/shortcuts/utils';
import type React from 'react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEventBus } from '@/core/events';
import type { CatalogItem } from '@/core/refresh/types';
import { usePreference } from '@/core/settings/usePreference';
import { aliasToKindMap, canonicalKinds } from '@/utils/kindAliasMap';
import { isMacPlatform } from '@/utils/platform';
import {
  type Command,
  type SavedWorkspaceCommands,
  useSavedWorkspaceCommands,
} from './CommandPaletteCommands';
import {
  CATALOG_RESULT_LIMIT,
  type CatalogStats,
  usePaletteCatalogSearch,
} from './usePaletteCatalogSearch';
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
  'Workspaces',
  'Namespaces',
  'Clusters',
  'General', // Fallback for any uncategorized commands
];

type PaletteNavigationKey = 'ArrowDown' | 'ArrowUp' | 'PageDown' | 'PageUp' | 'Home' | 'End';

const getPaletteSelectionIndex = (
  key: PaletteNavigationKey,
  currentIndex: number,
  lastIndex: number,
  pageSize: number
): number => {
  switch (key) {
    case 'ArrowDown':
      return currentIndex < lastIndex ? currentIndex + 1 : 0;
    case 'ArrowUp':
      return currentIndex > 0 ? currentIndex - 1 : lastIndex;
    case 'PageDown':
      return Math.min(lastIndex, currentIndex + pageSize);
    case 'PageUp':
      return Math.max(0, currentIndex - pageSize);
    case 'Home':
      return 0;
    case 'End':
      return lastIndex;
  }
};

export interface ParsedQueryTokens {
  kindTokens: string[];
  otherTokens: string[];
}

const resolveKindToken = (token: string): string | null => {
  const singularToken = token.replace(/s$/, '');
  const aliasMatch = aliasToKindMap.get(token) ?? aliasToKindMap.get(singularToken);
  if (aliasMatch) {
    return aliasMatch.toLowerCase();
  }
  if (token.length < 3) {
    return null;
  }
  const prefix = singularToken.length >= 3 ? singularToken : token;
  const partialMatches = canonicalKinds.filter((kind) => kind.startsWith(prefix.toLowerCase()));
  return partialMatches.length === 1 ? partialMatches[0] : null;
};

const appendSearchTokens = (token: string, otherTokens: string[]) => {
  if (!token.includes('/')) {
    otherTokens.push(token);
    return;
  }
  const [namespacePart, namePart] = token.split('/', 2);
  if (namePart) {
    otherTokens.push(namePart);
  }
  if (namespacePart) {
    otherTokens.push(namespacePart);
  }
};

export const parseQueryTokens = (query: string): ParsedQueryTokens => {
  const rawTokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);

  const kindTokens: string[] = [];
  const otherTokens: string[] = [];
  const seenKindTokens = new Set<string>();

  rawTokens.forEach((token) => {
    const kind = resolveKindToken(token);
    if (kind && !seenKindTokens.has(kind)) {
      kindTokens.push(kind);
      seenKindTokens.add(kind);
      return;
    }
    if (!kind) {
      appendSearchTokens(token, otherTokens);
    }
  });

  return { kindTokens, otherTokens };
};

// The palette is either a general search or a single-category picker; one
// union (instead of a boolean per picker) makes overlapping modes
// unrepresentable, so switching pickers can never leave a stale mode behind.
type PaletteSelectMode = 'none' | 'namespaces' | 'kubeconfigs' | 'workspaces';

const NO_COMMANDS: Command[] = [];

// Commands that switch the open palette to a picker instead of running.
const PICKER_MODE_BY_COMMAND = new Map<string, PaletteSelectMode>([
  ['select-namespace', 'namespaces'],
  ['select-kubeconfig', 'kubeconfigs'],
  ['open-workspace', 'workspaces'],
]);

// A picker lists only its own category's choices.
const PICKER_CATEGORY: Record<Exclude<PaletteSelectMode, 'none'>, string> = {
  namespaces: 'Namespaces',
  kubeconfigs: 'Clusters',
  workspaces: 'Workspaces',
};

const commandsForMode = (mode: PaletteSelectMode, commands: Command[]): Command[] =>
  mode === 'none' ? commands : commands.filter((cmd) => cmd.category === PICKER_CATEGORY[mode]);

interface CommandGroup {
  category: string;
  commands: Command[];
  // The result index of the group's first command; rows are numbered by
  // position so an index never depends on command ids being unique.
  startIndex: number;
}

// Listed categories in CATEGORY_ORDER, then any others alphabetically.
const compareCategories = (a: string, b: string): number => {
  const indexA = CATEGORY_ORDER.indexOf(a);
  const indexB = CATEGORY_ORDER.indexOf(b);
  if (indexA !== -1 && indexB !== -1) {
    return indexA - indexB;
  }
  if (indexA !== -1) {
    return -1;
  }
  if (indexB !== -1) {
    return 1;
  }
  return a.localeCompare(b);
};

const groupCommandsByCategory = (commands: Command[]): CommandGroup[] => {
  const byCategory = new Map<string, Command[]>();
  for (const command of commands) {
    const category = command.category || 'General';
    const group = byCategory.get(category);
    if (group) {
      group.push(command);
    } else {
      byCategory.set(category, [command]);
    }
  }
  let startIndex = 0;
  return Array.from(byCategory.entries())
    .sort(([a], [b]) => compareCategories(a, b))
    .map(([category, groupCommands]) => {
      const group = { category, commands: groupCommands, startIndex };
      startIndex += groupCommands.length;
      return group;
    });
};

const paletteEmptyMessage = (
  query: string,
  mode: PaletteSelectMode,
  workspaces: SavedWorkspaceCommands['status']
): string => {
  if (query.trim()) {
    return `No commands or objects found for "${query}"`;
  }
  if (mode !== 'workspaces') {
    return 'No commands available';
  }
  return workspaces === 'failed' ? 'Saved workspaces could not be read' : 'No saved workspaces';
};

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

interface CatalogSearchFields {
  namespace: string;
  name: string;
  combined: string;
}

const scoreKindTokens = (kindTokens: string[], kindCanonical: string): number | null => {
  if (kindTokens.length === 0) {
    return 0;
  }
  return kindTokens.includes(kindCanonical) ? 100 : null;
};

const scoreSearchToken = (token: string, fields: CatalogSearchFields): number | null => {
  const namespaceMatch = fields.namespace.includes(token);
  const nameMatch = fields.name.includes(token);
  const combinedMatch = fields.combined.includes(token);
  if (!namespaceMatch && !nameMatch && !combinedMatch) {
    return null;
  }
  let score = 0;
  if (namespaceMatch) {
    score += fields.namespace === token ? 30 : 20;
  }
  if (nameMatch) {
    score += fields.name === token ? 60 : 40;
  }
  if (!namespaceMatch && !nameMatch && combinedMatch) {
    score += 10;
  }
  return score;
};

const scoreOtherTokens = (tokens: string[], fields: CatalogSearchFields): number | null => {
  let score = 0;
  for (const token of tokens) {
    const tokenScore = scoreSearchToken(token, fields);
    if (tokenScore === null) {
      return null;
    }
    score += tokenScore;
  }
  return score;
};

const scoreCatalogEntry = (
  item: CatalogItem,
  tokens: ParsedQueryTokens,
  useShortResourceNames: boolean
): ScoredCatalogEntry | null => {
  const kindScore = scoreKindTokens(tokens.kindTokens, item.ref.kind.toLowerCase());
  if (kindScore === null) {
    return null;
  }
  const otherScore = scoreOtherTokens(tokens.otherTokens, {
    namespace: item.ref.namespace?.toLowerCase() ?? '',
    name: item.ref.name.toLowerCase(),
    combined: `${item.ref.namespace ?? ''}/${item.ref.name}`.toLowerCase(),
  });
  if (otherScore === null) {
    return null;
  }
  return {
    item,
    kindLabel: kindDisplayName(item.ref, useShortResourceNames),
    kindClass: getKindColorClass(item.ref.kind),
    displayName: item.ref.namespace ? `${item.ref.namespace}/${item.ref.name}` : item.ref.name,
    score:
      kindScore + otherScore + (tokens.kindTokens.length + tokens.otherTokens.length === 0 ? 5 : 0),
  };
};

export function buildCatalogDisplayEntries(
  items: CatalogItem[],
  tokens: ParsedQueryTokens,
  useShortResourceNames: boolean,
  limit: number = CATALOG_RESULT_LIMIT
): CatalogDisplayEntry[] {
  if (items.length === 0 || limit <= 0) {
    return [];
  }

  const scored: ScoredCatalogEntry[] = items
    .map((item) => scoreCatalogEntry(item, tokens, useShortResourceNames))
    .filter((entry): entry is ScoredCatalogEntry => entry !== null)
    .sort((a, b) => b.score - a.score || a.displayName.localeCompare(b.displayName));

  return scored.slice(0, limit).map(({ score: _score, ...entry }) => entry);
}

const getPaletteInputCopy = (mode: PaletteSelectMode) => {
  if (mode === 'namespaces') {
    return { label: 'Select a namespace', placeholder: 'Select a namespace...' };
  }
  if (mode === 'kubeconfigs') {
    return { label: 'Select a kubeconfig', placeholder: 'Select a cluster…' };
  }
  if (mode === 'workspaces') {
    return { label: 'Select a workspace', placeholder: 'Select a workspace...' };
  }
  return {
    label: 'Search commands and Kubernetes objects',
    placeholder: 'Type a command or search...',
  };
};

const CommandResultIcon = ({ icon }: { icon: Command['icon'] }) => {
  if (icon === '✓') {
    return (
      <span className="command-palette-item-check" aria-hidden="true">
        ✓
      </span>
    );
  }
  return icon ? <span className="command-palette-item-icon">{icon}</span> : null;
};

const CommandShortcut = ({ shortcut }: { shortcut: Command['shortcut'] }) => {
  if (!shortcut) {
    return null;
  }
  const keys = Array.isArray(shortcut)
    ? withStableListKeys(shortcut, (key) => key)
    : [{ key: shortcut, value: shortcut }];
  return (
    <div className="keycap">
      {keys.map(({ key, value }) => (
        <kbd key={key}>{value}</kbd>
      ))}
    </div>
  );
};

interface ResultRowInteractionProps {
  currentIndex: number;
  selectedIndex: number;
  itemRefs: React.MutableRefObject<(HTMLButtonElement | null)[]>;
  mouseSelectionArmedRef: React.MutableRefObject<boolean>;
  updateSelection: (index: number) => void;
}

interface PaletteResultRowProps extends ResultRowInteractionProps {
  item: PaletteItem;
  executePaletteItem: (item: PaletteItem) => void;
  children: React.ReactNode;
}

const PaletteResultRow = ({
  item,
  currentIndex,
  selectedIndex,
  itemRefs,
  mouseSelectionArmedRef,
  updateSelection,
  executePaletteItem,
  children,
}: Readonly<PaletteResultRowProps>) => {
  const isSelected = currentIndex === selectedIndex;
  return (
    <ListboxOptionButton
      ref={(element) => {
        itemRefs.current[currentIndex] = element;
      }}
      className={`command-palette-item ${isSelected ? 'selected' : ''}`}
      id={`command-palette-option-${currentIndex}`}
      selected={isSelected}
      onClick={() => executePaletteItem(item)}
      onMouseEnter={() => {
        if (mouseSelectionArmedRef.current) {
          updateSelection(currentIndex);
        }
      }}
    >
      {children}
    </ListboxOptionButton>
  );
};

interface CommandResultRowProps extends ResultRowInteractionProps {
  command: Command;
  executePaletteItem: (item: PaletteItem) => void;
}

const CommandResultRow = ({ command, ...interaction }: Readonly<CommandResultRowProps>) => (
  <PaletteResultRow {...interaction} item={{ type: 'command', command }}>
    <CommandResultIcon icon={command.icon} />
    <div className="command-palette-item-content">
      <div className="command-palette-item-label">{command.renderLabel ?? command.label}</div>
    </div>
    <CommandShortcut shortcut={command.shortcut} />
  </PaletteResultRow>
);

interface CommandGroupsProps extends Omit<ResultRowInteractionProps, 'currentIndex'> {
  commandGroups: CommandGroup[];
  executePaletteItem: (item: PaletteItem) => void;
}

const CommandGroups = (props: CommandGroupsProps) => (
  <>
    {props.commandGroups.map(({ category, commands, startIndex }) => (
      <fieldset key={category} className="command-palette-group">
        <legend className="command-palette-group-header">{category}</legend>
        {commands.map((command, offset) => (
          <CommandResultRow
            key={command.id}
            command={command}
            currentIndex={startIndex + offset}
            selectedIndex={props.selectedIndex}
            itemRefs={props.itemRefs}
            mouseSelectionArmedRef={props.mouseSelectionArmedRef}
            updateSelection={props.updateSelection}
            executePaletteItem={props.executePaletteItem}
          />
        ))}
      </fieldset>
    ))}
  </>
);

interface CatalogResultRowProps extends ResultRowInteractionProps {
  entry: CatalogDisplayEntry;
  executePaletteItem: (item: PaletteItem) => void;
}

const CatalogResultRow = ({ entry, ...interaction }: Readonly<CatalogResultRowProps>) => (
  <PaletteResultRow {...interaction} item={{ type: 'catalog', item: entry.item }}>
    <div className="command-palette-item-content">
      <div className="command-palette-item-label catalog">
        <span className={`kind-badge ${entry.kindClass}`}>{entry.kindLabel}</span>
        <span className="command-palette-item-name">{entry.displayName}</span>
      </div>
    </div>
  </PaletteResultRow>
);

interface CatalogGroupProps extends Omit<ResultRowInteractionProps, 'currentIndex'> {
  entries: CatalogDisplayEntry[];
  stats: CatalogStats;
  loading: boolean;
  baseIndex: number;
  executePaletteItem: (item: PaletteItem) => void;
}

const CatalogGroup = (props: CatalogGroupProps) => (
  <fieldset className="command-palette-group">
    <legend className="command-palette-group-header">
      Catalog Results
      {props.stats?.truncated && props.entries.length > 0
        ? ` (${props.entries.length} / ${props.stats.total})`
        : ''}
    </legend>
    {props.loading && props.entries.length === 0 ? (
      <div className="command-palette-loading">Searching catalog…</div>
    ) : null}
    {props.entries.map((entry, index) => (
      <CatalogResultRow
        key={entry.item.ref.uid}
        entry={entry}
        currentIndex={props.baseIndex + index}
        selectedIndex={props.selectedIndex}
        itemRefs={props.itemRefs}
        mouseSelectionArmedRef={props.mouseSelectionArmedRef}
        updateSelection={props.updateSelection}
        executePaletteItem={props.executePaletteItem}
      />
    ))}
    {props.stats?.truncated && props.entries.length > 0 ? (
      <div className="command-palette-note">
        Showing first {props.entries.length} of {props.stats.total} results. Refine your search to
        narrow further.
      </div>
    ) : null}
  </fieldset>
);

interface PaletteResultsProps extends Omit<ResultRowInteractionProps, 'currentIndex'> {
  noResults: boolean;
  emptyMessage: string;
  hasCommandResults: boolean;
  commandGroups: CommandGroup[];
  catalogLoading: boolean;
  catalogEntries: CatalogDisplayEntry[];
  catalogStats: CatalogStats;
  catalogBaseIndex: number;
  executePaletteItem: (item: PaletteItem) => void;
}

const PaletteResults = (props: PaletteResultsProps) => {
  if (props.noResults) {
    return <div className="command-palette-empty">{props.emptyMessage}</div>;
  }
  return (
    <>
      {props.hasCommandResults ? <CommandGroups {...props} /> : null}
      {props.catalogLoading || props.catalogEntries.length > 0 ? (
        <CatalogGroup
          entries={props.catalogEntries}
          stats={props.catalogStats}
          loading={props.catalogLoading}
          baseIndex={props.catalogBaseIndex}
          selectedIndex={props.selectedIndex}
          itemRefs={props.itemRefs}
          mouseSelectionArmedRef={props.mouseSelectionArmedRef}
          updateSelection={props.updateSelection}
          executePaletteItem={props.executePaletteItem}
        />
      ) : null}
    </>
  );
};

export const CommandPalette = memo(function CommandPaletteComponent({
  commands = [],
}: CommandPaletteProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectMode, setSelectMode] = useState<PaletteSelectMode>('none');
  const [hideCursor, setHideCursor] = useState(false);
  const [mouseSelectionArmed, setMouseSelectionArmed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDialogElement>(null);
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
  const useShortResourceNames = usePreference('useShortResourceNames');
  const parsedTokens = useMemo(() => parseQueryTokens(searchQuery), [searchQuery]);
  const macPlatform = isMacPlatform();
  const selectNamespaceModifiers = macPlatform
    ? { meta: true, shift: true }
    : { ctrl: true, shift: true };
  const focusSearchInput = useCallback(() => {
    const input = inputRef.current;
    if (!input) {
      return false;
    }
    input.focus();
    input.select();
    return true;
  }, []);

  const savedWorkspaces = useSavedWorkspaceCommands(isOpen);
  const savedWorkspaceCommands =
    savedWorkspaces.status === 'ready' ? savedWorkspaces.commands : NO_COMMANDS;
  const allCommands = useMemo(
    () => [...commands, ...savedWorkspaceCommands],
    [commands, savedWorkspaceCommands]
  );

  // Filter commands based on search query and mode
  const filteredCommands = useMemo(() => {
    const filteredList = commandsForMode(selectMode, allCommands);

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
  }, [allCommands, searchQuery, selectMode]);

  const commandGroups = useMemo(
    () => groupCommandsByCategory(filteredCommands),
    [filteredCommands]
  );

  const showCatalogSearch = isOpen && selectMode === 'none' && searchQuery.trim().length > 0;
  const {
    items: catalogResults,
    stats: catalogStats,
    loading: catalogLoading,
  } = usePaletteCatalogSearch({
    enabled: showCatalogSearch,
    clusterId: selectedClusterId,
    query: searchQuery,
    tokens: parsedTokens,
  });

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

  // In render order, so a result's position here is its row index.
  const paletteItems = useMemo<PaletteItem[]>(
    () => [
      ...commandGroups.flatMap(({ commands: groupCommands }) =>
        groupCommands.map((command): PaletteItem => ({ type: 'command', command }))
      ),
      ...catalogDisplayItems.map((entry): PaletteItem => ({ type: 'catalog', item: entry.item })),
    ],
    [commandGroups, catalogDisplayItems]
  );

  const resultsId = 'command-palette-results';
  const selectedOptionId =
    paletteItems.length > 0 ? `command-palette-option-${selectedIndex}` : undefined;
  const { label: inputLabel, placeholder: inputPlaceholder } = getPaletteInputCopy(selectMode);

  const paletteItemCount = paletteItems.length;

  const hasCommandResults = filteredCommands.length > 0;
  const hasCatalogResults = catalogDisplayItems.length > 0;
  // While the workspace picker's list is still being read, it claims nothing.
  const workspacesLoading = selectMode === 'workspaces' && savedWorkspaces.status === 'loading';
  const noResults =
    !hasCommandResults && !hasCatalogResults && !catalogLoading && !workspacesLoading;

  const catalogBaseIndex = filteredCommands.length;

  const resetPalette = useCallback(() => {
    setSearchQuery('');
    setSelectedIndex(0);
    selectedIndexRef.current = 0;
    mouseSelectionArmedRef.current = false;
    setMouseSelectionArmed(false);
    setSelectMode('none');
    openedDirectlyRef.current = false;
    setHideCursor(false);
  }, []);

  const open = useCallback(() => {
    setIsOpen(true);
    resetPalette();
  }, [resetPalette]);

  const close = useCallback(() => {
    setIsOpen(false);
    resetPalette();
  }, [resetPalette]);

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

        const pickerMode = PICKER_MODE_BY_COMMAND.get(command.id);
        if (pickerMode) {
          enterSelectMode(pickerMode);
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
        openWithObject(buildRequiredObjectReference(catalogItem.ref));
      }, 100);
    },
    [close, enterSelectMode, openWithObject]
  );

  const updateSelection = useCallback((index: number) => {
    selectedIndexRef.current = index;
    setSelectedIndex(index);
  }, []);

  const markKeyboardNavigation = useCallback(() => {
    setHideCursor(true);
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

  const moveSelection = useCallback(
    (key: PaletteNavigationKey) => {
      if (paletteItemCount === 0) {
        return false;
      }
      markKeyboardNavigation();
      const pageSize = key === 'PageDown' || key === 'PageUp' ? getPageSize() : 0;
      updateSelection(
        getPaletteSelectionIndex(key, selectedIndexRef.current, paletteItemCount - 1, pageSize)
      );
      return true;
    },
    [paletteItemCount, markKeyboardNavigation, getPageSize, updateSelection]
  );

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

  const paletteShortcuts = [
    {
      key: 'ArrowDown',
      handler: () => moveSelection('ArrowDown'),
      description: 'Highlight next result',
      helpOrder: 30,
      enabled: isOpen,
    },
    {
      key: 'ArrowUp',
      handler: () => moveSelection('ArrowUp'),
      description: 'Highlight previous result',
      helpOrder: 31,
      enabled: isOpen,
    },
    {
      key: 'PageDown',
      handler: () => moveSelection('PageDown'),
      description: 'Page down',
      helpOrder: 50,
      enabled: isOpen,
    },
    {
      key: 'PageUp',
      handler: () => moveSelection('PageUp'),
      description: 'Page up',
      helpOrder: 51,
      enabled: isOpen,
    },
    {
      key: 'Home',
      handler: () => moveSelection('Home'),
      description: 'Jump to first result',
      helpOrder: 40,
      enabled: isOpen,
    },
    {
      key: 'End',
      handler: () => moveSelection('End'),
      description: 'Jump to last result',
      helpOrder: 41,
      enabled: isOpen,
    },
    {
      key: 'Enter',
      handler: activateSelection,
      description: 'Execute selection',
      helpOrder: 60,
      enabled: isOpen,
    },
    {
      key: 'Escape',
      handler: handleEscapeShortcut,
      description: 'Close command palette',
      category: 'Windows & Panels',
      helpOrder: 41,
      enabled: isOpen,
    },
  ];

  useModalFocusTrap({
    ref: containerRef,
    disabled: !isOpen,
    suppressShortcuts: true,
    onKeyDown: (event) => {
      // The open palette suppresses app shortcuts, so its own namespace
      // shortcut is handled here.
      if (event.key.toLowerCase() === 'n' && modifiersMatch(event, selectNamespaceModifiers)) {
        return openInNamespaceMode();
      }
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return false;
      }
      const shortcut = paletteShortcuts.find((entry) => entry.key === event.key);
      return shortcut?.handler() ?? false;
    },
  });

  useShortcuts(paletteShortcuts, {
    priority: KeyboardShortcutPriority.COMMAND_PALETTE,
    category: 'Search',
  });

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

  // Held in a ref so the 'command-palette:open' subscription below stays
  // stable across the open/close re-renders that recreate
  // handleGlobalOpenShortcut.
  const openShortcutRef = useRef(handleGlobalOpenShortcut);
  useEffect(() => {
    openShortcutRef.current = handleGlobalOpenShortcut;
  }, [handleGlobalOpenShortcut]);

  // Open the palette directly in a selection sub-mode: kubeconfigs is the
  // "Open Cluster" surface (the "+" in the cluster tab bar, ⌘O, and File →
  // Open Cluster… all emit that event); namespaces is the ⇧⌘N shortcut below;
  // workspaces is File → Open Workspace…. open() resets the mode, so set it after.
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
  // File → Open Workspace… emits this event.
  const openInWorkspaceMode = useCallback(() => {
    openInSelectMode('workspaces');
  }, [openInSelectMode]);
  useEventBus('command-palette:open-workspaces', openInWorkspaceMode, [openInWorkspaceMode]);
  // Open the palette straight into namespace selection through the frontend
  // shortcut system, like ⌘⇧P above.
  useShortcut({
    key: 'n',
    modifiers: selectNamespaceModifiers,
    handler: openInNamespaceMode,
    description: 'Select namespace',
    category: 'Navigation',
    helpOrder: 30,
    enabled: true,
    priority: 100,
  });
  // Every application-menu path (accelerator, native menu, panel window) and
  // the header search button open the palette in its normal (search) mode
  // through this one guarded open.
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

  return createPortal(
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
      <dialog
        open
        className={[
          'command-palette',
          hideCursor ? 'hide-cursor' : null,
          mouseSelectionArmed ? 'mouse-selection-armed' : null,
        ]
          .filter(Boolean)
          .join(' ')}
        ref={containerRef}
        aria-label="Command Palette"
        aria-modal="true"
        tabIndex={-1}
      >
        <div className="command-palette-header">
          <input
            ref={inputRef}
            type="text"
            className="command-palette-input"
            placeholder={inputPlaceholder}
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
          <PaletteResults
            noResults={noResults}
            emptyMessage={paletteEmptyMessage(searchQuery, selectMode, savedWorkspaces.status)}
            hasCommandResults={hasCommandResults}
            commandGroups={commandGroups}
            catalogLoading={catalogLoading}
            catalogEntries={catalogDisplayItems}
            catalogStats={catalogStats}
            catalogBaseIndex={catalogBaseIndex}
            selectedIndex={selectedIndex}
            itemRefs={itemRefs}
            mouseSelectionArmedRef={mouseSelectionArmedRef}
            updateSelection={updateSelection}
            executePaletteItem={executePaletteItem}
          />
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
      </dialog>
    </ErrorBoundary>,
    document.body
  );
});
