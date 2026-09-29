/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Logs/LogViewerLayout.tsx
 *
 * Container Logs layout: the controls row, the log region with its warnings and
 * filter chips, and the loading, paused and error states that replace it.
 */

import ActiveFilterChips, { type ActiveFilterChip } from '@shared/components/ActiveFilterChips';
import ClusterDataPausedState from '@shared/components/ClusterDataPausedState';
import { Dropdown, type DropdownOption } from '@shared/components/dropdowns/Dropdown';
import { normalizeDropdownValue } from '@shared/components/dropdowns/dropdownValue';
import { multiSelectFilterTriggerLabel } from '@shared/components/dropdowns/multiSelectFilterSelection';
import IconBar, { type IconBarItem } from '@shared/components/IconBar/IconBar';
import LoadingSpinner from '@shared/components/LoadingSpinner';
import ScrollableRegion from '@shared/components/ScrollableRegion';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable';
import ObjPanelLogsSettingsModal from '@ui/modals/ObjPanelLogsSettingsModal';
import type React from 'react';
import type { ContainerLogRow } from './containerLogRows';
import { LogBufferFullIndicator, LogErrorState, LogWarningBar } from './LogStatus';
import {
  logFilterSelectionFromDropdownValues,
  logFilterSelectionToDropdownValues,
} from './logFilterSelection';
import type { ParsedLogEntry } from './logOptionsReducer';
import { LogMatchCount, LogTextFilter } from './logToolbar';
import type { LogViewerAction } from './logViewerReducer';
import ParsedLogTable from './ParsedLogTable';
import RawLogViewer from './RawLogViewer';

export const renderLogViewerContent = ({
  isParsedView,
  parsedLogs,
  tableColumns,
  expandedRows,
  onToggleParsedRow,
  displayRows,
  logsContentRef,
  wrapText,
  renderRawLogRow,
}: {
  isParsedView: boolean;
  parsedLogs: ParsedLogEntry[];
  tableColumns: GridColumnDefinition<ParsedLogEntry>[];
  expandedRows: Set<string>;
  onToggleParsedRow: (rowKey: string) => void;
  displayRows: ContainerLogRow[];
  logsContentRef: React.RefObject<HTMLElement | null>;
  wrapText: boolean;
  renderRawLogRow: (row: ContainerLogRow) => React.ReactNode;
}): React.ReactNode => {
  if (isParsedView) {
    return (
      <ParsedLogTable
        rows={parsedLogs}
        columns={tableColumns}
        expandedRows={expandedRows}
        onToggleRow={onToggleParsedRow}
      />
    );
  }
  if (displayRows.length === 0) {
    return null;
  }
  return (
    <RawLogViewer
      rows={displayRows}
      scrollContainerRef={logsContentRef}
      wrapText={wrapText}
      renderRow={renderRawLogRow}
    />
  );
};

export const renderLogViewerBlockingState = ({
  loading,
  loadingMessage,
  paused,
  displayError,
  retryHint,
  hasEntries,
}: {
  loading: boolean;
  loadingMessage: string;
  paused: boolean;
  displayError: string | null;
  retryHint: boolean;
  hasEntries: boolean;
}) => {
  if (loading) {
    return (
      <div className="object-panel-tab-content">
        <LoadingSpinner message={loadingMessage} />
      </div>
    );
  }
  if (paused) {
    return (
      <div className="object-panel-tab-content">
        <div className="logs-viewer-display-empty">
          <ClusterDataPausedState />
        </div>
      </div>
    );
  }
  if (displayError && !hasEntries) {
    return (
      <div className="object-panel-tab-content">
        <LogErrorState message={displayError} retryHint={retryHint} />
      </div>
    );
  }
  return null;
};

type LogViewerControlsProps = {
  activeFilterChips: ActiveFilterChip[];
  selectorOptions: DropdownOption[];
  selectedFilters: Parameters<typeof logFilterSelectionToDropdownValues>[0];
  isPendingLogs: boolean;
  filterInputRef: React.RefObject<HTMLInputElement | null>;
  textFilter: string;
  iconItems: IconBarItem[];
  hasActiveResultFilter: boolean;
  matchCount: number;
  bufferFullShown: number | null;
  dispatch: React.Dispatch<LogViewerAction>;
};

export const LogViewerControls = ({
  activeFilterChips,
  selectorOptions,
  selectedFilters,
  isPendingLogs,
  filterInputRef,
  textFilter,
  iconItems,
  hasActiveResultFilter,
  matchCount,
  bufferFullShown,
  dispatch,
}: LogViewerControlsProps) => (
  <div
    className={`logs-viewer-controls${activeFilterChips.length > 0 ? ' logs-viewer-controls--with-active-filters' : ''}`}
  >
    <div className="logs-viewer-controls-left">
      {selectorOptions.length > 0 && (
        <div className="logs-viewer-control-group">
          <Dropdown
            options={selectorOptions}
            value={logFilterSelectionToDropdownValues(selectedFilters, selectorOptions)}
            onChange={(value) =>
              dispatch({
                type: 'SET_SELECTED_FILTERS',
                payload: logFilterSelectionFromDropdownValues(
                  normalizeDropdownValue(value),
                  selectorOptions
                ),
              })
            }
            multiple
            showBulkActions
            placeholder={isPendingLogs ? 'Loading logs…' : 'All Logs'}
            renderValue={(value) =>
              multiSelectFilterTriggerLabel('Logs', selectedFilters, normalizeDropdownValue(value))
            }
            className="logs-viewer-selector-dropdown"
          />
        </div>
      )}
      <LogTextFilter
        inputRef={filterInputRef}
        value={textFilter}
        dispatch={dispatch}
        title="Filter logs by text (searches in log lines, pods, and containers)"
      />
      <IconBar items={iconItems} />
      <LogBufferFullIndicator shown={bufferFullShown} />
      <LogMatchCount count={matchCount} filtered={hasActiveResultFilter} />
    </div>
  </div>
);

type LogViewerReadyViewProps = {
  controls: React.ReactNode;
  activeFilterChips: ActiveFilterChip[];
  clearAllFilters: () => void;
  visibleLogWarnings: string[];
  logsContentRef: React.RefObject<HTMLElement | null>;
  renderedLogContent: React.ReactNode;
  isParsedView: boolean;
  isTailFollowing: boolean;
  resumeScrolling: () => void;
  isSettingsOpen: boolean;
  closeSettings: () => void;
};

export const LogViewerReadyView = ({
  controls,
  activeFilterChips,
  clearAllFilters,
  visibleLogWarnings,
  logsContentRef,
  renderedLogContent,
  isParsedView,
  isTailFollowing,
  resumeScrolling,
  isSettingsOpen,
  closeSettings,
}: LogViewerReadyViewProps) => (
  <>
    <div className="object-panel-tab-content">
      <div className="logs-viewer-display">
        {controls}
        <ActiveFilterChips
          ariaLabel="Active log filters"
          chips={activeFilterChips}
          onClearAll={clearAllFilters}
          className="logs-viewer-active-filters"
        />
        <LogWarningBar warnings={visibleLogWarnings} />
        <div className="logs-viewer-content-frame">
          <ScrollableRegion
            className="logs-viewer-content selectable"
            ref={logsContentRef}
            aria-label="Log output"
            tabIndex={isParsedView ? -1 : 0}
          >
            {renderedLogContent}
          </ScrollableRegion>
          {!isTailFollowing && (
            <button
              type="button"
              className="logs-viewer-resume-scrolling"
              aria-label="Resume scrolling"
              onClick={resumeScrolling}
            >
              Resume scrolling
            </button>
          )}
        </div>
      </div>
    </div>
    <ObjPanelLogsSettingsModal isOpen={isSettingsOpen} onClose={closeSettings} />
  </>
);
