import React from 'react';

import { iconDebugEntries, type IconDebugEntry } from '@shared/components/icons/iconDebugDiscovery';
import { DebugOverlay } from '@ui/layout/DebugOverlay';

interface IconDebugOverlayProps {
  onClose: () => void;
}

type IconDebugSortColumn = 'default' | 'grid' | 'name' | 'source';
type IconDebugSortDirection = 'asc' | 'desc';

interface IconDebugSortState {
  column: IconDebugSortColumn;
  direction: IconDebugSortDirection;
}

interface IconDebugMetrics {
  gridSize: string;
  defaultSize: string;
}

type IconDebugMetricsMap = Record<string, IconDebugMetrics>;

const SVG_DEFAULT_SIZE = '300x150';

const parseGridSize = (value: string): [number, number] | null => {
  const match = value.match(/^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/);
  if (!match) {
    return null;
  }
  return [Number(match[1]), Number(match[2])];
};

const compareGridSize = (left: string, right: string): number => {
  const leftSize = parseGridSize(left);
  const rightSize = parseGridSize(right);
  if (leftSize && rightSize) {
    return leftSize[0] - rightSize[0] || leftSize[1] - rightSize[1];
  }
  return left.localeCompare(right);
};

const compareIconDebugEntries = (
  left: IconDebugEntry,
  right: IconDebugEntry,
  column: IconDebugSortColumn,
  metrics: IconDebugMetricsMap
): number => {
  if (column === 'name') {
    return left.name.localeCompare(right.name);
  }
  if (column === 'source') {
    return left.file.localeCompare(right.file) || left.name.localeCompare(right.name);
  }
  if (column === 'default') {
    return (
      compareGridSize(
        getEntryMetrics(left, metrics).defaultSize,
        getEntryMetrics(right, metrics).defaultSize
      ) || left.name.localeCompare(right.name)
    );
  }
  return (
    compareGridSize(
      getEntryMetrics(left, metrics).gridSize,
      getEntryMetrics(right, metrics).gridSize
    ) || left.name.localeCompare(right.name)
  );
};

const getEntryMetrics = (entry: IconDebugEntry, metrics: IconDebugMetricsMap): IconDebugMetrics => {
  if (entry.kind === 'asset') {
    return { gridSize: entry.gridSize, defaultSize: entry.defaultSize };
  }
  return metrics[entry.name] ?? { gridSize: 'unknown', defaultSize: 'unknown' };
};

const formatSvgSize = (svg: SVGSVGElement): IconDebugMetrics => {
  const viewBox = svg.viewBox.baseVal;
  const gridSize =
    viewBox.width > 0 && viewBox.height > 0 ? `${viewBox.width}x${viewBox.height}` : 'unknown';
  const width = svg.getAttribute('width');
  const height = svg.getAttribute('height');

  return {
    gridSize,
    defaultSize: width && height ? `${width}x${height}` : SVG_DEFAULT_SIZE,
  };
};

const IconDebugPreview: React.FC<{
  entry: IconDebugEntry;
  onMeasure: (name: string, metrics: IconDebugMetrics) => void;
}> = ({ entry, onMeasure }) => {
  const previewRef = React.useRef<HTMLDivElement | null>(null);

  React.useLayoutEffect(() => {
    if (entry.kind === 'asset') {
      onMeasure(entry.name, { gridSize: entry.gridSize, defaultSize: entry.defaultSize });
      return;
    }

    const svg = previewRef.current?.querySelector('svg');
    if (svg) {
      onMeasure(entry.name, formatSvgSize(svg));
    }
  }, [entry, onMeasure]);

  return (
    <div ref={previewRef} className="icon-debug-row__preview" aria-hidden="true">
      {entry.kind === 'asset' ? (
        <img
          src={entry.src}
          alt=""
          width={entry.defaultSize.split('x')[0]}
          height={entry.defaultSize.split('x')[1]}
          className="icon-debug__asset-preview"
        />
      ) : (
        <entry.Component {...entry.previewProps} />
      )}
    </div>
  );
};

const getAriaSort = (
  sort: IconDebugSortState | null,
  column: IconDebugSortColumn
): 'none' | 'ascending' | 'descending' =>
  sort?.column !== column ? 'none' : sort.direction === 'asc' ? 'ascending' : 'descending';

const IconDebugColGroup: React.FC = () => (
  <colgroup>
    <col className="icon-debug-table__preview-col" />
    <col className="icon-debug-table__metric-col" />
    <col className="icon-debug-table__metric-col" />
    <col />
    <col />
  </colgroup>
);

export const IconDebugOverlay: React.FC<IconDebugOverlayProps> = ({ onClose }) => {
  const [sort, setSort] = React.useState<IconDebugSortState>({ column: 'name', direction: 'asc' });
  const [metrics, setMetrics] = React.useState<IconDebugMetricsMap>({});

  const handleMeasure = React.useCallback((name: string, nextMetrics: IconDebugMetrics) => {
    setMetrics((current) => {
      const previous = current[name];
      if (
        previous?.gridSize === nextMetrics.gridSize &&
        previous.defaultSize === nextMetrics.defaultSize
      ) {
        return current;
      }
      return { ...current, [name]: nextMetrics };
    });
  }, []);

  const sortedEntries = React.useMemo(() => {
    if (!sort) {
      return iconDebugEntries;
    }

    return [...iconDebugEntries].sort((left, right) => {
      const result = compareIconDebugEntries(left, right, sort.column, metrics);
      return sort.direction === 'asc' ? result : -result;
    });
  }, [metrics, sort]);

  const toggleSort = (column: IconDebugSortColumn) => {
    setSort((current) => {
      if (current?.column === column) {
        return { column, direction: current.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { column, direction: 'asc' };
    });
  };

  const renderSortHeader = (column: IconDebugSortColumn, label: string) => {
    const direction = sort?.column === column ? sort.direction : null;
    return (
      <button
        type="button"
        className="icon-debug-table__sort-button"
        onClick={() => toggleSort(column)}
        aria-label={`Sort by ${label}${direction === 'asc' ? ' descending' : ' ascending'}`}
      >
        <span>{label}</span>
        <span className="icon-debug-table__sort-indicator" aria-hidden="true">
          {direction === 'asc' ? '▲' : direction === 'desc' ? '▼' : ''}
        </span>
      </button>
    );
  };

  return (
    <DebugOverlay
      title="Icon Debug (Ctrl+Alt+I)"
      testId="icon-debug-overlay"
      bodyClassName="icon-debug-overlay__body"
      onClose={onClose}
    >
      <div className="icon-debug-table-shell">
        <table className="icon-debug-table icon-debug-table--header">
          <IconDebugColGroup />
          <thead>
            <tr>
              <th scope="col">View</th>
              <th scope="col" aria-sort={getAriaSort(sort, 'default')}>
                {renderSortHeader('default', 'Size')}
              </th>
              <th scope="col" aria-sort={getAriaSort(sort, 'grid')}>
                {renderSortHeader('grid', 'Grid')}
              </th>
              <th scope="col" aria-sort={getAriaSort(sort, 'name')}>
                {renderSortHeader('name', 'Name')}
              </th>
              <th scope="col" aria-sort={getAriaSort(sort, 'source')}>
                {renderSortHeader('source', 'Source')}
              </th>
            </tr>
          </thead>
        </table>
        <div className="icon-debug-table__body-scroll">
          <table className="icon-debug-table icon-debug-table--body">
            <IconDebugColGroup />
            <tbody>
              {sortedEntries.map((entry) => {
                const entryMetrics = getEntryMetrics(entry, metrics);

                return (
                  <tr key={`${entry.file}:${entry.name}`} className="icon-debug-row">
                    <td className="icon-debug-row__preview-cell">
                      <IconDebugPreview entry={entry} onMeasure={handleMeasure} />
                    </td>
                    <td>
                      <div className="icon-debug-row__metrics">
                        <span className="icon-debug-row__metric">{entryMetrics.defaultSize}</span>
                      </div>
                    </td>
                    <td>
                      <div className="icon-debug-row__metrics">
                        <span className="icon-debug-row__metric">{entryMetrics.gridSize}</span>
                      </div>
                    </td>
                    <td>
                      <span className="icon-debug-row__name">{entry.name}</span>
                    </td>
                    <td>
                      <span className="icon-debug-row__file">{entry.file}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </DebugOverlay>
  );
};
