import type { DropdownOption } from '@shared/components/dropdowns/Dropdown/types';
import { describe, expect, it } from 'vitest';
import {
  logFilterSelectionForOnlyPod,
  logFilterSelectionFromDropdownValues,
  logFilterSelectionLabel,
  logFilterSelectionToDropdownValues,
  pruneLogFilterSelectionToOptions,
} from './logFilterSelection';

const options: DropdownOption[] = [
  { value: 'pod:web-1', label: 'web-1', group: 'Pods' },
  { value: 'pod:web-2', label: 'web-2', group: 'Pods' },
  { value: 'container:app', label: 'app', group: 'Containers' },
  { value: 'container:sidecar', label: 'sidecar', group: 'Containers' },
];

describe('logFilterSelection', () => {
  it('keeps pods open-ended when narrowing only the container group', () => {
    const selection = logFilterSelectionFromDropdownValues(
      ['pod:web-1', 'pod:web-2', 'container:app'],
      options
    );
    expect(selection).toEqual({ mode: 'some', values: ['container:app'] });

    expect(
      logFilterSelectionToDropdownValues(selection, [
        ...options,
        { value: 'pod:web-3', label: 'web-3', group: 'Pods' },
      ])
    ).toEqual(['pod:web-1', 'pod:web-2', 'pod:web-3', 'container:app']);
  });

  it('keeps explicit pod narrowing while leaving containers open-ended', () => {
    const selection = logFilterSelectionFromDropdownValues(
      ['pod:web-1', 'container:app', 'container:sidecar'],
      options
    );
    expect(selection).toEqual({ mode: 'some', values: ['pod:web-1'] });
    expect(logFilterSelectionToDropdownValues(selection, options)).toEqual([
      'pod:web-1',
      'container:app',
      'container:sidecar',
    ]);
  });

  it('preserves an explicitly empty pod group while pruning unavailable options', () => {
    const selection = logFilterSelectionFromDropdownValues(
      ['container:app', 'container:sidecar'],
      options
    );

    expect(pruneLogFilterSelectionToOptions(selection, options)).toEqual(selection);
    if (selection.mode !== 'some') {
      throw new Error('expected an explicitly empty pod group');
    }
    expect(logFilterSelectionLabel(selection.values[0])).toBe('No pods');
  });

  it('preserves an explicitly empty container group while pruning unavailable options', () => {
    const selection = logFilterSelectionFromDropdownValues(['pod:web-1', 'pod:web-2'], options);

    expect(pruneLogFilterSelectionToOptions(selection, options)).toEqual(selection);
    if (selection.mode !== 'some') {
      throw new Error('expected an explicitly empty container group');
    }
    expect(logFilterSelectionLabel(selection.values[0])).toBe('No containers');
  });

  it('replaces an empty pod group when selecting only one pod', () => {
    const selection = logFilterSelectionFromDropdownValues(
      ['container:app', 'container:sidecar'],
      options
    );

    expect(logFilterSelectionForOnlyPod(selection, 'web-1')).toEqual({
      mode: 'some',
      values: ['pod:web-1'],
    });
  });
});
