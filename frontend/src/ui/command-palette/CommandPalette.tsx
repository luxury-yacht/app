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
import Tooltip from '@shared/components/Tooltip';
import { kindDisplayName, kindNameDisplay } from '@shared/kinds/kindDisplay';
import { getKindColorClass } from '@shared/utils/kindBadgeColors';
import { buildRequiredObjectReference } from '@shared/utils/objectIdentity';
import { withStableListKeys } from '@shared/utils/stableListKeys';
import { useKeyboardContext, useShortcut, useShortcuts } from '@ui/shortcuts';
import { KeyboardShortcutPriority } from '@ui/shortcuts/priorities';
import { modifiersMatch } from '@ui/shortcuts/utils';
import type React from 'react';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEventBus } from '@/core/events';
import type { CatalogItem } from '@/core/refresh/types';
import { usePreference } from '@/core/settings/usePreference';
import { aliasToKindMap } from '@/utils/kindAliasMap';
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
  'Favorite Clusters',
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

// A word that names a kind (its name, plural, short name or an alias) filters to
// that kind. Anything else, including the start of a kind's name, stays a search
// word: the search also matches each object's kind, so it still finds that kind
// without hiding other objects that contain the word.
const resolveKindToken = (token: string): string | null => {
  const aliasMatch = aliasToKindMap.get(token) ?? aliasToKindMap.get(token.replace(/s$/, ''));
  return aliasMatch ? aliasMatch.toLowerCase() : null;
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

interface QueryWord {
  text: string;
  // The lowercase kind this word filters to, or null for search text and spaces.
  kind: string | null;
}

// The raw query as typed (words and the spaces between them), each word with the
// kind it filters to — the same resolution parseQueryTokens uses — so the search
// box can mark kind words where they were typed.
const splitQueryWords = (query: string): QueryWord[] =>
  query
    .split(/(\s+)/)
    .filter(Boolean)
    .map((text) => ({
      text,
      kind: text.trim() ? resolveKindToken(text.toLowerCase()) : null,
    }));

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

// A picker lists only its own categories' choices.
const PICKER_CATEGORIES: Record<Exclude<PaletteSelectMode, 'none'>, readonly string[]> = {
  namespaces: ['Namespaces'],
  kubeconfigs: ['Favorite Clusters', 'Clusters'],
  workspaces: ['Workspaces'],
};

interface RankedCommand {
  command: Command;
  score: number;
}

// How well one search word matches a command, best first: the label starts with
// it, a word in the label starts with it, the label contains it, a keyword or the
// category contains it, only the (hidden) description contains it. Null: no match.
const scoreCommandWord = (command: Command, word: string): number | null => {
  const label = command.label.toLowerCase();
  if (label.startsWith(word)) {
    return 4;
  }
  if (label.split(/[^a-z0-9]+/).some((part) => part.startsWith(word))) {
    return 3;
  }
  if (label.includes(word)) {
    return 2;
  }
  const tags = [command.category ?? '', ...(command.keywords ?? [])];
  if (tags.some((tag) => tag.toLowerCase().includes(word))) {
    return 1;
  }
  return command.description?.toLowerCase().includes(word) ? 0 : null;
};

// Every word must match (the same every-word rule as object search, so spaces and
// word order never hide a match); the command's score is the sum.
const scoreCommand = (command: Command, words: string[]): number | null => {
  let score = 0;
  for (const word of words) {
    const wordScore = scoreCommandWord(command, word);
    if (wordScore === null) {
      return null;
    }
    score += wordScore;
  }
  return score;
};

// The commands matching every word of the query, best first. The sort is stable,
// so ties (and every command when the query is empty) keep their listed order.
const rankCommands = (commands: Command[], query: string): RankedCommand[] => {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return commands
    .map((command) => ({ command, score: scoreCommand(command, words) }))
    .filter((ranked): ranked is RankedCommand => ranked.score !== null)
    .sort((a, b) => b.score - a.score);
};

const commandsForMode = (mode: PaletteSelectMode, commands: Command[]): Command[] =>
  mode === 'none'
    ? commands
    : commands.filter((cmd) => PICKER_CATEGORIES[mode].includes(cmd.category ?? ''));

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

// Groups ranked commands under their category headings: the group with the best
// match first (ties in CATEGORY_ORDER), each group's commands best first.
const groupCommandsByCategory = (ranked: RankedCommand[]): CommandGroup[] => {
  // Ranked best first, so a group's first command carries its best score.
  const byCategory = new Map<string, { best: number; commands: Command[] }>();
  for (const { command, score } of ranked) {
    const category = command.category || 'General';
    const group = byCategory.get(category);
    if (group) {
      group.commands.push(command);
    } else {
      byCategory.set(category, { best: score, commands: [command] });
    }
  }
  let startIndex = 0;
  return Array.from(byCategory.entries())
    .sort(([a, groupA], [b, groupB]) => groupB.best - groupA.best || compareCategories(a, b))
    .map(([category, { commands: groupCommands }]) => {
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

// The fields a search word may match: the server's (name, namespace, kind), plus
// `namespace/name` so a typed path matches.
interface CatalogSearchFields {
  namespace: string;
  name: string;
  combined: string;
  kind: string;
}

const scoreKindTokens = (kindTokens: string[], kindCanonical: string): number | null => {
  if (kindTokens.length === 0) {
    return 0;
  }
  return kindTokens.includes(kindCanonical) ? 100 : null;
};

const scoreSearchToken = (token: string, fields: CatalogSearchFields): number | null => {
  let score = 0;
  if (fields.namespace.includes(token)) {
    score += fields.namespace === token ? 30 : 20;
  }
  if (fields.name.includes(token)) {
    score += fields.name === token ? 60 : 40;
  }
  if (score > 0) {
    return score;
  }
  // Weaker matches: across the namespace/name boundary, then the kind alone.
  if (fields.combined.includes(token)) {
    return 10;
  }
  return fields.kind.includes(token) ? 5 : null;
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
    kind: item.ref.kind.toLowerCase(),
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

const SWALLOWED_PRESS_EVENTS = [
  'mousedown',
  'pointerup',
  'mouseup',
  'click',
  'auxclick',
  'contextmenu',
] as const;

// Swallows the rest of a press that closed the palette, before the app sees it.
// The listeners outlive the palette (the press continues after it closes) and
// remove themselves at that press's click, or at the next press if it never
// produced one (dragged off the window, right-click).
const swallowRestOfPress = () => {
  const done = new AbortController();
  const swallow = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.type === 'click') {
      done.abort();
    }
  };
  for (const type of SWALLOWED_PRESS_EVENTS) {
    document.addEventListener(type, swallow, { capture: true, signal: done.signal });
  }
  document.addEventListener('pointerdown', () => done.abort(), {
    capture: true,
    signal: done.signal,
  });
};

const KIND_FILTERS_ID = 'command-palette-kind-filters';
const NO_KINDS: string[] = [];

// Sits under the transparent search input with the same text metrics, tinting each
// kind word in its kind's color. Renders nothing when no word is a kind.
const KindWordBackdrop = ({
  query,
  backdropRef,
}: {
  query: string;
  backdropRef: React.RefObject<HTMLDivElement | null>;
}) => {
  const words = useMemo(() => splitQueryWords(query), [query]);
  if (!words.some((word) => word.kind)) {
    return null;
  }
  return (
    <div ref={backdropRef} className="command-palette-input-backdrop" aria-hidden="true">
      {withStableListKeys(words, (word) => word.text).map(({ key, value: word }) =>
        word.kind ? (
          <mark key={key} className={`command-palette-kind-word ${getKindColorClass(word.kind)}`}>
            {word.text}
          </mark>
        ) : (
          <span key={key}>{word.text}</span>
        )
      )}
    </div>
  );
};

// The kinds the search is limited to, at the end of the search row; the input
// names this element as its description while it exists.
const KindFilters = ({
  kinds,
  useShortResourceNames,
}: {
  kinds: string[];
  useShortResourceNames: boolean;
}) => {
  if (kinds.length === 0) {
    return null;
  }
  const names = kinds.map((kind) => kindNameDisplay(kind, useShortResourceNames));
  return (
    <div id={KIND_FILTERS_ID} className="command-palette-kind-filters">
      <span className="sr-only">Searching only these kinds: {names.join(', ')}</span>
      {kinds.map((kind, index) => (
        <span key={kind} className={`kind-badge ${getKindColorClass(kind)}`} aria-hidden="true">
          {names[index]}
        </span>
      ))}
    </div>
  );
};

const SEARCH_HELP = (
  <div className="command-palette-help">
    <p>You can use multiple search words to narrow down results.</p>
    <p>
      If one or more search words match a kind name or its short alias (e.g. pod, svc, deployment),
      it shows only those kinds. The word is highlighted and its kind appears beside this icon.
    </p>
  </div>
);

interface PaletteSearchRowProps {
  inputRef: React.RefObject<HTMLInputElement | null>;
  query: string;
  // General search (not a picker): marks kind words and offers search help.
  generalSearch: boolean;
  kindTokens: string[];
  useShortResourceNames: boolean;
  label: string;
  placeholder: string;
  resultsId: string;
  selectedOptionId: string | undefined;
  onQueryChange: (query: string) => void;
  onKeyDown: React.KeyboardEventHandler<HTMLInputElement>;
}

const PaletteSearchRow = ({
  inputRef,
  query,
  generalSearch,
  kindTokens,
  useShortResourceNames,
  label,
  placeholder,
  resultsId,
  selectedOptionId,
  onQueryChange,
  onKeyDown,
}: Readonly<PaletteSearchRowProps>) => {
  const kindFilters = generalSearch ? kindTokens : NO_KINDS;
  const backdropRef = useRef<HTMLDivElement>(null);
  const syncBackdropScroll = useCallback(() => {
    if (backdropRef.current && inputRef.current) {
      backdropRef.current.scrollLeft = inputRef.current.scrollLeft;
    }
  }, [inputRef]);
  // Typing can scroll a long query sideways; keep the marks under their words.
  useLayoutEffect(syncBackdropScroll);
  return (
    <div className="command-palette-header">
      <div className="command-palette-field">
        {generalSearch ? <KindWordBackdrop query={query} backdropRef={backdropRef} /> : null}
        <input
          ref={inputRef}
          type="text"
          className="command-palette-input"
          placeholder={placeholder}
          value={query}
          role="combobox"
          aria-label={label}
          aria-describedby={kindFilters.length > 0 ? KIND_FILTERS_ID : undefined}
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls={resultsId}
          aria-activedescendant={selectedOptionId}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={onKeyDown}
          onScroll={syncBackdropScroll}
        />
      </div>
      <KindFilters kinds={kindFilters} useShortResourceNames={useShortResourceNames} />
      {generalSearch ? (
        <span className="command-palette-help-trigger">
          <Tooltip
            content={SEARCH_HELP}
            triggerLabel="Search help"
            placement="bottom"
            maxWidth={320}
          />
        </span>
      ) : null}
    </div>
  );
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

  // This mode's commands that match every word of the search, best match first.
  const rankedCommands = useMemo(
    () => rankCommands(commandsForMode(selectMode, allCommands), searchQuery),
    [allCommands, searchQuery, selectMode]
  );

  const commandGroups = useMemo(() => groupCommandsByCategory(rankedCommands), [rankedCommands]);

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

  const hasCommandResults = rankedCommands.length > 0;
  const hasCatalogResults = catalogDisplayItems.length > 0;
  // While the workspace picker's list is still being read, it claims nothing.
  const workspacesLoading = selectMode === 'workspaces' && savedWorkspaces.status === 'loading';
  const noResults =
    !hasCommandResults && !hasCatalogResults && !catalogLoading && !workspacesLoading;

  const catalogBaseIndex = rankedCommands.length;

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

  // A press outside closes the palette. It is caught before the app sees it and
  // the rest of that press is swallowed, so dismissing never also clicks whatever
  // was under the pointer.
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePressOutside = (event: PointerEvent) => {
      if (!containerRef.current || containerRef.current.contains(event.target as Node)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      swallowRestOfPress();
      close();
    };

    document.addEventListener('pointerdown', handlePressOutside, true);
    return () => {
      document.removeEventListener('pointerdown', handlePressOutside, true);
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
      {/* Dims the app behind the palette, like the shared dialog backdrop. Visual
          only: presses outside the palette are handled by the palette itself. */}
      <div className="command-palette-backdrop" aria-hidden="true" />
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
        // Lets tooltips inside the palette layer above it.
        data-modal-surface="true"
        tabIndex={-1}
      >
        <PaletteSearchRow
          inputRef={inputRef}
          query={searchQuery}
          generalSearch={selectMode === 'none'}
          kindTokens={parsedTokens.kindTokens}
          useShortResourceNames={useShortResourceNames}
          label={inputLabel}
          placeholder={inputPlaceholder}
          resultsId={resultsId}
          selectedOptionId={selectedOptionId}
          onQueryChange={(query) => {
            setSearchQuery(query);
            setSelectedIndex(0);
          }}
          onKeyDown={handleInputKeyDown}
        />

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
