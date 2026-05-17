import { useCallback, type ReactNode, type RefObject } from 'react';
import { useVirtualizedLogRows } from './hooks/useVirtualizedLogRows';

export interface RenderedLogRow {
  key: string;
  line: string;
}

interface RawLogViewerProps {
  rows: RenderedLogRow[];
  scrollContainerRef: RefObject<HTMLElement | null>;
  wrapText: boolean;
  renderRow?: (row: RenderedLogRow, index: number) => ReactNode;
  virtualizationThreshold?: number;
  virtualizationOverscan?: number;
  estimateRowHeight?: number;
  verticalPaddingPx?: number;
}

const DEFAULT_VIRTUALIZATION_THRESHOLD = 120;
const DEFAULT_VIRTUALIZATION_OVERSCAN = 10;
const DEFAULT_ESTIMATE_ROW_HEIGHT = 26;
const DEFAULT_VERTICAL_PADDING_PX = 16;

const RawLogViewer = ({
  rows,
  scrollContainerRef,
  wrapText,
  renderRow,
  virtualizationThreshold = DEFAULT_VIRTUALIZATION_THRESHOLD,
  virtualizationOverscan = DEFAULT_VIRTUALIZATION_OVERSCAN,
  estimateRowHeight = DEFAULT_ESTIMATE_ROW_HEIGHT,
  verticalPaddingPx = DEFAULT_VERTICAL_PADDING_PX,
}: RawLogViewerProps) => {
  const { shouldVirtualize, visibleRows, virtualRange, totalHeight, offsetTop, measureRowRef } =
    useVirtualizedLogRows({
      rows,
      scrollContainerRef,
      keyExtractor: (row) => row.key,
      threshold: virtualizationThreshold,
      overscan: virtualizationOverscan,
      estimateRowHeight,
    });

  const renderContent = useCallback(
    (row: RenderedLogRow, index: number) =>
      renderRow ? renderRow(row, index) : <div className="log-viewer-line">{row.line}</div>,
    [renderRow]
  );

  return (
    <div
      className={`logs-viewer-text ${!wrapText ? 'no-wrap' : ''} ${
        shouldVirtualize ? 'logs-viewer-text--virtualized' : ''
      }`}
    >
      {shouldVirtualize ? (
        <div
          className="logs-viewer-virtual-body"
          style={{ height: `${totalHeight + verticalPaddingPx}px` }}
        >
          <div
            className="logs-viewer-virtual-inner"
            style={{ transform: `translateY(${offsetTop + verticalPaddingPx / 2}px)` }}
          >
            {visibleRows.map((row, index) => {
              const absoluteIndex = virtualRange.start + index;
              return (
                <div
                  key={row.key}
                  className="log-viewer-row"
                  ref={(node) => {
                    measureRowRef(row.key, node);
                  }}
                >
                  {renderContent(row, absoluteIndex)}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        rows.map((row, index) => (
          <div key={row.key} className="log-viewer-row">
            {renderContent(row, index)}
          </div>
        ))
      )}
    </div>
  );
};

export default RawLogViewer;
