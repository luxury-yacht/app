import type { DropdownOption } from '@shared/components/dropdowns/Dropdown/types';
import {
  ALL_MULTISELECT_FILTER,
  type MultiSelectFilterSelection,
  multiSelectFilterTriggerLabel,
  NONE_MULTISELECT_FILTER,
  normalizeMultiSelectFilterSelection,
} from '@shared/components/dropdowns/multiSelectFilterSelection';

export type SelectedLogSources = {
  pods: Set<string>;
  initContainers: Set<string>;
  containers: Set<string>;
  debugContainers: Set<string>;
};

const valuesForPrefix = (values: string[], prefix: string): Set<string> =>
  new Set(
    values
      .filter((value) => value.startsWith(prefix))
      .map((value) => value.substring(prefix.length))
  );

export const classifySelectedLogSources = (values: string[]): SelectedLogSources => ({
  pods: valuesForPrefix(values, 'pod:'),
  initContainers: valuesForPrefix(values, 'init:'),
  containers: valuesForPrefix(values, 'container:'),
  debugContainers: valuesForPrefix(values, 'debug:'),
});

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

// One group's part of a selection: nothing while every option is checked, its
// none marker when none is, otherwise the checked values.
const encodeGroup = (
  values: readonly string[],
  available: readonly string[],
  noneFilter: string
): string[] => {
  const selected = selectedGroupValues(values, available);
  if (available.length === 0 || selected.length === available.length) {
    return [];
  }
  return selected.length === 0 ? [noneFilter] : selected;
};

export const logFilterSelectionFromDropdownValues = (
  values: readonly string[],
  options: readonly DropdownOption[]
): MultiSelectFilterSelection => {
  const encoded = [
    ...encodeGroup(values, selectableValues(options, isPodValue), LOG_PODS_NONE_FILTER),
    ...encodeGroup(values, selectableValues(options, isContainerValue), LOG_CONTAINERS_NONE_FILTER),
  ];

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
  let resolvedPods = pods;
  if (values.includes(LOG_PODS_NONE_FILTER)) {
    resolvedPods = [];
  } else if (selectedPods.length > 0) {
    resolvedPods = selectedPods;
  }
  let resolvedContainers = containers;
  if (values.includes(LOG_CONTAINERS_NONE_FILTER)) {
    resolvedContainers = [];
  } else if (selectedContainers.length > 0) {
    resolvedContainers = selectedContainers;
  }
  return [...resolvedPods, ...resolvedContainers];
};

/** The Pods and Containers dropdowns each choose one group of sources. */
export type LogSourceGroup = 'pods' | 'containers';

const inSourceGroup = (group: LogSourceGroup) => (group === 'pods' ? isPodValue : isContainerValue);

const noneFilterFor = (group: LogSourceGroup) =>
  group === 'pods' ? LOG_PODS_NONE_FILTER : LOG_CONTAINERS_NONE_FILTER;

/** The values one source dropdown shows checked. */
export const logSourceGroupValues = (
  selection: MultiSelectFilterSelection,
  options: readonly DropdownOption[],
  group: LogSourceGroup
): string[] => logFilterSelectionToDropdownValues(selection, options).filter(inSourceGroup(group));

/** The selection after one source dropdown changes; the other keeps its choice. */
export const logFilterSelectionWithGroupValues = (
  selection: MultiSelectFilterSelection,
  options: readonly DropdownOption[],
  group: LogSourceGroup,
  values: readonly string[]
): MultiSelectFilterSelection => {
  const inGroup = inSourceGroup(group);
  const kept = logFilterSelectionToDropdownValues(selection, options).filter(
    (value) => !inGroup(value)
  );
  return logFilterSelectionFromDropdownValues([...kept, ...values.filter(inGroup)], options);
};

/** A source dropdown's trigger text: the bare label until it narrows its group. */
export const logSourceGroupLabel = (
  label: string,
  selection: MultiSelectFilterSelection,
  group: LogSourceGroup,
  checkedValues: readonly string[]
): string => {
  const inGroup = inSourceGroup(group);
  const narrows =
    selection.mode === 'none' ||
    (selection.mode === 'some' &&
      selection.values.some((value) => value === noneFilterFor(group) || inGroup(value)));
  return multiSelectFilterTriggerLabel(
    label,
    narrows ? { mode: 'some', values: [...checkedValues] } : ALL_MULTISELECT_FILTER,
    checkedValues
  );
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

const sourceGroupOf = (value: string): LogSourceGroup =>
  value === LOG_PODS_NONE_FILTER || isPodValue(value) ? 'pods' : 'containers';

/**
 * Drops chosen sources the options no longer offer. A group without options
 * has not listed its sources yet (pods before any line or pod list, containers
 * before the inventory), so its part of the selection is kept.
 */
export const pruneLogFilterSelectionToOptions = (
  selection: MultiSelectFilterSelection,
  options: readonly DropdownOption[]
): MultiSelectFilterSelection => {
  if (selection.mode !== 'some') {
    return selection;
  }

  const pods = selectableValues(options, isPodValue);
  const containers = selectableValues(options, isContainerValue);
  const listed = { pods: pods.length > 0, containers: containers.length > 0 };
  const available = new Set([...pods, ...containers]);
  const values = selection.values.filter(
    (value) =>
      value === LOG_PODS_NONE_FILTER ||
      value === LOG_CONTAINERS_NONE_FILTER ||
      !listed[sourceGroupOf(value)] ||
      available.has(value)
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
