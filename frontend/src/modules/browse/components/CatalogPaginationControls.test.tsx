import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import CatalogPaginationControls from './CatalogPaginationControls';

describe('CatalogPaginationControls', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
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

  it('shows an exact visible range when the backend total is exact', () => {
    act(() => {
      root.render(
        <CatalogPaginationControls
          idPrefix="browse"
          pageIndex={2}
          pageSize={100}
          visibleItemCount={75}
          pageSizeOptions={[25, 50, 100, 250, 500, 1000]}
          totalCount={175}
          totalIsExact={true}
          hasPrevious={true}
          hasNext={false}
          loading={false}
          onPrevious={vi.fn()}
          onNext={vi.fn()}
          onPageSizeChange={vi.fn()}
        />
      );
    });

    expect(container.textContent).toContain('Rows per page');
    expect(container.textContent).toContain('101-175 of 175');
    expect(container.textContent).not.toContain('Page');
  });

  it('does not invent total pages for approximate totals', () => {
    act(() => {
      root.render(
        <CatalogPaginationControls
          idPrefix="browse"
          pageIndex={2}
          pageSize={100}
          visibleItemCount={100}
          pageSizeOptions={[25, 50, 100, 250, 500, 1000]}
          totalCount={10000}
          totalIsExact={false}
          hasPrevious={true}
          hasNext={true}
          loading={false}
          onPrevious={vi.fn()}
          onNext={vi.fn()}
          onPageSizeChange={vi.fn()}
        />
      );
    });

    expect(container.textContent).toContain('101-200 of 10,000+');
    expect(container.textContent).not.toContain('Page');
  });

  it('dispatches previous, next, and page-size changes from one control group', () => {
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    const onPageSizeChange = vi.fn();

    act(() => {
      root.render(
        <CatalogPaginationControls
          idPrefix="browse"
          pageIndex={1}
          pageSize={100}
          visibleItemCount={100}
          pageSizeOptions={[25, 50, 100, 250, 500, 1000]}
          totalCount={1000}
          totalIsExact={true}
          hasPrevious={true}
          hasNext={true}
          loading={false}
          onPrevious={onPrevious}
          onNext={onNext}
          onPageSizeChange={onPageSizeChange}
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
      Array.from(container.querySelectorAll<HTMLElement>('[role="option"]'))
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
        <CatalogPaginationControls
          idPrefix="browse"
          pageIndex={1}
          pageSize={100}
          visibleItemCount={100}
          pageSizeOptions={[25, 50, 100, 250, 500, 1000]}
          totalCount={1000}
          totalIsExact={true}
          hasPrevious={false}
          hasNext={true}
          loading={true}
          onPrevious={vi.fn()}
          onNext={vi.fn()}
          onPageSizeChange={vi.fn()}
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
