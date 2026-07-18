import type { DropdownOption } from './Dropdown/types';

export type MultiSelectFilterSelection =
  | { mode: 'all' }
  | { mode: 'none' }
  | { mode: 'some'; values: string[] };

export const ALL_MULTISELECT_FILTER: MultiSelectFilterSelection = Object.freeze({ mode: 'all' });
export const NONE_MULTISELECT_FILTER: MultiSelectFilterSelection = Object.freeze({ mode: 'none' });

const normalizeValues = (values: readonly string[]): string[] => {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const raw of values) {
    const value = raw.trim();
    const key = value === '' ? '__empty__' : value.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push(value);
  }
  return normalized;
};

const normalizeExactValues = (values: readonly string[]): string[] => {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const raw of values) {
    const value = raw.trim();
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    normalized.push(value);
  }
  return normalized;
};

const selectableOptionValues = (options: readonly DropdownOption[]): string[] =>
  normalizeValues(
    options
      .filter((option) => !option.disabled && option.group !== 'header')
      .map((option) => option.value)
  );

export const normalizeMultiSelectFilterSelection = (
  selection: MultiSelectFilterSelection
): MultiSelectFilterSelection => {
  if (selection.mode !== 'some') {
    return selection.mode === 'all' ? ALL_MULTISELECT_FILTER : NONE_MULTISELECT_FILTER;
  }
  const values = normalizeValues(selection.values);
  return values.length > 0 ? { mode: 'some', values } : NONE_MULTISELECT_FILTER;
};

export const normalizeExactMultiSelectFilterSelection = (
  selection: MultiSelectFilterSelection
): MultiSelectFilterSelection => {
  if (selection.mode !== 'some') {
    return selection.mode === 'all' ? ALL_MULTISELECT_FILTER : NONE_MULTISELECT_FILTER;
  }
  const values = normalizeExactValues(selection.values);
  return values.length > 0 ? { mode: 'some', values } : NONE_MULTISELECT_FILTER;
};

export const migrateLegacyMultiSelectFilterSelection = (
  value: unknown
): MultiSelectFilterSelection => {
  if (Array.isArray(value)) {
    const values = normalizeValues(
      value.filter((item): item is string => typeof item === 'string')
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
    return normalizeMultiSelectFilterSelection({
      mode: 'some',
      values: candidate.values.filter((item): item is string => typeof item === 'string'),
    });
  }
  return ALL_MULTISELECT_FILTER;
};

export const migrateLegacyExactMultiSelectFilterSelection = (
  value: unknown
): MultiSelectFilterSelection => {
  if (Array.isArray(value)) {
    const values = normalizeExactValues(
      value.filter((item): item is string => typeof item === 'string')
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
    return normalizeExactMultiSelectFilterSelection({
      mode: 'some',
      values: candidate.values.filter((item): item is string => typeof item === 'string'),
    });
  }
  return ALL_MULTISELECT_FILTER;
};

export const filterSelectionToDropdownValues = (
  selection: MultiSelectFilterSelection,
  options: readonly DropdownOption[]
): string[] => {
  const normalized = normalizeMultiSelectFilterSelection(selection);
  if (normalized.mode === 'all') {
    return selectableOptionValues(options);
  }
  return normalized.mode === 'some' ? normalized.values : [];
};

export const filterSelectionFromDropdownValues = (
  values: readonly string[],
  options: readonly DropdownOption[]
): MultiSelectFilterSelection => {
  const selected = normalizeValues(values);
  if (selected.length === 0) {
    return NONE_MULTISELECT_FILTER;
  }
  const available = selectableOptionValues(options);
  const selectedSet = new Set(selected.map((value) => value.toLowerCase()));
  if (
    selectedSet.size === available.length &&
    available.every((value) => selectedSet.has(value.toLowerCase()))
  ) {
    return ALL_MULTISELECT_FILTER;
  }
  return { mode: 'some', values: selected };
};

export const filterSelectionFromDropdownValuesExact = (
  values: readonly string[],
  options: readonly DropdownOption[]
): MultiSelectFilterSelection => {
  const selected = normalizeExactValues(values);
  if (selected.length === 0) {
    return NONE_MULTISELECT_FILTER;
  }
  const available = normalizeExactValues(
    options
      .filter((option) => !option.disabled && option.group !== 'header')
      .map((option) => option.value)
  );
  const selectedSet = new Set(selected);
  if (selectedSet.size === available.length && available.every((value) => selectedSet.has(value))) {
    return ALL_MULTISELECT_FILTER;
  }
  return { mode: 'some', values: selected };
};

export const filterSelectionMatches = (
  selection: MultiSelectFilterSelection,
  candidate: string
): boolean => {
  const normalized = normalizeMultiSelectFilterSelection(selection);
  if (normalized.mode === 'all') {
    return true;
  }
  if (normalized.mode === 'none') {
    return false;
  }
  const key = candidate.trim().toLowerCase();
  return normalized.values.some((value) => value.toLowerCase() === key);
};

export const isNarrowingFilterSelection = (selection: MultiSelectFilterSelection): boolean =>
  selection.mode !== 'all';

export const filterSelectionValues = (selection: MultiSelectFilterSelection): string[] => {
  const normalized = normalizeMultiSelectFilterSelection(selection);
  return normalized.mode === 'some' ? normalized.values : [];
};

export const pruneFilterSelectionToOptions = (
  selection: MultiSelectFilterSelection,
  options: readonly DropdownOption[]
): MultiSelectFilterSelection => {
  const normalized = normalizeMultiSelectFilterSelection(selection);
  if (normalized.mode !== 'some') {
    return normalized;
  }
  const available = new Set(selectableOptionValues(options).map((value) => value.toLowerCase()));
  const values = normalized.values.filter((value) => available.has(value.toLowerCase()));
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
