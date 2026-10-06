/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Logs/logToolbar.tsx
 *
 * The toolbar controls shared by Container Logs and Node Logs: the icon bar, the
 * search row its search button opens (the text filter box and the search
 * options), and the shown/total log count. Timestamps and previous logs are optional icon
 * bar features a viewer passes when it has them.
 */

import IconBar, { type IconBarItem } from '@shared/components/IconBar/IconBar';
import {
  AllLinesIcon,
  AnsiColorIcon,
  FilterModeIcon,
  InvertFilterIcon,
  ParseJsonIcon,
  PrettyJsonIcon,
  PreviousLogsIcon,
  RawLogIcon,
  RegexSearchIcon,
  TimestampIcon,
  WrapTextIcon,
} from '@shared/components/icons/LogIcons';
import {
  CaseSensitiveIcon,
  PlayOutlineIcon,
  SearchIcon,
  StopOutlineIcon,
} from '@shared/components/icons/SharedIcons';
import type { Dispatch, ReactNode, RefObject } from 'react';
import { flushSync } from 'react-dom';
import { isMacPlatform } from '@/utils/platform';
import type { LogDisplayMode, LogFilterMode } from '../types';
import type { LogOptionsAction, LogOptionsState } from './logOptionsReducer';

type ToggleFeature = { active: boolean; toggle: () => void };

// The time zone is the app-wide Logs setting; the viewer applies the choice.
type TimestampsFeature = ToggleFeature & {
  useLocalTimeZone: boolean;
  chooseTimeZone: (useLocalTimeZone: boolean) => void;
};

export type LogToolbarOptions = {
  options: LogOptionsState;
  dispatch: Dispatch<LogOptionsAction>;
  hasAnsiLogEntries: boolean;
  canParseLogs: boolean;
  /** A log line has arrived. Until then search, timestamps and wrap are disabled. */
  hasLogs: boolean;
  /** The view's Download menu (useLogDownloadMenu). */
  downloadItem: IconBarItem;
  filterInputRef: RefObject<HTMLInputElement | null>;
  /** Id of the viewer's search row, which the search button shows and hides. */
  searchRowId: string;
  previousLogs?: ToggleFeature;
  timestamps?: TimestampsFeature;
};

// One choice of a cycle button, and the choice a click on the button moves to.
type CycleChoice<M extends string> = { label: string; icon: ReactNode; next: M };

// A split button that steps through its choices on click; its menu, listing the
// choices in table order, picks one. No choice is "on", so it is never highlighted.
const cycleSplitItem = <M extends string>({
  id,
  name,
  menuHeader,
  choices,
  current,
  select,
  shortcutHint,
}: {
  id: string;
  name: string;
  menuHeader: string;
  choices: Record<M, CycleChoice<M>>;
  current: M;
  select: (choice: M) => void;
  shortcutHint: string;
}): IconBarItem => {
  const choice = choices[current];
  return {
    type: 'split',
    behavior: 'cycle',
    id,
    icon: choice.icon,
    active: false,
    onClick: () => select(choice.next),
    title: `${name}: ${choice.label} - click for ${choices[choice.next].label} ${shortcutHint}`,
    ariaLabel: `${name}: ${choice.label}`,
    menuLabel: `Choose ${name.toLowerCase()}`,
    menuItems: [
      { header: true, label: menuHeader },
      ...(Object.keys(choices) as M[]).map((mode) => ({
        label: choices[mode].label,
        checked: mode === current,
        onClick: () => select(mode),
      })),
    ],
  };
};

// Matches are highlighted in every mode except Invert, which shows the other lines.
const FILTER_MODES: Record<LogFilterMode, CycleChoice<LogFilterMode>> = {
  all: { label: 'All', icon: <AllLinesIcon width={16} height={16} />, next: 'filtered' },
  filtered: { label: 'Filtered', icon: <FilterModeIcon width={16} height={16} />, next: 'invert' },
  invert: { label: 'Invert', icon: <InvertFilterIcon width={16} height={16} />, next: 'all' },
};

const searchItems = ({
  options,
  dispatch,
}: Pick<LogToolbarOptions, 'options' | 'dispatch'>): IconBarItem[] => [
  cycleSplitItem({
    id: 'filterMode',
    name: 'Filter mode',
    menuHeader: 'Mode',
    choices: FILTER_MODES,
    current: options.filterMode,
    select: (mode) => dispatch({ type: 'SET_FILTER_MODE', payload: mode }),
    shortcutHint: '(I invert)',
  }),
  {
    type: 'toggle',
    id: 'caseSensitiveSearch',
    icon: <CaseSensitiveIcon width={18} height={18} />,
    active: options.caseSensitiveMatches,
    onClick: () => dispatch({ type: 'TOGGLE_CASE_SENSITIVE_MATCHES' }),
    title: 'Case-sensitive search - disabled when regex is enabled (C)',
    ariaLabel: 'Case-sensitive search - disabled when regex is enabled',
    disabled: options.regexMatches,
  },
  {
    type: 'toggle',
    id: 'regexSearch',
    icon: <RegexSearchIcon width={16} height={16} />,
    active: options.regexMatches,
    onClick: () => dispatch({ type: 'TOGGLE_REGEX_MATCHES' }),
    title: 'Enable regular expression support for the text filter (X)',
    ariaLabel: 'Enable regular expression support for the text filter',
  },
];

const sourceItems = ({ previousLogs, timestamps, hasLogs }: LogToolbarOptions): IconBarItem[] => {
  const items: IconBarItem[] = [];
  if (previousLogs) {
    items.push({
      type: 'toggle',
      id: 'previousLogs',
      icon: <PreviousLogsIcon width={18} height={18} />,
      active: previousLogs.active,
      onClick: previousLogs.toggle,
      title: 'Show previous logs (V)',
      ariaLabel: 'Show previous logs (V)',
    });
  }
  if (timestamps) {
    items.push({
      type: 'split',
      behavior: 'toggle',
      id: 'apiTimestamps',
      icon: <TimestampIcon width={15} height={15} />,
      label: timestamps.useLocalTimeZone ? 'LOCAL' : 'UTC',
      active: timestamps.active,
      onClick: timestamps.toggle,
      title: 'Show timestamps from the Kubernetes API (T)',
      ariaLabel: 'Show timestamps from the Kubernetes API',
      disabled: !hasLogs,
      menuLabel: 'Timestamp time zone',
      menuItems: [
        { header: true, label: 'Time zone' },
        {
          label: 'UTC',
          checked: !timestamps.useLocalTimeZone,
          onClick: () => timestamps.chooseTimeZone(false),
        },
        {
          label: `Local (${Intl.DateTimeFormat().resolvedOptions().timeZone})`,
          checked: timestamps.useLocalTimeZone,
          onClick: () => timestamps.chooseTimeZone(true),
        },
      ],
    });
  }
  return items;
};

const LOG_FORMATS: Record<LogDisplayMode, CycleChoice<LogDisplayMode>> = {
  raw: { label: 'Raw', icon: <RawLogIcon width={18} height={18} />, next: 'pretty' },
  pretty: { label: 'Pretty', icon: <PrettyJsonIcon width={18} height={18} />, next: 'parsed' },
  parsed: { label: 'Table', icon: <ParseJsonIcon width={16} height={16} />, next: 'raw' },
};

const logFormatItem = (
  displayMode: LogDisplayMode,
  dispatch: Dispatch<LogOptionsAction>
): IconBarItem =>
  cycleSplitItem({
    id: 'logFormat',
    name: 'Log format',
    menuHeader: 'Format',
    choices: LOG_FORMATS,
    current: displayMode,
    select: (mode) => dispatch({ type: 'SET_DISPLAY_MODE', payload: mode }),
    shortcutHint: '(J pretty, P table)',
  });

const displayItems = ({
  options,
  dispatch,
  hasAnsiLogEntries,
  canParseLogs,
  hasLogs,
}: LogToolbarOptions): IconBarItem[] => {
  const isParsedView = options.displayMode === 'parsed';
  const items: IconBarItem[] = [];
  if (hasAnsiLogEntries) {
    items.push({
      type: 'toggle',
      id: 'ansiColors',
      icon: <AnsiColorIcon width={20} height={20} />,
      active: options.showAnsiColors,
      onClick: () => dispatch({ type: 'TOGGLE_SHOW_ANSI_COLORS' }),
      title: 'Show ANSI colors if present (O)',
      ariaLabel: 'Show ANSI colors if present',
      disabled: isParsedView,
    });
  }
  if (canParseLogs) {
    items.push(logFormatItem(options.displayMode, dispatch));
  }
  items.push({
    type: 'toggle',
    id: 'wrapText',
    icon: <WrapTextIcon width={20} height={20} />,
    active: options.wrapText,
    onClick: () => dispatch({ type: 'TOGGLE_WRAP_TEXT' }),
    title: 'Wrap text (W)',
    ariaLabel: 'Wrap text',
    // Wrapping has no effect in Table view.
    disabled: isParsedView || !hasLogs,
  });
  return items;
};

const actionItems = ({ downloadItem }: LogToolbarOptions): IconBarItem[] => [
  { type: 'separator' },
  downloadItem,
];

/** Opens the search row and puts the cursor in its filter box. */
export const openLogSearch = (
  dispatch: Dispatch<LogOptionsAction>,
  inputRef: RefObject<HTMLInputElement | null>
): void => {
  // The box exists only once the row renders, so render it before focusing.
  flushSync(() => dispatch({ type: 'SET_SEARCH_OPEN', payload: true }));
  inputRef.current?.focus();
  inputRef.current?.select();
};

/** Closes the search row, first moving focus inside it to the search button. */
export const closeLogSearch = (dispatch: Dispatch<LogOptionsAction>, searchRowId: string): void => {
  if (document.getElementById(searchRowId)?.contains(document.activeElement)) {
    document.querySelector<HTMLElement>(`[aria-controls="${searchRowId}"]`)?.focus();
  }
  dispatch({ type: 'SET_SEARCH_OPEN', payload: false });
};

/**
 * Search, and the filter options in its row, need a log line to search. A row
 * that is already open stays usable so it can be closed after the logs empty out.
 */
export const logSearchAvailable = (hasLogs: boolean, searchOpen: boolean): boolean =>
  hasLogs || searchOpen;

const searchButton = ({
  options,
  dispatch,
  filterInputRef,
  searchRowId,
  hasLogs,
}: LogToolbarOptions): IconBarItem => ({
  type: 'disclosure',
  id: 'search',
  icon: <SearchIcon width={16} height={16} />,
  expanded: options.searchOpen,
  controls: searchRowId,
  // A closed row's filter still narrows the logs, so the button stays highlighted.
  active: options.searchOpen || options.textFilter.trim().length > 0,
  onClick: () =>
    options.searchOpen
      ? dispatch({ type: 'SET_SEARCH_OPEN', payload: false })
      : openLogSearch(dispatch, filterInputRef),
  title: `Search logs (${isMacPlatform() ? '⌘F' : 'Ctrl+F'})`,
  ariaLabel: 'Search logs',
  disabled: !logSearchAvailable(hasLogs, options.searchOpen),
});

/** Builds the log viewer icon bar: auto-refresh, search, source and display, actions. */
export const buildLogToolbarItems = (toolbar: LogToolbarOptions): IconBarItem[] => [
  {
    // Like the other choice buttons it is never highlighted: the icon and name say what a click does.
    type: 'action',
    id: 'autoRefresh',
    // The icon shows what a click does: stop while refreshing, play while stopped.
    icon: toolbar.options.autoRefresh ? (
      <StopOutlineIcon width={18} height={18} className="logs-viewer-stop-icon" />
    ) : (
      <PlayOutlineIcon width={18} height={18} className="logs-viewer-play-icon" />
    ),
    onClick: () => toolbar.dispatch({ type: 'TOGGLE_AUTO_REFRESH' }),
    title: `${toolbar.options.autoRefresh ? 'Stop' : 'Start'} auto-refresh (R)`,
    ariaLabel: `${toolbar.options.autoRefresh ? 'Stop' : 'Start'} auto-refresh`,
  },
  { type: 'separator' },
  searchButton(toolbar),
  { type: 'separator' },
  ...sourceItems(toolbar),
  ...displayItems(toolbar),
  ...actionItems(toolbar),
];

/** The text filter box, with a button that clears it. */
const LogTextFilter = ({
  inputRef,
  value,
  dispatch,
  ariaLabel,
  title,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  value: string;
  dispatch: Dispatch<LogOptionsAction>;
  ariaLabel?: string;
  title?: string;
}) => (
  <div className="logs-viewer-control-group logs-viewer-filter-group">
    <input
      type="text"
      ref={inputRef}
      value={value}
      onChange={(event) => dispatch({ type: 'SET_TEXT_FILTER', payload: event.target.value })}
      placeholder="Filter"
      className="logs-viewer-text-filter"
      aria-label={ariaLabel}
      title={title}
    />
    {!!value && (
      <button
        type="button"
        className="logs-viewer-filter-clear"
        onClick={() => dispatch({ type: 'SET_TEXT_FILTER', payload: '' })}
        title="Clear filter"
        aria-label="Clear filter"
      >
        ×
      </button>
    )}
  </div>
);

/**
 * How many logs are shown out of the total, while a filter hides some; otherwise
 * null, so the active-filters strip disappears when it has no chips either.
 */
export const renderLogCount = (shown: number, total: number, filtered: boolean): ReactNode =>
  filtered ? (
    <span className="active-filter-chips__summary logs-viewer-count">
      {shown}/{total} logs
    </span>
  ) : null;

/** The search row: the text filter box and the search options. */
export const LogSearchRow = ({
  id,
  inputRef,
  options,
  dispatch,
  ariaLabel,
  title,
}: {
  id: string;
  inputRef: RefObject<HTMLInputElement | null>;
  options: LogOptionsState;
  dispatch: Dispatch<LogOptionsAction>;
  ariaLabel?: string;
  title?: string;
}) => (
  <div className="logs-viewer-search-row" id={id}>
    <LogTextFilter
      inputRef={inputRef}
      value={options.textFilter}
      dispatch={dispatch}
      ariaLabel={ariaLabel}
      title={title}
    />
    <IconBar items={searchItems({ options, dispatch })} />
  </div>
);
