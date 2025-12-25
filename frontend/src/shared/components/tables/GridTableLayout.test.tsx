/**
 * frontend/src/shared/components/tables/GridTableLayout.test.tsx
 *
 * Test suite for GridTableLayout.
 * Covers key behaviors and edge cases for GridTableLayout.
 */

import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import GridTableLayout from '@shared/components/tables/GridTableLayout';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = '';
});

describe('GridTableLayout', () => {
  it('renders loading overlay, filters, header, body, and context menu', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = ReactDOM.createRoot(container);

    await act(async () => {
      root.render(
        <GridTableLayout
          embedded
          className="custom"
          loading
          loadingOverlay={<div className="overlay">Loading</div>}
          filters={<div className="filters" />}
          header={<div className="header" />}
          body={<div className="body" />}
          contextMenu={<div className="menu" />}
        />
      );
    });

    expect(container.querySelector('.gridtable-container')?.className).toContain('embedded');
    expect(container.querySelector('.overlay')).not.toBeNull();
    expect(container.querySelector('.filters')).not.toBeNull();
    expect(container.querySelector('.header')).not.toBeNull();
    expect(container.querySelector('.body')).not.toBeNull();
    expect(container.querySelector('.menu')).not.toBeNull();
  });
});
