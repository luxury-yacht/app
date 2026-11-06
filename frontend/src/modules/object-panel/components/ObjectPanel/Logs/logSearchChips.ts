/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Logs/logSearchChips.ts
 *
 * The search chips both log viewers show in their active-filters strip: the
 * text filter, which flags an invalid regular expression, each search option
 * that differs from its default, and the chosen log levels. Clear all resets
 * the same options.
 */

import type { ActiveFilterChip } from '@shared/components/ActiveFilterChips';
import {
  ALL_MULTISELECT_FILTER,
  filterSelectionValues,
  type MultiSelectFilterSelection,
} from '@shared/components/dropdowns/multiSelectFilterSelection';
import type { Dispatch } from 'react';
import { logLevelLabel } from './logLevels';
import type { LogOptionsAction, LogOptionsState } from './logOptionsReducer';

export type LogSearchChipOptions = Pick<
  LogOptionsState,
  'textFilter' | 'filterMode' | 'caseSensitiveMatches' | 'regexMatches'
> & {
  hasInvalidRegex: boolean;
  dispatch: Dispatch<LogOptionsAction>;
};

export const optionalActiveFilterChip = (
  enabled: boolean,
  chip: ActiveFilterChip
): ActiveFilterChip | null => (enabled ? chip : null);

export const buildTextFilterChip = ({
  textFilter,
  regexMatches,
  hasInvalidRegex,
  dispatch,
}: LogSearchChipOptions): ActiveFilterChip | null => {
  const trimmedTextFilter = textFilter.trim();
  if (!trimmedTextFilter) {
    return null;
  }
  let label = `Text: ${trimmedTextFilter}`;
  if (regexMatches) {
    label = hasInvalidRegex
      ? `Regex: ${trimmedTextFilter} (invalid expression)`
      : `Regex: ${trimmedTextFilter}`;
  }
  return {
    key: 'text-filter',
    label,
    removeLabel: 'Clear text filter',
    onRemove: () => dispatch({ type: 'SET_TEXT_FILTER', payload: '' }),
  };
};

/** Chips for the search options that differ from their defaults. */
export const buildSearchOptionChips = ({
  textFilter,
  filterMode,
  caseSensitiveMatches,
  regexMatches,
  dispatch,
}: LogSearchChipOptions): ActiveFilterChip[] =>
  [
    // All lines is the default, so only Filtered and Invert show a chip.
    optionalActiveFilterChip(filterMode !== 'all', {
      key: 'filter-mode',
      label: filterMode === 'filtered' ? 'Filtered' : 'Invert',
      removeLabel: 'Show all lines',
      onRemove: () => dispatch({ type: 'SET_FILTER_MODE', payload: 'all' }),
    }),
    optionalActiveFilterChip(caseSensitiveMatches, {
      key: 'case-sensitive',
      label: 'Match case',
      removeLabel: 'Disable case-sensitive matching',
      onRemove: () => dispatch({ type: 'TOGGLE_CASE_SENSITIVE_MATCHES' }),
    }),
    // With text, the text chip already says Regex.
    optionalActiveFilterChip(regexMatches && !textFilter.trim(), {
      key: 'regex',
      label: 'Regex',
      removeLabel: 'Disable regex matching',
      onRemove: () => dispatch({ type: 'TOGGLE_REGEX_MATCHES' }),
    }),
  ].filter((chip): chip is ActiveFilterChip => chip !== null);

/** The text chip and the search option chips, in that order. */
export const buildLogSearchChips = (options: LogSearchChipOptions): ActiveFilterChip[] => {
  const textChip = buildTextFilterChip(options);
  const optionChips = buildSearchOptionChips(options);
  return textChip ? [textChip, ...optionChips] : optionChips;
};

// The chip key for a filter that chose no level.
const NO_LEVELS_CHOSEN = '__no_levels_chosen__';

const removeLevel = (
  levelFilter: MultiSelectFilterSelection,
  value: string
): MultiSelectFilterSelection => {
  const values = filterSelectionValues(levelFilter).filter((chosen) => chosen !== value);
  return values.length > 0 ? { mode: 'some', values } : ALL_MULTISELECT_FILTER;
};

/** One chip per chosen level, or one for choosing none; removing one shows it again. */
export const buildLevelFilterChips = (
  levelFilter: MultiSelectFilterSelection,
  dispatch: Dispatch<LogOptionsAction>
): ActiveFilterChip[] => {
  if (levelFilter.mode === 'all') {
    return [];
  }
  const values =
    levelFilter.mode === 'none' ? [NO_LEVELS_CHOSEN] : filterSelectionValues(levelFilter);
  return values.map((value) => {
    const label = value === NO_LEVELS_CHOSEN ? 'No levels' : `Level: ${logLevelLabel(value)}`;
    return {
      key: `level-filter:${value}`,
      label,
      removeLabel: `Remove filter ${label}`,
      onRemove: () =>
        dispatch({
          type: 'SET_LEVEL_FILTER',
          payload:
            value === NO_LEVELS_CHOSEN ? ALL_MULTISELECT_FILTER : removeLevel(levelFilter, value),
        }),
    };
  });
};

/** Resets the text filter, every search option, and the level filter to their defaults. */
export const clearLogSearch = (
  dispatch: Dispatch<LogOptionsAction>,
  {
    caseSensitiveMatches,
    regexMatches,
  }: Pick<LogOptionsState, 'caseSensitiveMatches' | 'regexMatches'>
): void => {
  dispatch({ type: 'SET_TEXT_FILTER', payload: '' });
  dispatch({ type: 'SET_FILTER_MODE', payload: 'all' });
  dispatch({ type: 'SET_LEVEL_FILTER', payload: ALL_MULTISELECT_FILTER });
  if (caseSensitiveMatches) {
    dispatch({ type: 'TOGGLE_CASE_SENSITIVE_MATCHES' });
  }
  if (regexMatches) {
    dispatch({ type: 'TOGGLE_REGEX_MATCHES' });
  }
};
