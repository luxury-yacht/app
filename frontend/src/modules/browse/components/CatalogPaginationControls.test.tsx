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

  it('shows exact page count only when the backend total is exact', () => {
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

    expect(container.textContent).toContain('Page 2 of 2');
    expect(container.textContent).toContain('Showing 101-175');
    expect(container.textContent).toContain('175 results');
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

    expect(container.textContent).toContain('Page 2');
    expect(container.textContent).not.toContain('Page 2 of');
    expect(container.textContent).toContain('Showing 101-200');
    expect(container.textContent).toContain('~10,000 results');
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
      buttons.find((button) => button.textContent === 'Previous')?.click();
      buttons.find((button) => button.textContent === 'Next')?.click();
      container.querySelector<HTMLElement>('[role="combobox"]')?.click();
    });
    act(() => {
      Array.from(container.querySelectorAll<HTMLElement>('[role="option"]'))
        .find((option) => option.textContent?.includes('250 / page'))
        ?.click();
    });

    expect(onPrevious).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onPageSizeChange).toHaveBeenCalledWith(250);
  });
});
