/**
 * frontend/src/shared/components/diff/DiffViewer.test.tsx
 *
 * Test suite for the DiffViewer component.
 * Covers rendering of context, added, and removed lines, diff-only filtering,
 * muted line styling, and empty input handling.
 */

import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DisplayDiffLine } from '@shared/components/diff/diffUtils';
import DiffViewer from './DiffViewer';

describe('DiffViewer', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
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

  // Helper: build a context DisplayDiffLine with matching left/right line numbers.
  const contextLine = (lineNumber: number): DisplayDiffLine => ({
    type: 'context',
    value: '',
    leftLineNumber: lineNumber,
    rightLineNumber: lineNumber,
    leftType: 'context',
    rightType: 'context',
  });

  // Helper: build a removed-left / added-right DisplayDiffLine (modification row).
  const modifiedLine = (leftLineNumber: number, rightLineNumber: number): DisplayDiffLine => ({
    type: 'context',
    value: '',
    leftLineNumber,
    rightLineNumber,
    leftType: 'removed',
    rightType: 'added',
  });

  it('renders context lines with correct text on both sides', () => {
    const leftText = 'alpha\nbeta\ngamma';
    const rightText = 'alpha\nbeta\ngamma';
    const lines: DisplayDiffLine[] = [contextLine(1), contextLine(2), contextLine(3)];

    act(() => {
      root.render(<DiffViewer lines={lines} leftText={leftText} rightText={rightText} />);
    });

    const rows = container.querySelectorAll('.object-diff-row');
    expect(rows.length).toBe(3);

    // First row: both sides show "alpha".
    const firstRowTexts = rows[0].querySelectorAll('.object-diff-line-text');
    expect(firstRowTexts[0].textContent).toBe('alpha');
    expect(firstRowTexts[1].textContent).toBe('alpha');

    // Second row: both sides show "beta".
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
    // Left cell should have the removed class.
    expect(cells[0].classList.contains('object-diff-cell-removed')).toBe(true);
    // Right cell should have the added class.
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

    // Only the modified row should be rendered; context rows are filtered out.
    const rows = container.querySelectorAll('.object-diff-row');
    expect(rows.length).toBe(1);

    // Verify it is the modified row.
    const leftCell = rows[0].querySelector('.object-diff-cell-left');
    expect(leftCell?.classList.contains('object-diff-cell-removed')).toBe(true);
  });

  it('applies muted class to specified lines', () => {
    const leftText = 'line-a\nline-b';
    const rightText = 'line-a\nline-b';
    const lines: DisplayDiffLine[] = [contextLine(1), contextLine(2)];
    const leftMuted = new Set([1]);
    const rightMuted = new Set([2]);

    act(() => {
      root.render(
        <DiffViewer
          lines={lines}
          leftText={leftText}
          rightText={rightText}
          leftMutedLines={leftMuted}
          rightMutedLines={rightMuted}
        />
      );
    });

    const rows = container.querySelectorAll('.object-diff-row');

    // Row 0: left side line 1 is muted, right side is not.
    const row0LeftCell = rows[0].querySelector('.object-diff-cell-left');
    const row0RightCell = rows[0].querySelector('.object-diff-cell-right');
    expect(row0LeftCell?.classList.contains('object-diff-cell-muted')).toBe(true);
    expect(row0RightCell?.classList.contains('object-diff-cell-muted')).toBe(false);

    // Row 1: right side line 2 is muted, left side is not.
    const row1LeftCell = rows[1].querySelector('.object-diff-cell-left');
    const row1RightCell = rows[1].querySelector('.object-diff-cell-right');
    expect(row1LeftCell?.classList.contains('object-diff-cell-muted')).toBe(false);
    expect(row1RightCell?.classList.contains('object-diff-cell-muted')).toBe(true);
  });

  it('renders empty when no lines provided', () => {
    act(() => {
      root.render(<DiffViewer lines={[]} leftText="" rightText="" />);
    });

    const rows = container.querySelectorAll('.object-diff-row');
    expect(rows.length).toBe(0);

    // The table container should still render.
    const table = container.querySelector('.object-diff-table');
    expect(table).toBeTruthy();
  });
});
