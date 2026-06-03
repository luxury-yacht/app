import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import QueryPaginationControls from './QueryPaginationControls';

describe('QueryPaginationControls', () => {
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

  it('opens the rows-per-page dropdown and dispatches a supported page size', () => {
    const onPageSizeChange = vi.fn();

    act(() => {
      root.render(
        <QueryPaginationControls
          idPrefix="typed"
          pageIndex={1}
          pageSize={50}
          visibleItemCount={50}
          pageSizeOptions={[25, 50, 100, 250, 500, 1000]}
          totalCount={1000}
          totalIsExact={true}
          hasPrevious={false}
          hasNext={true}
          loading={false}
          onPrevious={vi.fn()}
          onNext={vi.fn()}
          onPageSizeChange={onPageSizeChange}
        />
      );
    });

    act(() => {
      container.querySelector<HTMLElement>('[role="combobox"]')?.click();
    });

    expect(container.querySelector('[role="listbox"]')).not.toBeNull();

    act(() => {
      Array.from(container.querySelectorAll<HTMLElement>('[role="option"]'))
        .find((option) => option.textContent?.includes('250'))
        ?.click();
    });

    expect(onPageSizeChange).toHaveBeenCalledWith(250);
  });

  it('keeps pagination loading out of button text while disabling page navigation', () => {
    const onNext = vi.fn();

    act(() => {
      root.render(
        <QueryPaginationControls
          idPrefix="typed"
          pageIndex={2}
          pageSize={100}
          visibleItemCount={100}
          pageSizeOptions={[25, 50, 100, 250, 500, 1000]}
          totalCount={1000}
          totalIsExact={false}
          hasPrevious={true}
          hasNext={true}
          loading={true}
          onPrevious={vi.fn()}
          onNext={onNext}
          onPageSizeChange={vi.fn()}
        />
      );
    });

    expect(container.textContent).toContain('101-200 of 1,000+');
    expect(container.textContent).not.toContain('Loading');

    const next = container.querySelector<HTMLButtonElement>('button[aria-label="Next page"]');
    expect(next?.disabled).toBe(true);

    act(() => {
      next?.click();
    });

    expect(onNext).not.toHaveBeenCalled();
    expect(container.querySelector('[aria-label="Page request in progress"]')).not.toBeNull();
  });
});
