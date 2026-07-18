import type { DropdownOption } from '@shared/components/dropdowns/Dropdown/types';
import { describe, expect, it } from 'vitest';
import {
  logFilterSelectionFromDropdownValues,
  logFilterSelectionToDropdownValues,
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
});
