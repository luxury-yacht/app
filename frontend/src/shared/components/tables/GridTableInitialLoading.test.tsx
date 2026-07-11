/**
 * frontend/src/shared/components/tables/GridTableInitialLoading.test.tsx
 *
 * Test suite for GridTableInitialLoading.
 * Covers key behaviors and edge cases for GridTableInitialLoading.
 */

import GridTableInitialLoading from '@shared/components/tables/GridTableInitialLoading';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('GridTableInitialLoading', () => {
  it('renders loading spinner with message', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = ReactDOM.createRoot(container);

    await act(async () => {
      root.render(<GridTableInitialLoading embedded className="custom" message="Loading data" />);
    });

    const wrapper = container.querySelector('.gridtable-container');
    expect(wrapper?.className).toContain('embedded');
    expect(wrapper?.className).toContain('custom');
    expect(container.textContent).toContain('Loading data');
  });
});
