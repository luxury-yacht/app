/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Logs/logToolbar.tsx
 *
 * The toolbar controls shared by Container Logs and Node Logs: the text filter
 * box, the icon bar and the match count. Timestamps and previous logs are
 * optional icon bar features a viewer passes when it has them.
 */

import type { IconBarItem } from '@shared/components/IconBar/IconBar';
import {
  AnsiColorIcon,
  AutoRefreshIcon,
  CopyIcon,
  HighlightSearchIcon,
  InverseSearchIcon,
  ParseJsonIcon,
  PrettyJsonIcon,
  PreviousLogsIcon,
  RegexSearchIcon,
  TimestampIcon,
  WrapTextIcon,
} from '@shared/components/icons/LogIcons';
import { CaseSensitiveIcon } from '@shared/components/icons/SharedIcons';
import type { Dispatch, RefObject } from 'react';
import type { CopyFeedback, LogOptionsAction, LogOptionsState } from './logOptionsReducer';

type ToggleFeature = { active: boolean; toggle: () => void };

export type LogToolbarOptions = {
  options: LogOptionsState;
  dispatch: Dispatch<LogOptionsAction>;
  hasAnsiLogEntries: boolean;
  canParseLogs: boolean;
  hasCopyableContent: boolean;
  copyLogs: () => void;
  previousLogs?: ToggleFeature;
  timestamps?: ToggleFeature;
};

const copyIconFeedback = (feedback: CopyFeedback): 'success' | 'error' | null => {
  if (feedback === 'copied') {
    return 'success';
  }
  return feedback === 'error' ? 'error' : null;
};

const searchItems = ({ options, dispatch }: LogToolbarOptions): IconBarItem[] => [
  {
    type: 'toggle',
    id: 'highlightSearch',
    icon: <HighlightSearchIcon width={16} height={16} />,
    active: options.highlightMatches,
    onClick: () => dispatch({ type: 'TOGGLE_HIGHLIGHT_MATCHES' }),
    title: 'Highlight matching text - disabled when Invert is enabled (H)',
    ariaLabel: 'Highlight matching text - disabled when Invert is enabled',
    disabled: options.inverseMatches,
  },
  {
    type: 'toggle',
    id: 'inverseSearch',
    icon: <InverseSearchIcon width={18} height={18} />,
    active: options.inverseMatches,
    onClick: () => dispatch({ type: 'TOGGLE_INVERSE_MATCHES' }),
    title: 'Invert the text filter to show only non-matching logs (I)',
    ariaLabel: 'Invert the text filter to show only non-matching logs',
  },
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

const sourceItems = ({ previousLogs, timestamps }: LogToolbarOptions): IconBarItem[] => {
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
      type: 'toggle',
      id: 'apiTimestamps',
      icon: <TimestampIcon width={18} height={18} />,
      active: timestamps.active,
      onClick: timestamps.toggle,
      title: 'Show timestamps from the Kubernetes API (T)',
      ariaLabel: 'Show timestamps from the Kubernetes API',
    });
  }
  return items;
};

const displayItems = ({
  options,
  dispatch,
  hasAnsiLogEntries,
  canParseLogs,
}: LogToolbarOptions): IconBarItem[] => {
  const isParsedView = options.displayMode === 'parsed';
  const items: IconBarItem[] = [
    {
      type: 'toggle',
      id: 'wrapText',
      icon: <WrapTextIcon width={20} height={20} />,
      active: options.wrapText,
      onClick: () => dispatch({ type: 'TOGGLE_WRAP_TEXT' }),
      title: 'Wrap text (W)',
      ariaLabel: 'Wrap text',
      disabled: isParsedView,
    },
  ];
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
    items.push(
      {
        type: 'toggle',
        id: 'prettyJson',
        icon: <PrettyJsonIcon width={18} height={18} />,
        active: options.displayMode === 'pretty',
        onClick: () =>
          dispatch({
            type: 'SET_DISPLAY_MODE',
            payload: options.displayMode === 'pretty' ? 'raw' : 'pretty',
          }),
        title: 'Show pretty JSON (J)',
        ariaLabel: 'Show pretty JSON',
      },
      {
        type: 'toggle',
        id: 'parsedJson',
        icon: <ParseJsonIcon width={16} height={16} />,
        active: isParsedView,
        onClick: () =>
          dispatch({ type: 'SET_DISPLAY_MODE', payload: isParsedView ? 'raw' : 'parsed' }),
        title: 'Parse the JSON into a table (P)',
        ariaLabel: 'Parse the JSON into a table',
      }
    );
  }
  return items;
};

const actionItems = ({
  options,
  hasCopyableContent,
  copyLogs,
}: LogToolbarOptions): IconBarItem[] => {
  const items: IconBarItem[] = [{ type: 'separator' }];
  items.push({
    type: 'action',
    id: 'copy',
    icon: <CopyIcon width={18} height={18} />,
    onClick: copyLogs,
    title: 'Copy logs to clipboard (Shift+C)',
    ariaLabel: 'Copy to clipboard',
    disabled: !hasCopyableContent,
    feedback: copyIconFeedback(options.copyFeedback),
  });
  return items;
};

/** Builds the log viewer icon bar: search, auto-refresh, source, display, actions. */
export const buildLogToolbarItems = (toolbar: LogToolbarOptions): IconBarItem[] => [
  ...searchItems(toolbar),
  { type: 'separator' },
  {
    type: 'toggle',
    id: 'autoRefresh',
    icon: <AutoRefreshIcon width={18} height={18} />,
    active: toolbar.options.autoRefresh,
    onClick: () => toolbar.dispatch({ type: 'TOGGLE_AUTO_REFRESH' }),
    title: 'Toggle auto-refresh (R)',
    ariaLabel: 'Toggle auto-refresh',
  },
  ...sourceItems(toolbar),
  ...displayItems(toolbar),
  ...actionItems(toolbar),
];

/** The text filter box, with a button that clears it. */
export const LogTextFilter = ({
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

/** How many logs match; shown only while a filter narrows the logs. */
export const LogMatchCount = ({ count, filtered }: { count: number; filtered: boolean }) =>
  filtered ? (
    <span className="logs-viewer-count">
      {count} matching {count === 1 ? 'log' : 'logs'}
    </span>
  ) : null;
