/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Logs/LogViewerLayout.tsx
 *
 * Container Logs layout: the controls row, the log region with its warnings and
 * filter chips, and the loading, paused and error states that replace it.
 */

import ActiveFilterChips, { type ActiveFilterChip } from '@shared/components/ActiveFilterChips';
import ClusterDataPausedState from '@shared/components/ClusterDataPausedState';
import { Dropdown, type DropdownOption } from '@shared/components/dropdowns/Dropdown';
import {
  DropdownFilterOption,
  dropdownFilterOptionState,
} from '@shared/components/dropdowns/Dropdown/DropdownFilterOption';
import { normalizeDropdownValue } from '@shared/components/dropdowns/dropdownValue';
import {
  filterSelectionFromDropdownValues,
  filterSelectionToDropdownValues,
  type MultiSelectFilterSelection,
  multiSelectFilterTriggerLabel,
} from '@shared/components/dropdowns/multiSelectFilterSelection';
import IconBar, { type IconBarItem } from '@shared/components/IconBar/IconBar';
import LoadingSpinner from '@shared/components/LoadingSpinner';
import LogResumeScrollingButton from '@shared/components/logs/LogResumeScrollingButton';
import LogTable from '@shared/components/logs/LogTable';
import ScrollableRegion from '@shared/components/ScrollableRegion';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable';
import type React from 'react';
import type { ContainerLogRow } from './containerLogRows';
import { LogBufferFullIndicator, LogErrorState, LogWarningBar } from './LogStatus';
import {
  type LogSourceGroup,
  logFilterSelectionWithGroupValues,
  logSourceGroupLabel,
  logSourceGroupValues,
} from './logFilterSelection';
import type { LogOptionsState, ParsedLogEntry } from './logOptionsReducer';
import { LogSearchRow } from './logToolbar';
import type { LogViewerAction } from './logViewerReducer';
import { getParsedLogRowKey } from './parsedLogUtils';
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
      <LogTable
        rows={parsedLogs}
        columns={tableColumns}
        keyExtractor={getParsedLogRowKey}
        expandedRows={expandedRows}
        onToggleRow={onToggleParsedRow}
        className="parsed-logs-table"
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

// Loading, paused and a failure before any line arrives show in the log region,
// below the controls: Previous Logs, the auto-refresh retry and the filters
// must stay usable (a user may be allowed previous logs but not live logs).
export const renderLogViewerStatus = ({
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
    return <LoadingSpinner message={loadingMessage} />;
  }
  if (paused) {
    return (
      <div className="logs-viewer-display-empty">
        <ClusterDataPausedState />
      </div>
    );
  }
  if (displayError && !hasEntries) {
    return <LogErrorState message={displayError} retryHint={retryHint} />;
  }
  return null;
};

type LogSourceDropdownProps = {
  label: string;
  group: LogSourceGroup;
  // The group's own options, shown in this dropdown.
  options: DropdownOption[];
  // Both groups' options, which the selection is encoded against.
  allOptions: DropdownOption[];
  selectedFilters: MultiSelectFilterSelection;
  dispatch: React.Dispatch<LogViewerAction>;
};

// One group of log sources, Pods or Containers; changing it keeps the other
// group's choice.
const LogSourceDropdown = ({
  label,
  group,
  options,
  allOptions,
  selectedFilters,
  dispatch,
}: LogSourceDropdownProps) => (
  <Dropdown
    options={options}
    value={logSourceGroupValues(selectedFilters, allOptions, group)}
    onChange={(value) =>
      dispatch({
        type: 'SET_SELECTED_FILTERS',
        payload: logFilterSelectionWithGroupValues(
          selectedFilters,
          allOptions,
          group,
          normalizeDropdownValue(value)
        ),
      })
    }
    multiple
    showBulkActions
    ariaLabel={label}
    renderValue={(value) =>
      logSourceGroupLabel(label, selectedFilters, group, normalizeDropdownValue(value))
    }
  />
);

type LogLevelDropdownProps = {
  options: DropdownOption[];
  levelFilter: MultiSelectFilterSelection;
  showLevelMarkers: boolean;
  dispatch: React.Dispatch<LogViewerAction>;
};

// Turns the level markers on warning and error lines on or off; it sits with the
// menu's All and None actions and keeps the menu open.
const LevelMarkersToggle = ({
  showLevelMarkers,
  dispatch,
}: Pick<LogLevelDropdownProps, 'showLevelMarkers' | 'dispatch'>) => (
  <button
    type="button"
    className="dropdown-bulk-action dropdown-bulk-action--labeled icon-bar-button"
    aria-pressed={showLevelMarkers}
    aria-label="Show level markers"
    title="Mark warning and error lines at their left edge"
    onClick={(event) => {
      event.stopPropagation();
      dispatch({ type: 'TOGGLE_LEVEL_MARKERS' });
    }}
  >
    {/* The label takes the All/None label size; the box is the menu's own checkbox. */}
    <DropdownFilterOption
      label={<span className="dropdown-bulk-action-label">Markers</span>}
      state={dropdownFilterOptionState(showLevelMarkers)}
    />
  </button>
);

// The levels the shown logs hold; a frontend filter like the text filter. Same
// control as the Application Logs level filter.
const LogLevelDropdown = ({
  options,
  levelFilter,
  showLevelMarkers,
  dispatch,
}: LogLevelDropdownProps) => (
  <Dropdown
    options={options}
    value={filterSelectionToDropdownValues(levelFilter, options)}
    onChange={(value) =>
      dispatch({
        type: 'SET_LEVEL_FILTER',
        payload: filterSelectionFromDropdownValues(normalizeDropdownValue(value), options),
      })
    }
    multiple
    showBulkActions
    additionalBulkActions={
      <LevelMarkersToggle showLevelMarkers={showLevelMarkers} dispatch={dispatch} />
    }
    ariaLabel="Log Levels"
    renderValue={(value) =>
      multiSelectFilterTriggerLabel('Log Levels', levelFilter, normalizeDropdownValue(value))
    }
  />
);

type LogViewerControlsProps = {
  activeFilterChips: ActiveFilterChip[];
  podOptions: DropdownOption[];
  containerOptions: DropdownOption[];
  selectedFilters: MultiSelectFilterSelection;
  levelOptions: DropdownOption[];
  filterInputRef: React.RefObject<HTMLInputElement | null>;
  searchRowId: string;
  searchOptions: LogOptionsState;
  iconItems: IconBarItem[];
  bufferFullShown: number | null;
  dispatch: React.Dispatch<LogViewerAction>;
};

export const LogViewerControls = ({
  activeFilterChips,
  podOptions,
  containerOptions,
  selectedFilters,
  levelOptions,
  filterInputRef,
  searchRowId,
  searchOptions,
  iconItems,
  bufferFullShown,
  dispatch,
}: LogViewerControlsProps) => {
  const allOptions = [...podOptions, ...containerOptions];
  return (
    <div
      className={`logs-viewer-controls${activeFilterChips.length > 0 ? ' logs-viewer-controls--with-active-filters' : ''}`}
    >
      <div className="logs-viewer-controls-left">
        <LogBufferFullIndicator shown={bufferFullShown} />
        {(podOptions.length > 0 || containerOptions.length > 0 || levelOptions.length > 0) && (
          <div className="logs-viewer-control-group">
            {podOptions.length > 0 && (
              <LogSourceDropdown
                label="Pods"
                group="pods"
                options={podOptions}
                allOptions={allOptions}
                selectedFilters={selectedFilters}
                dispatch={dispatch}
              />
            )}
            {containerOptions.length > 0 && (
              <LogSourceDropdown
                label="Containers"
                group="containers"
                options={containerOptions}
                allOptions={allOptions}
                selectedFilters={selectedFilters}
                dispatch={dispatch}
              />
            )}
            {levelOptions.length > 0 && (
              <LogLevelDropdown
                options={levelOptions}
                levelFilter={searchOptions.levelFilter}
                showLevelMarkers={searchOptions.showLevelMarkers}
                dispatch={dispatch}
              />
            )}
          </div>
        )}
        <IconBar items={iconItems} />
      </div>
      {searchOptions.searchOpen ? (
        <LogSearchRow
          id={searchRowId}
          inputRef={filterInputRef}
          options={searchOptions}
          dispatch={dispatch}
          title="Filter logs by text (searches in log lines, pods, and containers)"
        />
      ) : null}
    </div>
  );
};

type LogViewerReadyViewProps = {
  viewerRef: React.RefObject<HTMLDivElement | null>;
  controls: React.ReactNode;
  activeFilterChips: ActiveFilterChip[];
  clearAllFilters: () => void;
  /** Shown beside the Clear all button: the shown/total log count. */
  logCount: React.ReactNode;
  visibleLogWarnings: string[];
  logsContentRef: React.RefObject<HTMLElement | null>;
  renderedLogContent: React.ReactNode;
  isParsedView: boolean;
  /** Raw rows may show level markers, so every row leaves room at its left edge. */
  showLevelMarkers: boolean;
  isTailFollowing: boolean;
  resumeScrolling: () => void;
};

export const LogViewerReadyView = ({
  viewerRef,
  controls,
  activeFilterChips,
  clearAllFilters,
  logCount,
  visibleLogWarnings,
  logsContentRef,
  renderedLogContent,
  isParsedView,
  showLevelMarkers,
  isTailFollowing,
  resumeScrolling,
}: LogViewerReadyViewProps) => (
  <div className="object-panel-tab-content">
    <div className="logs-viewer-display" ref={viewerRef}>
      {controls}
      <ActiveFilterChips
        ariaLabel="Active log filters"
        chips={activeFilterChips}
        onClearAll={clearAllFilters}
        className="logs-viewer-active-filters"
        summary={logCount}
      />
      <LogWarningBar warnings={visibleLogWarnings} />
      <div className="logs-viewer-content-frame">
        <ScrollableRegion
          className={`logs-viewer-content selectable${showLevelMarkers ? ' logs-viewer-content--level-markers' : ''}`}
          ref={logsContentRef}
          aria-label="Log output"
          tabIndex={isParsedView ? -1 : 0}
        >
          {renderedLogContent}
        </ScrollableRegion>
        {!isTailFollowing && <LogResumeScrollingButton onResume={resumeScrolling} />}
      </div>
    </div>
  </div>
);
