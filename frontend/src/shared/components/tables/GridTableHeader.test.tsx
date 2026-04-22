/**
 * frontend/src/shared/components/tables/GridTableHeader.test.tsx
 *
 * Test suite for GridTableHeader.
 * Covers key behaviors and edge cases for GridTableHeader.
 */

import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import GridTableHeader from '@shared/components/tables/GridTableHeader';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = '';
});

describe('GridTableHeader', () => {
  it('renders header content when visible', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = ReactDOM.createRoot(container);
    const headerRef = { current: null as HTMLDivElement | null };

    await act(async () => {
      root.render(
        <GridTableHeader
          headerInnerRef={headerRef}
          tableClassName="table"
          useShortNames
          scrollbarWidth={12}
          headerRow={<div className="row">Header</div>}
          hideHeader={false}
          trailingBoundaryOffset={96}
        />
      );
    });

    const wrapper = container.querySelector('.gridtable-header-container') as HTMLElement | null;
    expect(wrapper).not.toBeNull();
    expect(wrapper!.style.paddingRight).toBe('12px');
    expect(container.querySelector('.row')?.textContent).toBe('Header');
    const boundary = container.querySelector<HTMLElement>('.gridtable-trailing-boundary--header');
    expect(boundary).not.toBeNull();
    expect(boundary?.style.left).toBe('96px');
  });

  it('returns null when header is hidden', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = ReactDOM.createRoot(container);
    const headerRef = { current: null as HTMLDivElement | null };

    await act(async () => {
      root.render(
        <>
          <GridTableHeader
            headerInnerRef={headerRef}
            tableClassName="table"
            useShortNames={false}
            scrollbarWidth={0}
            headerRow={<div>Hidden</div>}
            hideHeader
            trailingBoundaryOffset={null}
          />
        </>
      );
    });

    expect(container.innerHTML).toBe('');
  });

  it('omits the trailing boundary when no offset is provided', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = ReactDOM.createRoot(container);
    const headerRef = { current: null as HTMLDivElement | null };

    await act(async () => {
      root.render(
        <GridTableHeader
          headerInnerRef={headerRef}
          tableClassName="table"
          useShortNames={false}
          scrollbarWidth={0}
          headerRow={<div className="row">Header</div>}
          hideHeader={false}
          trailingBoundaryOffset={null}
        />
      );
    });

    expect(container.querySelector('.gridtable-trailing-boundary--header')).toBeNull();
  });
});
