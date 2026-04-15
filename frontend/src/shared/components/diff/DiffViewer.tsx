/**
 * frontend/src/shared/components/diff/DiffViewer.tsx
 *
 * Self-contained side-by-side diff viewer component.
 * Renders merged diff lines with expand/collapse, selection, and truncation detection.
 */

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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

const DIFF_VIRTUALIZATION_THRESHOLD = 200;
const DIFF_VIRTUALIZATION_OVERSCAN = 6;
const DIFF_ESTIMATED_ROW_HEIGHT = 32;
const DIFF_DEFAULT_VIEWPORT_HEIGHT = 600;
const DIFF_KEYBOARD_SCROLL_LINE_STEP = 40;

const findRowAtOffset = (positions: Float64Array, target: number): number => {
  let lo = 0;
  let hi = positions.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (positions[mid] <= target) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return Math.max(0, lo - 1);
};

/**
 * DiffViewer renders a side-by-side diff table with selection support,
 * truncation detection via ResizeObserver, expand/collapse toggles,
 * and row virtualization for large diffs.
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
  const [selectionSide, setSelectionSide] = useState<'left' | 'right'>('left');
  const [expandedRows, setExpandedRows] = useState<Set<number>>(() => new Set());
  const [truncatedRows, setTruncatedRows] = useState<TruncationMap>({});
  const [virtualViewportHeight, setVirtualViewportHeight] = useState(DIFF_DEFAULT_VIEWPORT_HEIGHT);
  const [virtualScrollTop, setVirtualScrollTop] = useState(0);
  const [rowHeightCacheVersion, setRowHeightCacheVersion] = useState(0);
  const [forceFullRender, setForceFullRender] = useState(false);

  const diffTableRef = useRef<HTMLDivElement>(null);
  const truncatedRowsRef = useRef<TruncationMap>({});
  const rowHeightCacheRef = useRef<Map<number, number>>(new Map());
  const rowObserverMapRef = useRef<Map<number, ResizeObserver>>(new Map());
  const scrollRafRef = useRef<number | null>(null);
  const pendingScrollTopRef = useRef<number | null>(null);

  const leftDisplayLines = useMemo(() => leftText.split(/\r?\n/), [leftText]);
  const rightDisplayLines = useMemo(() => rightText.split(/\r?\n/), [rightText]);

  const visibleLines = useMemo(() => {
    if (!showDiffOnly) {
      return lines;
    }
    return lines.filter((line) => line.leftType !== 'context' || line.rightType !== 'context');
  }, [lines, showDiffOnly]);

  const virtualizationCandidate = visibleLines.length >= DIFF_VIRTUALIZATION_THRESHOLD;
  const shouldVirtualize = virtualizationCandidate && !forceFullRender;

  const rowPositions = useMemo(() => {
    const positions = new Float64Array(visibleLines.length + 1);
    const cache = rowHeightCacheRef.current;
    for (let index = 0; index < visibleLines.length; index += 1) {
      positions[index + 1] = positions[index] + (cache.get(index) ?? DIFF_ESTIMATED_ROW_HEIGHT);
    }
    return positions;
    // rowHeightCacheVersion is load-bearing here: it forces recomputation when
    // measured row heights change even though the cache itself lives in a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowHeightCacheVersion, visibleLines.length]);

  const totalVirtualHeight = useMemo(
    () => (shouldVirtualize ? rowPositions[visibleLines.length] : 0),
    [rowPositions, shouldVirtualize, visibleLines.length]
  );

  const virtualRange = useMemo(() => {
    if (!shouldVirtualize || visibleLines.length === 0) {
      return { start: 0, end: visibleLines.length };
    }

    const firstVisible = findRowAtOffset(rowPositions, virtualScrollTop);
    const start = Math.max(0, firstVisible - DIFF_VIRTUALIZATION_OVERSCAN);
    const viewportBottom = virtualScrollTop + virtualViewportHeight;
    let visibleCount = 0;
    for (let index = firstVisible; index < visibleLines.length; index += 1) {
      if (rowPositions[index] >= viewportBottom) {
        break;
      }
      visibleCount += 1;
    }

    const bufferedVisibleCount = Math.max(1, visibleCount) + DIFF_VIRTUALIZATION_OVERSCAN * 2;
    return {
      start,
      end: Math.min(visibleLines.length, start + bufferedVisibleCount),
    };
  }, [
    rowPositions,
    shouldVirtualize,
    virtualScrollTop,
    virtualViewportHeight,
    visibleLines.length,
  ]);

  const virtualOffset = useMemo(() => {
    if (!shouldVirtualize) {
      return 0;
    }
    return rowPositions[virtualRange.start];
  }, [rowPositions, shouldVirtualize, virtualRange.start]);

  const renderedLineEntries = useMemo(() => {
    if (!shouldVirtualize) {
      return visibleLines.map((line, index) => ({ line, index }));
    }
    return visibleLines.slice(virtualRange.start, virtualRange.end).map((line, offset) => ({
      line,
      index: virtualRange.start + offset,
    }));
  }, [shouldVirtualize, virtualRange.end, virtualRange.start, visibleLines]);

  useEffect(() => {
    truncatedRowsRef.current = truncatedRows;
  }, [truncatedRows]);

  useEffect(() => {
    setExpandedRows(new Set());
    setTruncatedRows({});
    setForceFullRender(false);
    rowHeightCacheRef.current.clear();
    setRowHeightCacheVersion((current) => current + 1);
  }, [visibleLines]);

  useEffect(
    () => () => {
      rowObserverMapRef.current.forEach((observer) => observer.disconnect());
      rowObserverMapRef.current.clear();
    },
    []
  );

  const getLineText = (displayLines: string[], lineNumber?: number | null): string => {
    if (!lineNumber || lineNumber < 1) {
      return '';
    }
    return displayLines[lineNumber - 1] ?? '';
  };

  const scrollDiffTableTo = useCallback(
    (nextScrollTop: number) => {
      const table = diffTableRef.current;
      if (!table) {
        return;
      }

      const maxScrollTop = Math.max(0, table.scrollHeight - table.clientHeight);
      const boundedScrollTop = Math.min(Math.max(0, nextScrollTop), maxScrollTop);
      table.scrollTop = boundedScrollTop;
      pendingScrollTopRef.current = null;
      if (shouldVirtualize) {
        setVirtualScrollTop(boundedScrollTop);
      }
    },
    [shouldVirtualize]
  );

  const handleKeyScroll = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const table = diffTableRef.current;
      if (!table || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }

      const target = event.target as HTMLElement | null;
      if (
        target?.closest(
          'button, input, textarea, select, [contenteditable="true"], [contenteditable=""]'
        )
      ) {
        return;
      }

      let nextScrollTop: number | null = null;
      switch (event.key) {
        case 'ArrowDown':
          nextScrollTop = table.scrollTop + DIFF_KEYBOARD_SCROLL_LINE_STEP;
          break;
        case 'ArrowUp':
          nextScrollTop = table.scrollTop - DIFF_KEYBOARD_SCROLL_LINE_STEP;
          break;
        case 'PageDown':
          nextScrollTop =
            table.scrollTop + Math.max(table.clientHeight - DIFF_KEYBOARD_SCROLL_LINE_STEP, 0);
          break;
        case 'PageUp':
          nextScrollTop =
            table.scrollTop - Math.max(table.clientHeight - DIFF_KEYBOARD_SCROLL_LINE_STEP, 0);
          break;
        case 'Home':
          nextScrollTop = 0;
          break;
        case 'End':
          nextScrollTop = table.scrollHeight;
          break;
        default:
          break;
      }

      if (nextScrollTop === null) {
        return;
      }

      event.preventDefault();
      scrollDiffTableTo(nextScrollTop);
    },
    [scrollDiffTableTo]
  );

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

  const measureRowRef = useCallback(
    (rowIndex: number, node: HTMLDivElement | null) => {
      const existingObserver = rowObserverMapRef.current.get(rowIndex);
      if (existingObserver) {
        existingObserver.disconnect();
        rowObserverMapRef.current.delete(rowIndex);
      }
      if (!node || !virtualizationCandidate) {
        return;
      }

      const measure = () => {
        const nextHeight = node.getBoundingClientRect().height;
        if (nextHeight <= 0) {
          return;
        }
        const cachedHeight = rowHeightCacheRef.current.get(rowIndex);
        if (cachedHeight === undefined || Math.abs(cachedHeight - nextHeight) > 0.5) {
          rowHeightCacheRef.current.set(rowIndex, nextHeight);
          setRowHeightCacheVersion((current) => current + 1);
        }
      };

      measure();
      if (typeof ResizeObserver === 'undefined') {
        return;
      }

      const observer = new ResizeObserver(() => measure());
      observer.observe(node);
      rowObserverMapRef.current.set(rowIndex, observer);
    },
    [virtualizationCandidate]
  );

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

  useLayoutEffect(() => {
    const table = diffTableRef.current;
    if (!shouldVirtualize || !table) {
      setVirtualViewportHeight(DIFF_DEFAULT_VIEWPORT_HEIGHT);
      return;
    }

    const updateViewport = () => {
      const nextHeight =
        table.clientHeight || table.getBoundingClientRect().height || DIFF_DEFAULT_VIEWPORT_HEIGHT;
      setVirtualViewportHeight((current) =>
        Math.abs(current - nextHeight) < 0.5 ? current : nextHeight
      );
    };

    updateViewport();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => updateViewport());
      observer.observe(table);
      return () => observer.disconnect();
    }

    return undefined;
  }, [renderedLineEntries.length, shouldVirtualize]);

  useEffect(() => {
    const table = diffTableRef.current;
    if (!shouldVirtualize || !table) {
      setVirtualScrollTop(0);
      return;
    }

    const flushScrollUpdates = () => {
      scrollRafRef.current = null;
      const nextScrollTop = pendingScrollTopRef.current;
      if (nextScrollTop === null) {
        return;
      }
      pendingScrollTopRef.current = null;
      setVirtualScrollTop(nextScrollTop);
    };

    const handleScroll = () => {
      pendingScrollTopRef.current = table.scrollTop;
      if (scrollRafRef.current === null) {
        scrollRafRef.current = requestAnimationFrame(flushScrollUpdates);
      }
    };

    table.addEventListener('scroll', handleScroll, { passive: true });
    setVirtualScrollTop(table.scrollTop);

    return () => {
      table.removeEventListener('scroll', handleScroll);
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
      pendingScrollTopRef.current = null;
    };
  }, [shouldVirtualize]);

  useEffect(() => {
    if (!forceFullRender) {
      return;
    }

    const handleSelectionChange = () => {
      const selection = window.getSelection();
      const table = diffTableRef.current;
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed || !table) {
        setForceFullRender(false);
        return;
      }

      const anchorNode = selection.anchorNode;
      if (!anchorNode || !table.contains(anchorNode)) {
        setForceFullRender(false);
      }
    };

    document.addEventListener('selectionchange', handleSelectionChange);
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
    };
  }, [forceFullRender]);

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

  useEffect(() => {
    if (!diffTableRef.current) {
      return;
    }
    const frame = requestAnimationFrame(() => computeTruncation());
    return () => cancelAnimationFrame(frame);
  }, [computeTruncation, renderedLineEntries, visibleLines]);

  useEffect(() => {
    const table = diffTableRef.current;
    if (!table || typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(() => computeTruncation());
    observer.observe(table);
    return () => observer.disconnect();
  }, [computeTruncation]);

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
    const rowKey = [
      index,
      line.leftLineNumber ?? 'left-null',
      line.rightLineNumber ?? 'right-null',
      line.leftType,
      line.rightType,
    ].join(':');

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
      <div
        key={rowKey}
        ref={(node) => measureRowRef(index, node)}
        className={`object-diff-row object-diff-row-${line.type}`}
      >
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
        if (target?.closest('.object-diff-expand-toggle')) {
          return;
        }
        diffTableRef.current?.focus({ preventScroll: true });
        if (target?.closest('.object-diff-cell-left')) {
          flushSync(() => setSelectionSide('left'));
          return;
        }
        if (target?.closest('.object-diff-cell-right')) {
          flushSync(() => setSelectionSide('right'));
        }
      }}
      onClick={(event) => {
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
        flushSync(() => {
          setSelectionSide(side);
          if (virtualizationCandidate) {
            setForceFullRender(true);
          }
        });
        selectSideText(side);
      }}
      onKeyDown={handleKeyScroll}
      tabIndex={0}
    >
      {shouldVirtualize ? (
        <div className="object-diff-virtual-body" style={{ height: `${totalVirtualHeight}px` }}>
          <div
            className="object-diff-virtual-inner"
            style={{ transform: `translateY(${virtualOffset}px)` }}
          >
            {renderedLineEntries.map(({ line, index }) => renderDiffRow(line, index))}
          </div>
        </div>
      ) : (
        renderedLineEntries.map(({ line, index }) => renderDiffRow(line, index))
      )}
    </div>
  );
};

export default DiffViewer;
