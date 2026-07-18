import { describe, expect, it } from 'vitest';
import {
  ALL_MULTISELECT_FILTER,
  filterSelectionFromDropdownValues,
  filterSelectionFromDropdownValuesExact,
  filterSelectionMatches,
  filterSelectionToDropdownValues,
  migrateLegacyMultiSelectFilterSelection,
  NONE_MULTISELECT_FILTER,
  normalizeExactMultiSelectFilterSelection,
  normalizeMultiSelectFilterSelection,
} from './multiSelectFilterSelection';

const options = [
  { value: 'header', label: 'Header', group: 'header' as const },
  { value: 'alpha', label: 'Alpha' },
  { value: 'disabled', label: 'Disabled', disabled: true },
  { value: 'beta', label: 'Beta' },
];

describe('multiSelectFilterSelection', () => {
  it('keeps all, some, and none as distinct normalized states', () => {
    expect(normalizeMultiSelectFilterSelection(ALL_MULTISELECT_FILTER)).toEqual({ mode: 'all' });
    expect(normalizeMultiSelectFilterSelection(NONE_MULTISELECT_FILTER)).toEqual({ mode: 'none' });
    expect(
      normalizeMultiSelectFilterSelection({ mode: 'some', values: [' alpha ', 'ALPHA', 'beta'] })
    ).toEqual({ mode: 'some', values: ['alpha', 'beta'] });
    expect(normalizeMultiSelectFilterSelection({ mode: 'some', values: [] })).toEqual({
      mode: 'none',
    });
    expect(normalizeMultiSelectFilterSelection({ mode: 'some', values: [''] })).toEqual({
      mode: 'some',
      values: [''],
    });
  });

  it('expands all against the latest selectable option vocabulary', () => {
    expect(filterSelectionToDropdownValues(ALL_MULTISELECT_FILTER, options)).toEqual([
      'alpha',
      'beta',
    ]);
    expect(
      filterSelectionToDropdownValues(ALL_MULTISELECT_FILTER, [
        ...options,
        { value: 'gamma', label: 'Gamma' },
      ])
    ).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('converts dropdown values to all, some, or none without ambiguity', () => {
    expect(filterSelectionFromDropdownValues([], options)).toEqual({ mode: 'none' });
    expect(filterSelectionFromDropdownValues(['alpha'], options)).toEqual({
      mode: 'some',
      values: ['alpha'],
    });
    expect(filterSelectionFromDropdownValues(['beta', 'alpha'], options)).toEqual({ mode: 'all' });
  });

  it('matches every value for all, selected values for some, and no value for none', () => {
    expect(filterSelectionMatches(ALL_MULTISELECT_FILTER, 'anything')).toBe(true);
    expect(filterSelectionMatches({ mode: 'some', values: ['alpha'] }, 'ALPHA')).toBe(true);
    expect(filterSelectionMatches({ mode: 'some', values: ['alpha'] }, 'beta')).toBe(false);
    expect(filterSelectionMatches(NONE_MULTISELECT_FILTER, 'alpha')).toBe(false);
  });

  it('migrates legacy empty arrays to all and nonempty arrays to some', () => {
    expect(migrateLegacyMultiSelectFilterSelection([])).toEqual({ mode: 'all' });
    expect(migrateLegacyMultiSelectFilterSelection(['Pod'])).toEqual({
      mode: 'some',
      values: ['Pod'],
    });
  });

  it('preserves case-distinct identity values for exact selections', () => {
    expect(
      normalizeExactMultiSelectFilterSelection({ mode: 'some', values: ['Cluster-A', 'cluster-a'] })
    ).toEqual({ mode: 'some', values: ['Cluster-A', 'cluster-a'] });
    expect(
      filterSelectionFromDropdownValuesExact(
        ['Cluster-A'],
        [
          { value: 'Cluster-A', label: 'upper' },
          { value: 'cluster-a', label: 'lower' },
        ]
      )
    ).toEqual({ mode: 'some', values: ['Cluster-A'] });
  });
});
