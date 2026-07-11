import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireValue } from '@/test-utils/requireValue';
import QueryPaginationControls from './QueryPaginationControls';

describe('QueryPaginationControls', () => {
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

  const renderWithJump = (onPageJump: (page: number) => void) => {
    act(() => {
      root.render(
        <QueryPaginationControls
          idPrefix="typed"
          pageIndex={2}
          pageSize={250}
          visibleItemCount={250}
          pageSizeOptions={[25, 50, 100, 250, 500, 1000]}
          totalCount={1068}
          totalIsExact={true}
          hasPrevious={true}
          hasNext={true}
          loading={false}
          onPrevious={vi.fn()}
          onNext={vi.fn()}
          onPageSizeChange={vi.fn()}
          onPageJump={onPageJump}
        />
      );
    });
    return requireValue(
      container.querySelector<HTMLInputElement>('.query-pagination-page-jump-input'),
      'Expected the page-jump input after rendering pagination controls'
    );
  };

  it('commits a page jump on blur (tab-out), clamped, same as Enter', () => {
    const onPageJump = vi.fn();
    const input = renderWithJump(onPageJump);

    // Blur with an edited, in-range value jumps (blur() drives React's onBlur
    // via the delegated focusout).
    act(() => {
      input.focus();
      input.value = '4';
      input.blur();
    });
    expect(onPageJump).toHaveBeenCalledWith(4);

    // Blur with an out-of-range value clamps to the last page (1068/250 = 5).
    onPageJump.mockClear();
    act(() => {
      input.focus();
      input.value = '99';
      input.blur();
    });
    expect(onPageJump).toHaveBeenCalledWith(5);
  });

  it('does not jump when the field is unchanged or empty on blur, and restores the display', () => {
    const onPageJump = vi.fn();
    const input = renderWithJump(onPageJump);

    // Tabbing through the untouched field (value equals the current page) is a no-op.
    act(() => {
      input.focus();
      input.blur();
    });
    expect(onPageJump).not.toHaveBeenCalled();
    expect(input.value).toBe('2');

    // Clearing then blurring does not jump and restores the current page.
    act(() => {
      input.focus();
      input.value = '';
      input.blur();
    });
    expect(onPageJump).not.toHaveBeenCalled();
    expect(input.value).toBe('2');
  });
});
