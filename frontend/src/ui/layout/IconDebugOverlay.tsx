import React from 'react';

import { iconDebugEntries, type IconDebugEntry } from '@shared/components/icons/iconDebugRegistry';
import {
  iconDebugDefaultSizes,
  iconDebugGridSizes,
  iconDebugUsages,
} from '@shared/components/icons/iconDebugUsageSizes';
import { DebugOverlay } from '@ui/layout/DebugOverlay';

interface IconDebugOverlayProps {
  onClose: () => void;
}

type IconDebugSortColumn = 'name' | 'source' | 'grid';
type IconDebugSortDirection = 'asc' | 'desc';

interface IconDebugSortState {
  column: IconDebugSortColumn;
  direction: IconDebugSortDirection;
}

const renderIconPreview = (entry: IconDebugEntry) => {
  if (entry.kind === 'asset') {
    return <img src={entry.src} alt="" className="icon-debug__asset-preview" />;
  }

  const Icon = entry.Component;
  return <Icon {...entry.previewProps} />;
};

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
  column: IconDebugSortColumn
): number => {
  if (column === 'name') {
    return left.name.localeCompare(right.name);
  }
  if (column === 'source') {
    return left.file.localeCompare(right.file) || left.name.localeCompare(right.name);
  }
  return (
    compareGridSize(
      iconDebugGridSizes[left.name] ?? 'unknown',
      iconDebugGridSizes[right.name] ?? 'unknown'
    ) || left.name.localeCompare(right.name)
  );
};

const getAriaSort = (
  sort: IconDebugSortState | null,
  column: IconDebugSortColumn
): 'none' | 'ascending' | 'descending' =>
  sort?.column !== column ? 'none' : sort.direction === 'asc' ? 'ascending' : 'descending';

export const IconDebugOverlay: React.FC<IconDebugOverlayProps> = ({ onClose }) => {
  const [sort, setSort] = React.useState<IconDebugSortState | null>(null);

  const sortedEntries = React.useMemo(() => {
    if (!sort) {
      return iconDebugEntries;
    }

    return [...iconDebugEntries].sort((left, right) => {
      const result = compareIconDebugEntries(left, right, sort.column);
      return sort.direction === 'asc' ? result : -result;
    });
  }, [sort]);

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
    <DebugOverlay title="Icon Debug (Ctrl+Alt+I)" testId="icon-debug-overlay" onClose={onClose}>
      <div className="debug-overlay__meta">
        {iconDebugEntries.length} SVG icons and cursor assets
      </div>
      <table className="icon-debug-table">
        <thead>
          <tr>
            <th scope="col">Preview</th>
            <th scope="col" aria-sort={getAriaSort(sort, 'name')}>
              {renderSortHeader('name', 'Name')}
            </th>
            <th scope="col" aria-sort={getAriaSort(sort, 'source')}>
              {renderSortHeader('source', 'Source')}
            </th>
            <th scope="col" aria-sort={getAriaSort(sort, 'grid')}>
              {renderSortHeader('grid', 'Grid')}
            </th>
            <th scope="col">Default</th>
            <th scope="col">Usage</th>
          </tr>
        </thead>
        <tbody>
          {sortedEntries.map((entry) => (
            <tr key={`${entry.file}:${entry.name}`} className="icon-debug-row">
              <td className="icon-debug-row__preview-cell">
                <div className="icon-debug-row__preview" aria-hidden="true">
                  {renderIconPreview(entry)}
                </div>
              </td>
              <td>
                <span className="icon-debug-row__name">{entry.name}</span>
              </td>
              <td>
                <span className="icon-debug-row__file">{entry.file}</span>
              </td>
              <td>
                <div className="icon-debug-row__metrics">
                  <span className="icon-debug-row__metric">
                    {iconDebugGridSizes[entry.name] ?? 'unknown'}
                  </span>
                </div>
              </td>
              <td>
                <div className="icon-debug-row__metrics">
                  <span className="icon-debug-row__metric">
                    {iconDebugDefaultSizes[entry.name] ?? 'unknown'}
                  </span>
                </div>
              </td>
              <td>
                <div className="icon-debug-row__usages">
                  {(iconDebugUsages[entry.name] ?? []).length > 0 ? (
                    iconDebugUsages[entry.name].map((usage, index) => (
                      <span
                        key={`${usage.source}-${index}`}
                        className="icon-debug-row__usage"
                        title={`${usage.source} (${usage.basis})`}
                      >
                        <span className="icon-debug-row__usage-size">
                          rendered {usage.renderedSize}
                        </span>
                        <span className="icon-debug-row__usage-source">{usage.source}</span>
                      </span>
                    ))
                  ) : (
                    <span className="icon-debug-row__usage icon-debug-row__usage--empty">
                      No production usage found
                    </span>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </DebugOverlay>
  );
};
