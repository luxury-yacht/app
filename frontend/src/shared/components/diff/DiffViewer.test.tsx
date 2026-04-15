/**
 * frontend/src/shared/components/diff/DiffViewer.test.tsx
 *
 * Test suite for the DiffViewer component.
 * Covers rendering of context, added, and removed lines, diff-only filtering,
 * muted line styling, virtualization, and triple-click selection behavior.
 */

import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DisplayDiffLine } from '@shared/components/diff/diffUtils';
import DiffViewer from './DiffViewer';

class MockResizeObserver {
  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe(target: Element) {
    this.callback([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }

  unobserve() {}

  disconnect() {}
}

const buildRect = (width: number, height: number): DOMRect =>
  ({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    bottom: height,
    right: width,
    width,
    height,
    toJSON: () => ({}),
  }) as DOMRect;

const waitForFrames = async (count = 2) => {
  for (let frame = 0; frame < count; frame += 1) {
    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
  }
};

describe('DiffViewer', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  const originalResizeObserver = globalThis.ResizeObserver;
  const originalClientHeight = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'clientHeight'
  );
  const originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
  const originalScrollWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth');
  const originalScrollHeight = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'scrollHeight'
  );
  const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get() {
        if (this.classList?.contains('object-diff-table')) {
          return 120;
        }
        if (this.classList?.contains('object-diff-line-text')) {
          return 20;
        }
        return originalClientHeight?.get ? originalClientHeight.get.call(this) : 0;
      },
    });

    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get() {
        if (this.classList?.contains('object-diff-table')) {
          return 800;
        }
        if (this.classList?.contains('object-diff-line-text')) {
          return 60;
        }
        return originalClientWidth?.get ? originalClientWidth.get.call(this) : 0;
      },
    });

    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
      configurable: true,
      get() {
        if (this.classList?.contains('object-diff-line-text')) {
          return 240;
        }
        return originalScrollWidth?.get ? originalScrollWidth.get.call(this) : 0;
      },
    });

    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get() {
        if (this.classList?.contains('object-diff-table')) {
          return 5000;
        }
        return originalScrollHeight?.get ? originalScrollHeight.get.call(this) : 0;
      },
    });

    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
      if (this.classList?.contains('object-diff-table')) {
        return buildRect(800, 120);
      }
      if (this.classList?.contains('object-diff-row')) {
        return buildRect(800, 20);
      }
      if (this.classList?.contains('object-diff-line-text')) {
        return buildRect(240, 20);
      }
      return buildRect(0, 0);
    };
  });

  afterAll(() => {
    globalThis.ResizeObserver = originalResizeObserver;
    if (originalClientHeight) {
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', originalClientHeight);
    }
    if (originalClientWidth) {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalClientWidth);
    }
    if (originalScrollWidth) {
      Object.defineProperty(HTMLElement.prototype, 'scrollWidth', originalScrollWidth);
    }
    if (originalScrollHeight) {
      Object.defineProperty(HTMLElement.prototype, 'scrollHeight', originalScrollHeight);
    }
    HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
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

  const contextLine = (lineNumber: number): DisplayDiffLine => ({
    type: 'context',
    value: '',
    leftLineNumber: lineNumber,
    rightLineNumber: lineNumber,
    leftType: 'context',
    rightType: 'context',
  });

  const modifiedLine = (leftLineNumber: number, rightLineNumber: number): DisplayDiffLine => ({
    type: 'context',
    value: '',
    leftLineNumber,
    rightLineNumber,
    leftType: 'removed',
    rightType: 'added',
  });

  const buildContextText = (count: number) =>
    Array.from({ length: count }, (_, index) => `line-${index + 1}`).join('\n');

  it('renders context lines with correct text on both sides', () => {
    const leftText = 'alpha\nbeta\ngamma';
    const rightText = 'alpha\nbeta\ngamma';
    const lines: DisplayDiffLine[] = [contextLine(1), contextLine(2), contextLine(3)];

    act(() => {
      root.render(<DiffViewer lines={lines} leftText={leftText} rightText={rightText} />);
    });

    const rows = container.querySelectorAll('.object-diff-row');
    expect(rows.length).toBe(3);

    const firstRowTexts = rows[0].querySelectorAll('.object-diff-line-text');
    expect(firstRowTexts[0].textContent).toBe('alpha');
    expect(firstRowTexts[1].textContent).toBe('alpha');

    const secondRowTexts = rows[1].querySelectorAll('.object-diff-line-text');
    expect(secondRowTexts[0].textContent).toBe('beta');
    expect(secondRowTexts[1].textContent).toBe('beta');
  });

  it('applies added and removed CSS classes', () => {
    const leftText = 'old-line';
    const rightText = 'new-line';
    const lines: DisplayDiffLine[] = [modifiedLine(1, 1)];

    act(() => {
      root.render(<DiffViewer lines={lines} leftText={leftText} rightText={rightText} />);
    });

    const cells = container.querySelectorAll('.object-diff-cell');
    expect(cells[0].classList.contains('object-diff-cell-removed')).toBe(true);
    expect(cells[1].classList.contains('object-diff-cell-added')).toBe(true);
  });

  it('filters to diff-only when showDiffOnly is true', () => {
    const leftText = 'same\nold\nsame';
    const rightText = 'same\nnew\nsame';
    const lines: DisplayDiffLine[] = [contextLine(1), modifiedLine(2, 2), contextLine(3)];

    act(() => {
      root.render(
        <DiffViewer lines={lines} leftText={leftText} rightText={rightText} showDiffOnly={true} />
      );
    });

    const rows = container.querySelectorAll('.object-diff-row');
    expect(rows.length).toBe(1);

    const leftCell = rows[0].querySelector('.object-diff-cell-left');
    expect(leftCell?.classList.contains('object-diff-cell-removed')).toBe(true);
  });

  it('virtualizes large full-view diffs and updates the rendered window on scroll', async () => {
    const count = 250;
    const text = buildContextText(count);
    const lines = Array.from({ length: count }, (_, index) => contextLine(index + 1));

    act(() => {
      root.render(<DiffViewer lines={lines} leftText={text} rightText={text} />);
    });
    await waitForFrames();

    let rows = container.querySelectorAll('.object-diff-row');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(count);
    expect(rows[0].querySelector('.object-diff-line-number')?.textContent).toBe('1');

    const table = container.querySelector('.object-diff-table') as HTMLDivElement | null;
    expect(table).toBeTruthy();

    await act(async () => {
      table!.scrollTop = 1600;
      table!.dispatchEvent(new Event('scroll'));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    await waitForFrames();

    rows = container.querySelectorAll('.object-diff-row');
    const firstVisibleNumber = Number(
      rows[0].querySelector('.object-diff-line-number')?.textContent ?? '0'
    );
    expect(firstVisibleNumber).toBeGreaterThan(1);
  });

  it('keeps expanded state stable when virtualized rows unmount and remount', async () => {
    const count = 250;
    const text = Array.from({ length: count }, (_, index) => `very-long-line-${index + 1}`).join(
      '\n'
    );
    const lines = Array.from({ length: count }, (_, index) => contextLine(index + 1));

    act(() => {
      root.render(<DiffViewer lines={lines} leftText={text} rightText={text} />);
    });
    await waitForFrames();

    const firstToggle = container.querySelector(
      '.object-diff-expand-toggle'
    ) as HTMLButtonElement | null;
    expect(firstToggle).toBeTruthy();

    await act(async () => {
      firstToggle!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    let firstLeftCell = container.querySelector('.object-diff-cell-left');
    expect(firstLeftCell?.classList.contains('object-diff-cell-expanded')).toBe(true);

    const table = container.querySelector('.object-diff-table') as HTMLDivElement | null;
    await act(async () => {
      table!.scrollTop = 1800;
      table!.dispatchEvent(new Event('scroll'));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    await waitForFrames();

    await act(async () => {
      table!.scrollTop = 0;
      table!.dispatchEvent(new Event('scroll'));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    await waitForFrames();

    firstLeftCell = container.querySelector('.object-diff-cell-left');
    expect(firstLeftCell?.classList.contains('object-diff-cell-expanded')).toBe(true);
  });

  it('renders the full diff on triple-click so side selection still spans the entire side', async () => {
    const count = 250;
    const text = buildContextText(count);
    const lines = Array.from({ length: count }, (_, index) => contextLine(index + 1));

    act(() => {
      root.render(<DiffViewer lines={lines} leftText={text} rightText={text} />);
    });
    await waitForFrames();

    expect(container.querySelectorAll('.object-diff-row').length).toBeLessThan(count);

    const firstLeftText = container.querySelector(
      '.object-diff-cell-left .object-diff-line-text'
    ) as HTMLElement | null;
    expect(firstLeftText).toBeTruthy();

    await act(async () => {
      firstLeftText!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 3 }));
      await Promise.resolve();
    });
    await waitForFrames();

    expect(container.querySelectorAll('.object-diff-row').length).toBe(count);
    expect(
      container.querySelector('.object-diff-table')?.classList.contains('selection-left')
    ).toBe(true);
  });

  it('preserves muted styling and line numbers for visible virtualized rows', async () => {
    const count = 250;
    const text = buildContextText(count);
    const lines = Array.from({ length: count }, (_, index) => contextLine(index + 1));

    act(() => {
      root.render(
        <DiffViewer
          lines={lines}
          leftText={text}
          rightText={text}
          leftMutedLines={new Set([1])}
          rightMutedLines={new Set([2])}
        />
      );
    });
    await waitForFrames();

    const rows = container.querySelectorAll('.object-diff-row');
    expect(rows.length).toBeGreaterThan(0);

    const firstRowNumbers = rows[0].querySelectorAll('.object-diff-line-number');
    expect(firstRowNumbers[0].textContent).toBe('1');
    expect(firstRowNumbers[1].textContent).toBe('1');

    const firstLeftCell = rows[0].querySelector('.object-diff-cell-left');
    expect(firstLeftCell?.classList.contains('object-diff-cell-muted')).toBe(true);
  });

  it('supports keyboard scrolling keys on the diff viewer', async () => {
    const count = 250;
    const text = buildContextText(count);
    const lines = Array.from({ length: count }, (_, index) => contextLine(index + 1));

    act(() => {
      root.render(<DiffViewer lines={lines} leftText={text} rightText={text} />);
    });
    await waitForFrames();

    const table = container.querySelector('.object-diff-table') as HTMLDivElement | null;
    expect(table).toBeTruthy();
    table!.focus();

    await act(async () => {
      table!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      await Promise.resolve();
    });
    expect(table!.scrollTop).toBe(40);

    await act(async () => {
      table!.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }));
      await Promise.resolve();
    });
    expect(table!.scrollTop).toBe(120);

    await act(async () => {
      table!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
      await Promise.resolve();
    });
    expect(table!.scrollTop).toBe(4880);

    await act(async () => {
      table!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
      await Promise.resolve();
    });
    expect(table!.scrollTop).toBe(4840);

    await act(async () => {
      table!.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp', bubbles: true }));
      await Promise.resolve();
    });
    expect(table!.scrollTop).toBe(4760);

    await act(async () => {
      table!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
      await Promise.resolve();
    });
    expect(table!.scrollTop).toBe(0);
  });

  it('renders empty when no lines provided', () => {
    act(() => {
      root.render(<DiffViewer lines={[]} leftText="" rightText="" />);
    });

    const rows = container.querySelectorAll('.object-diff-row');
    expect(rows.length).toBe(0);

    const table = container.querySelector('.object-diff-table');
    expect(table).toBeTruthy();
  });
});
