import type { DropdownOption } from './Dropdown/types';

export type MultiSelectFilterSelection =
  | { mode: 'all' }
  | { mode: 'none' }
  | { mode: 'some'; values: string[] };

export const ALL_MULTISELECT_FILTER: MultiSelectFilterSelection = Object.freeze({ mode: 'all' });
export const NONE_MULTISELECT_FILTER: MultiSelectFilterSelection = Object.freeze({ mode: 'none' });

export type FilterValueComparison = 'case-insensitive' | 'exact';

const compareValue = (value: string, comparison: FilterValueComparison): string =>
  comparison === 'exact' ? value : value.toLowerCase();

const normalizeValues = (
  values: readonly string[],
  comparison: FilterValueComparison = 'case-insensitive'
): string[] => {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const raw of values) {
    const value = raw.trim();
    const key = compareValue(value, comparison);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push(value);
  }
  return normalized;
};

const selectableOptionValues = (
  options: readonly DropdownOption[],
  comparison: FilterValueComparison = 'case-insensitive'
): string[] =>
  normalizeValues(
    options
      .filter((option) => !option.disabled && option.group !== 'header')
      .map((option) => option.value),
    comparison
  );

const normalizeFilterSelection = (
  selection: MultiSelectFilterSelection,
  comparison: FilterValueComparison = 'case-insensitive'
): MultiSelectFilterSelection => {
  if (selection.mode !== 'some') {
    return selection.mode === 'all' ? ALL_MULTISELECT_FILTER : NONE_MULTISELECT_FILTER;
  }
  const values = normalizeValues(selection.values, comparison);
  return values.length > 0 ? { mode: 'some', values } : NONE_MULTISELECT_FILTER;
};

export const normalizeMultiSelectFilterSelection = (
  selection: MultiSelectFilterSelection
): MultiSelectFilterSelection => normalizeFilterSelection(selection, 'case-insensitive');

export const normalizeExactMultiSelectFilterSelection = (
  selection: MultiSelectFilterSelection
): MultiSelectFilterSelection => normalizeFilterSelection(selection, 'exact');

const migrateLegacyFilterSelection = (
  value: unknown,
  comparison: FilterValueComparison = 'case-insensitive'
): MultiSelectFilterSelection => {
  if (Array.isArray(value)) {
    const values = normalizeValues(
      value.filter((item): item is string => typeof item === 'string'),
      comparison
    );
    return values.length > 0 ? { mode: 'some', values } : ALL_MULTISELECT_FILTER;
  }
  if (!value || typeof value !== 'object' || !('mode' in value)) {
    return ALL_MULTISELECT_FILTER;
  }
  const candidate = value as { mode?: unknown; values?: unknown };
  if (candidate.mode === 'all') {
    return ALL_MULTISELECT_FILTER;
  }
  if (candidate.mode === 'none') {
    return NONE_MULTISELECT_FILTER;
  }
  if (candidate.mode === 'some' && Array.isArray(candidate.values)) {
    return normalizeFilterSelection(
      {
        mode: 'some',
        values: candidate.values.filter((item): item is string => typeof item === 'string'),
      },
      comparison
    );
  }
  return ALL_MULTISELECT_FILTER;
};

export const migrateLegacyMultiSelectFilterSelection = (
  value: unknown
): MultiSelectFilterSelection => migrateLegacyFilterSelection(value, 'case-insensitive');

export const migrateLegacyExactMultiSelectFilterSelection = (
  value: unknown
): MultiSelectFilterSelection => migrateLegacyFilterSelection(value, 'exact');

export const filterSelectionToDropdownValues = (
  selection: MultiSelectFilterSelection,
  options: readonly DropdownOption[],
  comparison: FilterValueComparison = 'case-insensitive'
): string[] => {
  const normalized = normalizeFilterSelection(selection, comparison);
  if (normalized.mode === 'all') {
    return selectableOptionValues(options, comparison);
  }
  return normalized.mode === 'some' ? normalized.values : [];
};

export const filterSelectionFromDropdownValues = (
  values: readonly string[],
  options: readonly DropdownOption[],
  comparison: FilterValueComparison = 'case-insensitive'
): MultiSelectFilterSelection => {
  const selected = normalizeValues(values, comparison);
  if (selected.length === 0) {
    return NONE_MULTISELECT_FILTER;
  }
  const available = selectableOptionValues(options, comparison);
  const selectedSet = new Set(selected.map((value) => compareValue(value, comparison)));
  if (
    selectedSet.size === available.length &&
    available.every((value) => selectedSet.has(compareValue(value, comparison)))
  ) {
    return ALL_MULTISELECT_FILTER;
  }
  return { mode: 'some', values: selected };
};

export const filterSelectionFromDropdownValuesExact = (
  values: readonly string[],
  options: readonly DropdownOption[]
): MultiSelectFilterSelection => filterSelectionFromDropdownValues(values, options, 'exact');

export const filterSelectionMatches = (
  selection: MultiSelectFilterSelection,
  candidate: string,
  comparison: FilterValueComparison = 'case-insensitive'
): boolean => {
  const normalized = normalizeFilterSelection(selection, comparison);
  if (normalized.mode === 'all') {
    return true;
  }
  if (normalized.mode === 'none') {
    return false;
  }
  const key = compareValue(candidate.trim(), comparison);
  return normalized.values.some((value) => compareValue(value, comparison) === key);
};

export const isNarrowingFilterSelection = (selection: MultiSelectFilterSelection): boolean =>
  selection.mode !== 'all';

export const filterSelectionValues = (
  selection: MultiSelectFilterSelection,
  comparison: FilterValueComparison = 'case-insensitive'
): string[] => {
  const normalized = normalizeFilterSelection(selection, comparison);
  return normalized.mode === 'some' ? normalized.values : [];
};

export const pruneFilterSelectionToOptions = (
  selection: MultiSelectFilterSelection,
  options: readonly DropdownOption[],
  comparison: FilterValueComparison = 'case-insensitive'
): MultiSelectFilterSelection => {
  const normalized = normalizeFilterSelection(selection, comparison);
  if (normalized.mode !== 'some') {
    return normalized;
  }
  const available = new Set(
    selectableOptionValues(options, comparison).map((value) => compareValue(value, comparison))
  );
  const values = normalized.values.filter((value) =>
    available.has(compareValue(value, comparison))
  );
  if (
    values.length === normalized.values.length &&
    selection.mode === 'some' &&
    selection.values.length === values.length &&
    selection.values.every((value, index) => value === values[index])
  ) {
    return selection;
  }
  return values.length > 0 ? { mode: 'some', values } : ALL_MULTISELECT_FILTER;
};
