import type { DropdownOption } from '@shared/components/dropdowns/Dropdown/types';
import {
  ALL_MULTISELECT_FILTER,
  type MultiSelectFilterSelection,
  NONE_MULTISELECT_FILTER,
  normalizeMultiSelectFilterSelection,
} from '@shared/components/dropdowns/multiSelectFilterSelection';

const LOG_PODS_NONE_FILTER = '__log_pods_none__';
const LOG_CONTAINERS_NONE_FILTER = '__log_containers_none__';

const isPodValue = (value: string) => value.startsWith('pod:');
const isContainerValue = (value: string) =>
  value.startsWith('init:') || value.startsWith('container:') || value.startsWith('debug:');

const selectableValues = (
  options: readonly DropdownOption[],
  predicate: (value: string) => boolean
) =>
  options
    .filter((option) => !option.disabled && option.group !== 'header' && predicate(option.value))
    .map((option) => option.value);

const selectedGroupValues = (values: readonly string[], available: readonly string[]) => {
  const availableSet = new Set(available);
  return values.filter((value) => availableSet.has(value));
};

export const logFilterSelectionFromDropdownValues = (
  values: readonly string[],
  options: readonly DropdownOption[]
): MultiSelectFilterSelection => {
  const pods = selectableValues(options, isPodValue);
  const containers = selectableValues(options, isContainerValue);
  const selectedPods = selectedGroupValues(values, pods);
  const selectedContainers = selectedGroupValues(values, containers);
  const encoded: string[] = [];

  if (pods.length > 0) {
    if (selectedPods.length === 0) {
      encoded.push(LOG_PODS_NONE_FILTER);
    } else if (selectedPods.length < pods.length) {
      encoded.push(...selectedPods);
    }
  }
  if (containers.length > 0) {
    if (selectedContainers.length === 0) {
      encoded.push(LOG_CONTAINERS_NONE_FILTER);
    } else if (selectedContainers.length < containers.length) {
      encoded.push(...selectedContainers);
    }
  }

  if (encoded.includes(LOG_PODS_NONE_FILTER) && encoded.includes(LOG_CONTAINERS_NONE_FILTER)) {
    return NONE_MULTISELECT_FILTER;
  }
  return encoded.length > 0 ? { mode: 'some', values: encoded } : ALL_MULTISELECT_FILTER;
};

export const logFilterSelectionToDropdownValues = (
  selection: MultiSelectFilterSelection,
  options: readonly DropdownOption[]
): string[] => {
  const normalized = normalizeMultiSelectFilterSelection(selection);
  if (normalized.mode === 'none') {
    return [];
  }
  const pods = selectableValues(options, isPodValue);
  const containers = selectableValues(options, isContainerValue);
  if (normalized.mode === 'all') {
    return [...pods, ...containers];
  }

  const values = normalized.values;
  const selectedPods = values.filter(isPodValue);
  const selectedContainers = values.filter(isContainerValue);
  return [
    ...(values.includes(LOG_PODS_NONE_FILTER) ? [] : selectedPods.length > 0 ? selectedPods : pods),
    ...(values.includes(LOG_CONTAINERS_NONE_FILTER)
      ? []
      : selectedContainers.length > 0
        ? selectedContainers
        : containers),
  ];
};

export const logFilterSelectionMatchesNone = (selection: MultiSelectFilterSelection): boolean =>
  selection.mode === 'none' ||
  (selection.mode === 'some' &&
    (selection.values.includes(LOG_PODS_NONE_FILTER) ||
      selection.values.includes(LOG_CONTAINERS_NONE_FILTER)));

export const logFilterBackendValues = (selection: MultiSelectFilterSelection): string[] =>
  selection.mode === 'some'
    ? selection.values.filter(
        (value) => value !== LOG_PODS_NONE_FILTER && value !== LOG_CONTAINERS_NONE_FILTER
      )
    : [];
