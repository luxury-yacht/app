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

export const logFilterSelectionLabel = (value: string): string | null => {
  if (value === LOG_PODS_NONE_FILTER) {
    return 'No pods';
  }
  if (value === LOG_CONTAINERS_NONE_FILTER) {
    return 'No containers';
  }
  return null;
};

const sameValues = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

export const pruneLogFilterSelectionToOptions = (
  selection: MultiSelectFilterSelection,
  options: readonly DropdownOption[]
): MultiSelectFilterSelection => {
  if (selection.mode !== 'some') {
    return selection;
  }

  const pods = selectableValues(options, isPodValue);
  const containers = selectableValues(options, isContainerValue);
  const available = new Set([...pods, ...containers]);
  const values = selection.values.filter(
    (value) =>
      available.has(value) ||
      (value === LOG_PODS_NONE_FILTER && pods.length > 0) ||
      (value === LOG_CONTAINERS_NONE_FILTER && containers.length > 0)
  );

  if (values.includes(LOG_PODS_NONE_FILTER) && values.includes(LOG_CONTAINERS_NONE_FILTER)) {
    return NONE_MULTISELECT_FILTER;
  }
  if (values.length === 0) {
    return ALL_MULTISELECT_FILTER;
  }
  return sameValues(values, selection.values) ? selection : { mode: 'some', values };
};

export const logFilterSelectionForOnlyPod = (
  selection: MultiSelectFilterSelection,
  pod: string
): MultiSelectFilterSelection => {
  const preservedContainers =
    selection.mode === 'some'
      ? selection.values.filter((value) => value !== LOG_PODS_NONE_FILTER && !isPodValue(value))
      : [];
  return { mode: 'some', values: [`pod:${pod}`, ...preservedContainers] };
};

export const logFilterSelectionForOnlyContainer = (
  selection: MultiSelectFilterSelection,
  containerValue: string
): MultiSelectFilterSelection => {
  const preservedPods =
    selection.mode === 'some'
      ? selection.values.filter(
          (value) => value !== LOG_CONTAINERS_NONE_FILTER && !isContainerValue(value)
        )
      : [];
  return { mode: 'some', values: [...preservedPods, containerValue] };
};
