/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Logs/containerLogFilters.ts
 *
 * Container Logs source filters: container kinds and labels, the pod and container
 * filter values, the source selector's options, and the active filter chips.
 */

import type { types } from '@core/backend-api/models';
import type { ActiveFilterChip } from '@shared/components/ActiveFilterChips';
import type { DropdownOption } from '@shared/components/dropdowns/Dropdown';
import { ALL_MULTISELECT_FILTER } from '@shared/components/dropdowns/multiSelectFilterSelection';
import type React from 'react';
import { logFilterSelectionLabel } from './logFilterSelection';
import type { LogViewerAction } from './logViewerReducer';

export type LogContainerKind = 'regular' | 'init' | 'ephemeral';

interface LogContainerTraits {
  isInit?: boolean;
  isEphemeral?: boolean;
}

export const logContainerKind = (traits: LogContainerTraits): LogContainerKind => {
  if (traits.isInit) {
    return 'init';
  }
  if (traits.isEphemeral) {
    return 'ephemeral';
  }
  return 'regular';
};

const CONTAINER_LABEL_SUFFIX: Record<LogContainerKind, string> = {
  regular: '',
  init: ':init',
  ephemeral: ' (debug)',
};

export const formatContainerLabel = (container: string, kind: LogContainerKind): string =>
  `${container}${CONTAINER_LABEL_SUFFIX[kind]}`;

const POD_FILTER_PREFIX = 'pod:';
export const INIT_FILTER_PREFIX = 'init:';
export const CONTAINER_FILTER_PREFIX = 'container:';
export const DEBUG_FILTER_PREFIX = 'debug:';

export const toPodFilterValue = (pod: string): string => `${POD_FILTER_PREFIX}${pod}`;
const toInitContainerFilterValue = (container: string): string =>
  `${INIT_FILTER_PREFIX}${container}`;
const toContainerFilterValue = (container: string): string =>
  `${CONTAINER_FILTER_PREFIX}${container}`;
const toDebugContainerFilterValue = (container: string): string =>
  `${DEBUG_FILTER_PREFIX}${container}`;

const CONTAINER_FILTER_VALUE: Record<LogContainerKind, (container: string) => string> = {
  regular: toContainerFilterValue,
  init: toInitContainerFilterValue,
  ephemeral: toDebugContainerFilterValue,
};

export const toContainerFilterValueForKind = (container: string, kind: LogContainerKind): string =>
  CONTAINER_FILTER_VALUE[kind](container);

// Init containers have their own group, so only debug containers are marked.
export const containerSelectorOptions = (
  containers: types.PodContainer[],
  kind: LogContainerKind,
  group: string
): DropdownOption[] =>
  containers
    .filter((container) => logContainerKind(container) === kind)
    .map((container) => ({
      value: toContainerFilterValueForKind(container.name, kind),
      label: kind === 'ephemeral' ? `${container.name} (debug)` : container.name,
      group,
    }))
    .sort((left, right) => left.label.localeCompare(right.label));

const formatSelectedFilterLabel = (
  filterValue: string,
  optionsByValue: Map<string, string>
): string => {
  const knownLabel = optionsByValue.get(filterValue);
  if (knownLabel) {
    return knownLabel;
  }
  if (filterValue.startsWith(POD_FILTER_PREFIX)) {
    return filterValue.substring(POD_FILTER_PREFIX.length);
  }
  if (filterValue.startsWith(INIT_FILTER_PREFIX)) {
    return filterValue.substring(INIT_FILTER_PREFIX.length);
  }
  if (filterValue.startsWith(CONTAINER_FILTER_PREFIX)) {
    return filterValue.substring(CONTAINER_FILTER_PREFIX.length);
  }
  if (filterValue.startsWith(DEBUG_FILTER_PREFIX)) {
    return `${filterValue.substring(DEBUG_FILTER_PREFIX.length)} (debug)`;
  }
  return filterValue;
};

const buildTextFilterChip = (
  textFilter: string,
  regexMatches: boolean,
  hasInvalidRegex: boolean,
  dispatch: React.Dispatch<LogViewerAction>
): ActiveFilterChip | null => {
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

const removeSelectedFilterValue = (selectedValues: string[], filterValue: string) => {
  const values = selectedValues.filter((value) => value !== filterValue);
  return values.length > 0 ? { mode: 'some' as const, values } : ALL_MULTISELECT_FILTER;
};

const buildSelectedFilterChips = (
  selectedFilterValues: string[],
  optionsByValue: Map<string, string>,
  dispatch: React.Dispatch<LogViewerAction>
): ActiveFilterChip[] =>
  selectedFilterValues.map((filterValue) => {
    const label =
      logFilterSelectionLabel(filterValue) ??
      formatSelectedFilterLabel(filterValue, optionsByValue);
    return {
      key: `selected-filter:${filterValue}`,
      label,
      removeLabel: `Remove filter ${label}`,
      onRemove: () =>
        dispatch({
          type: 'SET_SELECTED_FILTERS',
          payload: removeSelectedFilterValue(selectedFilterValues, filterValue),
        }),
    };
  });

const optionalActiveFilterChip = (
  enabled: boolean,
  chip: ActiveFilterChip
): ActiveFilterChip | null => (enabled ? chip : null);

export const buildActiveLogFilterChips = ({
  textFilter,
  regexMatches,
  hasInvalidRegex,
  showPreviousContainerLogs,
  selectedFilterValues,
  selectorOptionLabelsByValue,
  highlightMatches,
  inverseMatches,
  caseSensitiveMatches,
  dispatch,
  stopPreviousLogs,
}: {
  textFilter: string;
  regexMatches: boolean;
  hasInvalidRegex: boolean;
  showPreviousContainerLogs: boolean;
  selectedFilterValues: string[];
  selectorOptionLabelsByValue: Map<string, string>;
  highlightMatches: boolean;
  inverseMatches: boolean;
  caseSensitiveMatches: boolean;
  dispatch: React.Dispatch<LogViewerAction>;
  stopPreviousLogs: () => void;
}): ActiveFilterChip[] => {
  const chips = [
    buildTextFilterChip(textFilter, regexMatches, hasInvalidRegex, dispatch),
    optionalActiveFilterChip(showPreviousContainerLogs, {
      key: 'previous-logs',
      label: 'Showing previous logs',
      removeLabel: 'Return to live logs',
      onRemove: stopPreviousLogs,
    }),
    ...buildSelectedFilterChips(selectedFilterValues, selectorOptionLabelsByValue, dispatch),
    optionalActiveFilterChip(highlightMatches, {
      key: 'highlight',
      label: 'Highlight',
      removeLabel: 'Disable highlight matches',
      onRemove: () => dispatch({ type: 'TOGGLE_HIGHLIGHT_MATCHES' }),
    }),
    optionalActiveFilterChip(inverseMatches, {
      key: 'invert',
      label: 'Invert',
      removeLabel: 'Disable invert filter',
      onRemove: () => dispatch({ type: 'TOGGLE_INVERSE_MATCHES' }),
    }),
    optionalActiveFilterChip(caseSensitiveMatches, {
      key: 'case-sensitive',
      label: 'Match case',
      removeLabel: 'Disable case-sensitive matching',
      onRemove: () => dispatch({ type: 'TOGGLE_CASE_SENSITIVE_MATCHES' }),
    }),
    optionalActiveFilterChip(regexMatches && !textFilter.trim(), {
      key: 'regex',
      label: 'Regex',
      removeLabel: 'Disable regex matching',
      onRemove: () => dispatch({ type: 'TOGGLE_REGEX_MATCHES' }),
    }),
  ];
  return chips.filter((chip): chip is ActiveFilterChip => chip !== null);
};
