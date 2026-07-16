import type { BrowseCatalogPagination } from '@modules/browse/hooks/useBrowseCatalog';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import CatalogPaginationFooter from './CatalogPaginationFooter';

const pagination = (overrides: Partial<BrowseCatalogPagination> = {}): BrowseCatalogPagination => ({
  pageIndex: 1,
  pageLimit: 100,
  pageLimitOptions: [25, 50, 100, 250, 500, 1000],
  setPageLimit: vi.fn(),
  totalCount: 0,
  totalIsExact: true,
  previousToken: null,
  continueToken: null,
  queryPending: false,
  hasMore: false,
  hasPrevious: false,
  isRequestingMore: false,
  onRequestMore: vi.fn(),
  onRequestPrevious: vi.fn(),
  onJumpToPage: vi.fn(),
  ...overrides,
});

describe('CatalogPaginationFooter', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeAll(() => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('hides pagination when the exact result fits within the smallest page size', () => {
    act(() => {
      root.render(
        <CatalogPaginationFooter
          idPrefix="browse"
          visibleItemCount={25}
          pagination={pagination({ totalCount: 25 })}
        />
      );
    });

    expect(container.querySelector('.table-pagination-controls')).toBeNull();
  });

  it('shows an exact visible range when the backend total is exact', () => {
    act(() => {
      root.render(
        <CatalogPaginationFooter
          idPrefix="browse"
          visibleItemCount={75}
          pagination={pagination({
            pageIndex: 2,
            totalCount: 175,
            hasPrevious: true,
          })}
        />
      );
    });

    expect(container.textContent).toContain('Rows per page');
    expect(container.textContent).toContain('101-175 of 175');
    // Exact totals unlock the numbered page jump (P9), shown between the arrows
    // as [page] / total.
    expect(container.textContent).toContain('/ 2');
    expect(container.querySelector('.table-pagination-page-jump-input')).not.toBeNull();
  });

  it('does not invent total pages for approximate totals', () => {
    act(() => {
      root.render(
        <CatalogPaginationFooter
          idPrefix="browse"
          visibleItemCount={100}
          pagination={pagination({
            pageIndex: 2,
            totalCount: 10000,
            totalIsExact: false,
            hasPrevious: true,
            hasMore: true,
          })}
        />
      );
    });

    expect(container.textContent).toContain('101-200 of 10,000+');
    // Approximate totals keep first/prev/next only — no numbered jump, no
    // invented page count (large-data.md contract).
    expect(container.querySelector('.table-pagination-page-jump-input')).toBeNull();
  });

  it('dispatches previous, next, and page-size changes from one control group', () => {
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    const onPageSizeChange = vi.fn();

    act(() => {
      root.render(
        <CatalogPaginationFooter
          idPrefix="browse"
          visibleItemCount={100}
          pagination={pagination({
            totalCount: 1000,
            hasPrevious: true,
            hasMore: true,
            onRequestPrevious: onPrevious,
            onRequestMore: onNext,
            setPageLimit: onPageSizeChange,
          })}
        />
      );
    });

    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('button'));
    act(() => {
      buttons.find((button) => button.getAttribute('aria-label') === 'Previous page')?.click();
      buttons.find((button) => button.getAttribute('aria-label') === 'Next page')?.click();
      container.querySelector<HTMLElement>('[role="combobox"]')?.click();
    });
    act(() => {
      Array.from(document.body.querySelectorAll<HTMLElement>('[role="option"]'))
        .find((option) => option.textContent?.includes('250'))
        ?.click();
    });

    expect(onPrevious).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onPageSizeChange).toHaveBeenCalledWith(250);
  });

  it('keeps pagination loading state out of visible button text', () => {
    act(() => {
      root.render(
        <CatalogPaginationFooter
          idPrefix="browse"
          visibleItemCount={100}
          pagination={pagination({
            totalCount: 1000,
            hasMore: true,
            isRequestingMore: true,
          })}
        />
      );
    });

    expect(container.textContent).not.toContain('Loading');
    expect(
      container.querySelector<HTMLButtonElement>('button[aria-label="Next page"]')?.disabled
    ).toBe(true);
    expect(container.querySelector('[aria-label="Page request in progress"]')).not.toBeNull();
  });
});
