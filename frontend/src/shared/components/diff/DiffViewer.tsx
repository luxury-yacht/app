/**
 * frontend/src/shared/components/diff/DiffViewer.tsx
 *
 * Self-contained side-by-side diff viewer component.
 * Renders merged diff lines with expand/collapse, selection, and truncation detection.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { DisplayDiffLine, TruncationMap } from '@shared/components/diff/diffUtils';
import { areTruncationMapsEqual } from '@shared/components/diff/diffUtils';
import './DiffViewer.css';

export interface DiffViewerProps {
  /** Merged diff output (DisplayDiffLine[]) to render. */
  lines: DisplayDiffLine[];
  /** Original left text (newline-separated) used to resolve line content. */
  leftText: string;
  /** Original right text (newline-separated) used to resolve line content. */
  rightText: string;
  /** Set of 1-based line numbers on the left side to render as muted. */
  leftMutedLines?: Set<number>;
  /** Set of 1-based line numbers on the right side to render as muted. */
  rightMutedLines?: Set<number>;
  /** When true, only changed lines are displayed. */
  showDiffOnly?: boolean;
  /** Optional additional CSS class name for the root element. */
  className?: string;
}

/**
 * DiffViewer renders a side-by-side diff table with selection support,
 * truncation detection via ResizeObserver, and expand/collapse toggles.
 */
const DiffViewer: React.FC<DiffViewerProps> = ({
  lines,
  leftText,
  rightText,
  leftMutedLines,
  rightMutedLines,
  showDiffOnly = false,
  className,
}) => {
  // Which side is currently selectable for copy.
  const [selectionSide, setSelectionSide] = useState<'left' | 'right'>('left');
  // Set of row indices that are expanded (wrapped text).
  const [expandedRows, setExpandedRows] = useState<Set<number>>(() => new Set());
  // Map of row indices to their left/right truncation state.
  const [truncatedRows, setTruncatedRows] = useState<TruncationMap>({});

  const diffTableRef = useRef<HTMLDivElement>(null);
  const truncatedRowsRef = useRef<TruncationMap>({});

  // Split source text into lines for lookup by 1-based line number.
  const leftDisplayLines = useMemo(() => leftText.split(/\r?\n/), [leftText]);
  const rightDisplayLines = useMemo(() => rightText.split(/\r?\n/), [rightText]);

  // Filter to only changed lines when showDiffOnly is enabled.
  const visibleLines = useMemo(() => {
    if (!showDiffOnly) {
      return lines;
    }
    return lines.filter((line) => line.leftType !== 'context' || line.rightType !== 'context');
  }, [lines, showDiffOnly]);

  // Keep the ref in sync with the latest truncation state.
  useEffect(() => {
    truncatedRowsRef.current = truncatedRows;
  }, [truncatedRows]);

  // Reset expansion and truncation when the visible lines change.
  useEffect(() => {
    setExpandedRows(new Set());
    setTruncatedRows({});
  }, [visibleLines]);

  // Resolve line content from the source text by 1-based line number.
  const getLineText = (displayLines: string[], lineNumber?: number | null): string => {
    if (!lineNumber || lineNumber < 1) {
      return '';
    }
    return displayLines[lineNumber - 1] ?? '';
  };

  // Select all text on one side of the diff table (used by triple-click).
  const selectSideText = (side: 'left' | 'right') => {
    const table = diffTableRef.current;
    if (!table) {
      return;
    }
    const selector =
      side === 'left'
        ? '.object-diff-cell-left .object-diff-line-text'
        : '.object-diff-cell-right .object-diff-line-text';
    const nodes = Array.from(table.querySelectorAll<HTMLElement>(selector));
    if (nodes.length === 0) {
      return;
    }
    const selection = window.getSelection();
    if (!selection) {
      return;
    }
    const firstNode = nodes[0].firstChild ?? nodes[0];
    const lastNode = nodes[nodes.length - 1].firstChild ?? nodes[nodes.length - 1];
    const range = document.createRange();
    range.setStart(firstNode, 0);
    if (lastNode.nodeType === Node.TEXT_NODE) {
      range.setEnd(lastNode, lastNode.textContent?.length ?? 0);
    } else {
      range.setEnd(lastNode, lastNode.childNodes.length);
    }
    selection.removeAllRanges();
    selection.addRange(range);
  };

  // Toggle the expanded state of a row.
  const toggleExpandedRow = (rowIndex: number) => {
    setExpandedRows((current) => {
      const next = new Set(current);
      if (next.has(rowIndex)) {
        next.delete(rowIndex);
      } else {
        next.add(rowIndex);
      }
      return next;
    });
  };

  // Measure text overflow to decide which rows should show expand/collapse toggles.
  const computeTruncation = useCallback(() => {
    const table = diffTableRef.current;
    if (!table) {
      return;
    }

    const next: TruncationMap = {};
    const prev = truncatedRowsRef.current;
    const nodes = table.querySelectorAll<HTMLElement>(
      '.object-diff-line-text[data-row-index][data-side]'
    );

    nodes.forEach((node) => {
      const rowIndex = Number(node.dataset.rowIndex);
      if (Number.isNaN(rowIndex)) {
        return;
      }
      if (expandedRows.has(rowIndex)) {
        if (prev[rowIndex]) {
          next[rowIndex] = { ...prev[rowIndex] };
        }
        return;
      }

      const side = node.dataset.side === 'right' ? 'right' : 'left';
      const isTruncated = node.scrollWidth > node.clientWidth;
      if (!next[rowIndex]) {
        next[rowIndex] = { left: false, right: false };
      }
      next[rowIndex][side] = isTruncated;
    });

    expandedRows.forEach((rowIndex) => {
      if (prev[rowIndex] && !next[rowIndex]) {
        next[rowIndex] = { ...prev[rowIndex] };
      }
    });

    setTruncatedRows((current) => (areTruncationMapsEqual(current, next) ? current : next));
  }, [expandedRows]);

  // Run truncation measurement after layout via rAF.
  useEffect(() => {
    if (!diffTableRef.current) {
      return;
    }
    const frame = requestAnimationFrame(() => computeTruncation());
    return () => cancelAnimationFrame(frame);
  }, [computeTruncation, visibleLines]);

  // Re-measure truncation when the table is resized.
  useEffect(() => {
    const table = diffTableRef.current;
    if (!table || typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(() => computeTruncation());
    observer.observe(table);
    return () => observer.disconnect();
  }, [computeTruncation]);

  // Render a single diff row with left and right cells.
  const renderDiffRow = (line: DisplayDiffLine, index: number) => {
    const leftLineText = getLineText(leftDisplayLines, line.leftLineNumber);
    const rightLineText = getLineText(rightDisplayLines, line.rightLineNumber);
    const leftNumber =
      line.leftLineNumber !== null && line.leftLineNumber !== undefined ? line.leftLineNumber : '';
    const rightNumber =
      line.rightLineNumber !== null && line.rightLineNumber !== undefined
        ? line.rightLineNumber
        : '';
    const leftType = line.leftType;
    const rightType = line.rightType;
    const leftMuted =
      line.leftLineNumber !== null &&
      line.leftLineNumber !== undefined &&
      leftMutedLines?.has(line.leftLineNumber);
    const rightMuted =
      line.rightLineNumber !== null &&
      line.rightLineNumber !== undefined &&
      rightMutedLines?.has(line.rightLineNumber);
    const rowTruncation = truncatedRows[index];
    const isExpanded = expandedRows.has(index);
    const leftHasToggle = Boolean(rowTruncation?.left);
    const rightHasToggle = Boolean(rowTruncation?.right);
    const toggleSymbol = isExpanded ? '\u25BC' : '\u25B6\uFE0E';

    const renderLineGutter = (
      side: 'left' | 'right',
      lineNumber: number | string,
      showToggle: boolean
    ) => (
      <span className="object-diff-line-gutter">
        {showToggle ? (
          <button
            type="button"
            className="object-diff-expand-toggle"
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              toggleExpandedRow(index);
            }}
            aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${side} line ${lineNumber}`}
          >
            {toggleSymbol}
          </button>
        ) : (
          <span className="object-diff-expand-placeholder" aria-hidden="true" />
        )}
        <span className="object-diff-line-number">{lineNumber}</span>
      </span>
    );

    return (
      <div key={`diff-${index}`} className={`object-diff-row object-diff-row-${line.type}`}>
        <div
          className={[
            'object-diff-cell',
            'object-diff-cell-left',
            `object-diff-cell-${leftType}`,
            isExpanded ? 'object-diff-cell-expanded' : '',
            leftMuted ? 'object-diff-cell-muted' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {renderLineGutter('left', leftNumber, leftHasToggle)}
          <span className="object-diff-line-text" data-row-index={index} data-side="left">
            {leftLineText}
          </span>
        </div>
        <div
          className={[
            'object-diff-cell',
            'object-diff-cell-right',
            `object-diff-cell-${rightType}`,
            isExpanded ? 'object-diff-cell-expanded' : '',
            rightMuted ? 'object-diff-cell-muted' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {renderLineGutter('right', rightNumber, rightHasToggle)}
          <span className="object-diff-line-text" data-row-index={index} data-side="right">
            {rightLineText}
          </span>
        </div>
      </div>
    );
  };

  const rootClassName = ['object-diff-table', `selection-${selectionSide}`, className]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={rootClassName}
      ref={diffTableRef}
      onMouseDown={(event) => {
        const target = event.target as HTMLElement | null;
        if (target?.closest('.object-diff-cell-left')) {
          flushSync(() => setSelectionSide('left'));
          return;
        }
        if (target?.closest('.object-diff-cell-right')) {
          flushSync(() => setSelectionSide('right'));
        }
      }}
      onClick={(event) => {
        // Triple-click selects all text on one side.
        if (event.detail !== 3) {
          return;
        }
        const target = event.target as HTMLElement | null;
        const side = target?.closest('.object-diff-cell-left')
          ? 'left'
          : target?.closest('.object-diff-cell-right')
            ? 'right'
            : null;
        if (!side) {
          return;
        }
        event.preventDefault();
        flushSync(() => setSelectionSide(side));
        selectSideText(side);
      }}
    >
      {visibleLines.map(renderDiffRow)}
    </div>
  );
};

export default DiffViewer;
