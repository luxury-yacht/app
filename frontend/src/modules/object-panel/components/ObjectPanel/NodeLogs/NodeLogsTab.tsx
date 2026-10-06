import ActiveFilterChips from '@shared/components/ActiveFilterChips';
import { Dropdown, type DropdownOption } from '@shared/components/dropdowns/Dropdown';
import { ErrorSurface } from '@shared/components/errors/ErrorSurface';
import IconBar from '@shared/components/IconBar/IconBar';
import LoadingSpinner from '@shared/components/LoadingSpinner';
import ScrollableRegion from '@shared/components/ScrollableRegion';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable';
import {
  startTransition,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { containsAnsi } from '../Logs/ansi';
import { LogBufferFullIndicator, LogErrorState, LogWarningBar } from '../Logs/LogStatus';
import {
  initialLogOptionsState,
  logOptionsReducer,
  type ParsedLogEntry,
} from '../Logs/logOptionsReducer';
import { findLogOverlap } from '../Logs/logOverlap';
import { buildLogSearchChips, clearLogSearch } from '../Logs/logSearchChips';
import { buildLogToolbarItems, LogSearchRow, renderLogCount } from '../Logs/logToolbar';
import {
  getLogViewerScrollPosition,
  setLogViewerScrollPosition,
} from '../Logs/logViewerPrefsCache';
import { formatRawOrPrettyJsonLine } from '../Logs/parsedLogUtils';
import type { CapabilityState } from '../types';
import { fetchNodeLogs, type NodeLogFetchResponse, type NodeLogSource } from './nodeLogsApi';
import '../Logs/LogViewer.css';
import './NodeLogsTab.css';
import { useLogDownloadMenu } from '@shared/hooks/useLogDownloadMenu';
import { errorHandler } from '@utils/errorHandler';
import { eventBus } from '@/core/events';
import { getObjPanelLogsBufferMaxSize } from '@/core/settings/appPreferences';
import { useLogKeyboardShortcuts } from '../Logs/hooks/useLogKeyboardShortcuts';
import { useLogMessageRenderer } from '../Logs/hooks/useLogMessageRenderer';
import {
  logCopyText,
  splitDisplayRows,
  useLogPresentation,
  useRawViewFallback,
} from '../Logs/hooks/useLogPresentation';
import { useLogScrollRestoration } from '../Logs/hooks/useLogScrollRestoration';
import { useLogSelectionCopy } from '../Logs/hooks/useLogSelectionCopy';
import { useTerminalTheme } from '../Logs/hooks/useTerminalTheme';
import ParsedLogTable from '../Logs/ParsedLogTable';
import RawLogViewer, { type RenderedLogRow } from '../Logs/RawLogViewer';

const NODE_LOG_TAIL_BYTES = 256 * 1024;

const nodeLogSearchTexts = (line: string): string[] => [line];
const nodeLogLine = (line: string): string => line;
const NODE_LOG_AUTO_REFRESH_MS = 5000;
const NODE_LOG_APPEND_OVERLAP_MS = 5000;

const getNodeLogSourceLeafLabel = (label: string): string => {
  const segments = label.split(' / ');
  return segments[segments.length - 1] || label;
};

// Names a saved log file: node-<node>-<source>-logs.
const nodeLogsFileBase = (nodeName: string, source: NodeLogSource | null | undefined): string =>
  ['node', nodeName, source ? getNodeLogSourceLeafLabel(source.label) : '', 'logs']
    .filter(Boolean)
    .join('-');

const buildNodeLogSinceTime = (lastSuccessfulFetchAt: string | null): string | undefined => {
  if (!lastSuccessfulFetchAt) {
    return undefined;
  }

  const parsedTime = Date.parse(lastSuccessfulFetchAt);
  if (Number.isNaN(parsedTime)) {
    return undefined;
  }

  return new Date(Math.max(0, parsedTime - NODE_LOG_APPEND_OVERLAP_MS)).toISOString();
};

const appendNodeLogContent = (existingContent: string, incomingContent: string): string => {
  if (!existingContent) {
    return incomingContent;
  }
  if (!incomingContent) {
    return existingContent;
  }

  const existingLines = existingContent.split('\n');
  const incomingLines = incomingContent.split('\n');
  const overlap = findLogOverlap(existingLines, incomingLines, (line) => line);

  const remainingLines = incomingLines.slice(overlap);
  if (remainingLines.length === 0) {
    return existingContent;
  }

  if (existingContent.endsWith('\n')) {
    return `${existingContent}${remainingLines.join('\n')}`;
  }

  return `${existingContent}\n${remainingLines.join('\n')}`;
};

// A trailing newline ends the last line rather than starting another.
const nodeLogLineCount = (content: string): number => {
  if (!content) {
    return 0;
  }
  const lines = content.split('\n').length;
  return content.endsWith('\n') ? lines - 1 : lines;
};

// Keeps the newest `maxLines` lines, as Container Logs keeps its newest entries.
const keepRecentNodeLogLines = (
  content: string,
  maxLines: number
): { content: string; dropped: boolean } => {
  const lineCount = nodeLogLineCount(content);
  if (lineCount <= maxLines) {
    return { content, dropped: false };
  }
  const lines = content.split('\n');
  const keep = maxLines + (lines.length - lineCount);
  return { content: lines.slice(-keep).join('\n'), dropped: true };
};

const getExecutedNodeLogResponse = (
  result: Awaited<ReturnType<typeof fetchNodeLogs>>
): NodeLogFetchResponse | null => (result.status === 'executed' ? (result.data ?? null) : null);

const buildNodeLogSourceOptions = (sources: NodeLogSource[]): DropdownOption[] => {
  const grouped = new Map<string, NodeLogSource[]>();

  sources.forEach((source) => {
    const segments = source.label.split(' / ');
    const root = segments[0] ?? source.label;
    const existing = grouped.get(root) ?? [];
    existing.push(source);
    grouped.set(root, existing);
  });

  const options: DropdownOption[] = [];

  grouped.forEach((groupSources, root) => {
    const hasTreeChildren = groupSources.some((source) => source.label.includes(' / '));

    if (!hasTreeChildren && groupSources.length === 1) {
      const source = groupSources[0];
      if (source) {
        options.push({ value: source.path, label: source.label });
      }
      return;
    }

    options.push({ value: `header:${root}`, label: root, group: 'header' });

    groupSources.forEach((source) => {
      const segments = source.label.split(' / ');
      const childLabel = segments.slice(1).join(' / ') || segments[0] || source.label;
      options.push({ value: source.path, label: childLabel });
    });
  });

  return options;
};

type NodeLogRequestReason = 'user' | 'background';

type NodeLogFetchBatch = {
  appendMode: boolean;
  response: NodeLogFetchResponse | null;
};

type NodeLogBatchResolution =
  | { status: 'error'; message: string }
  | { status: 'success'; content: string; truncated: boolean };

type NodeLogFetchPlan = {
  activeSourcePath: string;
  sourceChanged: boolean;
  incrementalSinceTime: string | undefined;
  requestReason: NodeLogRequestReason;
  requestStartedAt: string;
};

const buildNodeLogFetchPlan = ({
  isActive,
  clusterId,
  nodeName,
  sourcePath,
  loadedSourcePath,
  lastSuccessfulFetchAt,
  refreshNonce,
}: {
  isActive: boolean;
  clusterId?: string | null;
  nodeName: string;
  sourcePath?: string;
  loadedSourcePath: string | null;
  lastSuccessfulFetchAt: string | null;
  refreshNonce: number;
}): NodeLogFetchPlan | null => {
  if (!isActive || !clusterId || !nodeName || !sourcePath) {
    return null;
  }
  const sourceChanged = loadedSourcePath !== sourcePath;
  return {
    activeSourcePath: sourcePath,
    sourceChanged,
    incrementalSinceTime:
      !sourceChanged && refreshNonce > 0 ? buildNodeLogSinceTime(lastSuccessfulFetchAt) : undefined,
    requestReason: sourceChanged || refreshNonce === 0 ? 'user' : 'background',
    requestStartedAt: new Date().toISOString(),
  };
};

const executeNodeLogFetch = (
  clusterId: string,
  nodeName: string,
  sourcePath: string,
  requestReason: NodeLogRequestReason,
  sinceTime?: string
) => {
  const request = { sourcePath, tailBytes: NODE_LOG_TAIL_BYTES, sinceTime };
  return requestReason === 'background'
    ? fetchNodeLogs(clusterId, nodeName, request, requestReason)
    : fetchNodeLogs(clusterId, nodeName, request);
};

const fetchNodeLogBatch = async (
  clusterId: string,
  nodeName: string,
  plan: NodeLogFetchPlan
): Promise<NodeLogFetchBatch> => {
  let appendMode = Boolean(plan.incrementalSinceTime);
  let result = await executeNodeLogFetch(
    clusterId,
    nodeName,
    plan.activeSourcePath,
    plan.requestReason,
    plan.incrementalSinceTime
  );
  let response = getExecutedNodeLogResponse(result);
  if (!response) {
    return { appendMode, response: null };
  }
  if (appendMode && (response.error || response.truncated)) {
    result = await executeNodeLogFetch(
      clusterId,
      nodeName,
      plan.activeSourcePath,
      plan.requestReason
    );
    response = getExecutedNodeLogResponse(result);
    appendMode = false;
  }
  return { appendMode, response };
};

const nodeLogResponseError = (response: NodeLogFetchResponse, clusterId: string): string | null => {
  if (!response.error) {
    return null;
  }
  return errorHandler.handleInline(new Error(response.error), {
    action: 'loadNodeLogs',
    source: 'NodeLogsTab',
    clusterId,
  }).message;
};

// `truncated` means lines of this source were dropped: by the node's size
// limit or by the buffer. Once dropped they stay dropped, so appends carry it.
const resolveNodeLogBatch = (
  batch: NodeLogFetchBatch,
  existing: { content: string; truncated: boolean },
  clusterId: string,
  maxLines: number
): NodeLogBatchResolution | null => {
  if (!batch.response) {
    return null;
  }
  const responseError = nodeLogResponseError(batch.response, clusterId);
  if (responseError) {
    return { status: 'error', message: responseError };
  }
  const incomingContent = batch.response.content ?? '';
  const appending = batch.appendMode && existing.content.length > 0;
  const kept = keepRecentNodeLogLines(
    appending ? appendNodeLogContent(existing.content, incomingContent) : incomingContent,
    maxLines
  );
  return {
    status: 'success',
    content: kept.content,
    truncated:
      Boolean(batch.response.truncated) || kept.dropped || (appending && existing.truncated),
  };
};

const useNodeLogRequest = ({
  clusterId,
  nodeName,
  isActive,
  sourcePath,
  autoRefresh,
}: {
  clusterId?: string | null;
  nodeName: string;
  isActive: boolean;
  sourcePath?: string;
  autoRefresh: boolean;
}) => {
  const [content, setContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const contentRef = useRef('');
  const truncatedRef = useRef(false);
  const loadedSourcePathRef = useRef<string | null>(null);
  const lastSuccessfulFetchAtRef = useRef<string | null>(null);
  const previousSourcePathRef = useRef<string | null>(null);

  useEffect(() => {
    contentRef.current = content;
    truncatedRef.current = truncated;
  }, [content, truncated]);

  // Shrinking the buffer setting trims at once; growing applies as lines arrive.
  useEffect(
    () =>
      eventBus.on('settings:obj-panel-logs-buffer-size', (maxLines) => {
        const kept = keepRecentNodeLogLines(contentRef.current, maxLines);
        if (kept.dropped) {
          setContent(kept.content);
          setTruncated(true);
        }
      }),
    []
  );

  useEffect(() => {
    const plan = buildNodeLogFetchPlan({
      isActive,
      clusterId,
      nodeName,
      sourcePath,
      loadedSourcePath: loadedSourcePathRef.current,
      lastSuccessfulFetchAt: lastSuccessfulFetchAtRef.current,
      refreshNonce,
    });
    if (!plan || !clusterId) {
      return;
    }

    let cancelled = false;
    if (plan.sourceChanged) {
      setContent('');
      setTruncated(false);
    }
    setLoading(true);
    setError(null);

    void fetchNodeLogBatch(clusterId, nodeName, plan)
      .then((batch) => {
        if (cancelled) {
          return;
        }
        const resolution = resolveNodeLogBatch(
          batch,
          { content: contentRef.current, truncated: truncatedRef.current },
          clusterId,
          getObjPanelLogsBufferMaxSize()
        );
        if (!resolution) {
          return;
        }
        if (resolution.status === 'error') {
          setError(resolution.message);
          setContent((current) => (plan.sourceChanged ? '' : current));
          return;
        }
        loadedSourcePathRef.current = plan.activeSourcePath;
        lastSuccessfulFetchAtRef.current = plan.requestStartedAt;
        startTransition(() => {
          setContent(resolution.content);
          setTruncated(resolution.truncated);
        });
      })
      .catch((fetchError) => {
        if (cancelled) {
          return;
        }
        const details = errorHandler.handleInline(fetchError, {
          action: 'loadNodeLogs',
          source: 'NodeLogsTab',
          clusterId,
        });
        setError(details.message || 'Failed to fetch node logs');
        if (plan.sourceChanged) {
          setContent('');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [clusterId, isActive, nodeName, refreshNonce, sourcePath]);

  useEffect(() => {
    if (!autoRefresh || !isActive || !sourcePath) {
      return;
    }
    const timerId = window.setInterval(() => {
      setRefreshNonce((value) => value + 1);
    }, NODE_LOG_AUTO_REFRESH_MS);
    return () => {
      window.clearInterval(timerId);
    };
  }, [autoRefresh, isActive, sourcePath]);

  const resetSourceTracking = useCallback((nextSourcePath: string | null): boolean => {
    if (nextSourcePath === previousSourcePathRef.current) {
      return false;
    }
    previousSourcePathRef.current = nextSourcePath;
    loadedSourcePathRef.current = null;
    lastSuccessfulFetchAtRef.current = null;
    return true;
  }, []);

  return { content, error, loading, truncated, resetSourceTracking };
};

const getNodeLogRowCount = (
  content: string,
  isParsedView: boolean,
  parsedCount: number,
  renderedCount: number
): number => {
  if (!content) {
    return 0;
  }
  return isParsedView ? parsedCount : renderedCount;
};

const NodeLogsAvailability = ({
  availability,
  hasSources,
}: {
  availability: CapabilityState;
  hasSources: boolean;
}) => {
  if (availability.pending) {
    return (
      <div className="object-panel-tab-content">
        <LoadingSpinner message="Checking if logs are available for this node..." />
      </div>
    );
  }
  if (hasSources) {
    return null;
  }
  return (
    <div className="object-panel-tab-content">
      <div className="logs-viewer-display">
        <div className="logs-viewer-content">
          <div className="logs-viewer-display-error">
            <div className="node-log-unavailable-message">
              <div>Logs are not available on this node</div>
              {availability.reason ? (
                <div>
                  Error: <ErrorSurface kind="status" message={availability.reason} />
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// The message shown as the log's only line when there is nothing else to show,
// as Container Logs shows its empty states.
const nodeLogStatusMessage = ({
  hasSelectedSource,
  hasContent,
  hasInvalidRegex,
  hasFilteredLines,
}: {
  hasSelectedSource: boolean;
  hasContent: boolean;
  hasInvalidRegex: boolean;
  hasFilteredLines: boolean;
}): string | null => {
  if (!hasSelectedSource) {
    return 'Select a log source to view logs.';
  }
  if (!hasContent) {
    return 'No logs returned for this source.';
  }
  if (hasFilteredLines) {
    return null;
  }
  // All mode keeps every line on an invalid regex, so this only shows when a
  // filtering mode has nothing left to show.
  return hasInvalidRegex
    ? 'Enter a valid regular expression.'
    : 'No log lines match the current filter.';
};

// Dropped lines show as the buffer-full indicator beside the toolbar, as in
// Container Logs; a failed refresh keeps the lines shown and reports above them.
const nodeLogNotices = ({
  content,
  truncated,
  error,
}: {
  content: string;
  truncated: boolean;
  error: string | null;
}): { warnings: string[]; bufferFullShown: number | null } => ({
  warnings: error && content ? [`Could not refresh logs: ${error}`] : [],
  bufferFullShown: truncated ? nodeLogLineCount(content) : null,
});

// Loading and failure without lines show in the log region like Container
// Logs' states, but under the toolbar: it holds the source picker, which must
// stay usable when a source cannot be read.
type NodeLogContentProps = {
  loading: boolean;
  error: string | null;
  hasContent: boolean;
  showTable: boolean;
  displayRows: RenderedLogRow[];
  logsContentRef: React.RefObject<HTMLElement | null>;
  wrapText: boolean;
  renderMessageContent: (message: string, keyPrefix: string) => React.ReactNode;
  parsedLogs: ParsedLogEntry[];
  tableColumns: GridColumnDefinition<ParsedLogEntry>[];
  expandedRows: Set<string>;
  onToggleParsedRow: (rowKey: string) => void;
};

const NodeLogContent = ({
  loading,
  error,
  hasContent,
  showTable,
  displayRows,
  logsContentRef,
  wrapText,
  renderMessageContent,
  parsedLogs,
  tableColumns,
  expandedRows,
  onToggleParsedRow,
}: NodeLogContentProps) => {
  if (loading && !hasContent) {
    return <LoadingSpinner message="Loading logs..." />;
  }
  if (error && !hasContent) {
    return <LogErrorState message={error} />;
  }
  if (showTable) {
    return (
      <ParsedLogTable
        rows={parsedLogs}
        columns={tableColumns}
        expandedRows={expandedRows}
        onToggleRow={onToggleParsedRow}
      />
    );
  }
  return (
    <RawLogViewer
      rows={displayRows}
      scrollContainerRef={logsContentRef}
      wrapText={wrapText}
      renderRow={(row, index) => (
        <div className="log-viewer-line">
          {renderMessageContent(row.line, `node-log-line-${index}`)}
        </div>
      )}
    />
  );
};

interface NodeLogsTabProps {
  panelId: string;
  nodeName: string;
  clusterId?: string | null;
  isActive: boolean;
  availability: CapabilityState;
  sources: NodeLogSource[];
}

const NodeLogsTab = ({
  panelId,
  nodeName,
  clusterId,
  isActive,
  availability,
  sources,
}: NodeLogsTabProps) => {
  const [selectedSourcePath, setSelectedSourcePath] = useState('');
  const [options, dispatch] = useReducer(logOptionsReducer, initialLogOptionsState);
  const { autoRefresh, wrapText, showAnsiColors, displayMode, expandedRows } = options;
  const logsContentRef = useRef<HTMLElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const filterInputRef = useRef<HTMLInputElement>(null);
  const searchRowId = useId();
  const terminalTheme = useTerminalTheme(logsContentRef);
  const sourceOptions = useMemo<DropdownOption[]>(
    () => buildNodeLogSourceOptions(sources),
    [sources]
  );

  useEffect(() => {
    if (sources.length === 0) {
      setSelectedSourcePath('');
      return;
    }
    if (selectedSourcePath && !sources.some((source) => source.path === selectedSourcePath)) {
      setSelectedSourcePath('');
    }
  }, [selectedSourcePath, sources]);

  const selectedSource = useMemo(
    () => sources.find((source) => source.path === selectedSourcePath) ?? null,
    [selectedSourcePath, sources]
  );

  const { content, error, loading, truncated, resetSourceTracking } = useNodeLogRequest({
    clusterId,
    nodeName,
    isActive,
    sourcePath: selectedSource?.path,
    autoRefresh,
  });

  const lines = useMemo(() => content.split('\n'), [content]);
  const {
    filteredEntries: filteredLines,
    hasVisibleLines,
    canParseLogs,
    hasInvalidRegex,
    textFilterHidesLines,
    highlightRegex,
    parsedRows,
    tableColumns,
    getParsedCsv,
    jsonOf,
  } = useLogPresentation({
    entries: lines,
    options,
    searchTexts: nodeLogSearchTexts,
    lineOf: nodeLogLine,
  });
  const isParsedView = displayMode === 'parsed';
  const { textFilter, filterMode, caseSensitiveMatches, regexMatches } = options;
  const searchChips = useMemo(
    () =>
      buildLogSearchChips({
        textFilter,
        filterMode,
        caseSensitiveMatches,
        regexMatches,
        hasInvalidRegex,
        dispatch,
      }),
    [caseSensitiveMatches, filterMode, hasInvalidRegex, regexMatches, textFilter]
  );

  useRawViewFallback({ displayMode, hasVisibleLines, canParseLogs, dispatch });

  const displayLines = useMemo(() => {
    // The Pretty view reuses each line's cached parse instead of parsing again.
    const prettyView = displayMode === 'pretty';
    return filteredLines.map((line) =>
      formatRawOrPrettyJsonLine(line, displayMode, showAnsiColors, prettyView ? jsonOf(line) : null)
    );
  }, [displayMode, filteredLines, jsonOf, showAnsiColors]);

  const hasContent = content.length > 0;
  const statusMessage = nodeLogStatusMessage({
    hasSelectedSource: Boolean(selectedSource),
    hasContent,
    hasInvalidRegex,
    hasFilteredLines: filteredLines.length > 0,
  });
  const renderedDisplayRows = useMemo<RenderedLogRow[]>(
    () =>
      statusMessage
        ? [{ key: 'status', line: statusMessage }]
        : splitDisplayRows(
            displayLines,
            (index) => `${selectedSource?.path ?? 'node-log'}-${index}`
          ),
    [displayLines, selectedSource?.path, statusMessage]
  );
  const notices = nodeLogNotices({ content, truncated, error });

  const getCopyText = useCallback(
    () => logCopyText(displayMode, () => displayLines.join('\n'), getParsedCsv),
    [displayLines, displayMode, getParsedCsv]
  );
  const hasAnsiLogEntries = useMemo(
    () => filteredLines.some((line) => containsAnsi(line)),
    [filteredLines]
  );
  // Whether the copy text would be non-empty, without building it.
  const hasCopyableContent = isParsedView
    ? parsedRows.length > 0 && tableColumns.length > 0
    : displayLines.length > 1 || Boolean(displayLines[0]);
  const displayedLogCount = isParsedView
    ? parsedRows.length
    : filteredLines.filter((line) => line.length > 0).length;
  const totalLogCount = useMemo(() => lines.filter((line) => line.length > 0).length, [lines]);
  const rowCount = getNodeLogRowCount(
    content,
    isParsedView,
    parsedRows.length,
    renderedDisplayRows.length
  );

  const { resetScrollRestoration } = useLogScrollRestoration({
    rootRef: logsContentRef,
    isActive,
    isParsedView,
    rowCount,
    tailFollowSignal: `${selectedSource?.path ?? ''}:${parsedRows.length}:${renderedDisplayRows.length}`,
    cacheKey: panelId,
    getScrollPosition: getLogViewerScrollPosition,
    setScrollPosition: setLogViewerScrollPosition,
    forceTailOnNextRestore: true,
  });

  useEffect(() => {
    const sourcePath = selectedSource?.path ?? null;
    if (!resetSourceTracking(sourcePath)) {
      return;
    }
    resetScrollRestoration({ forceTail: true });
  }, [resetScrollRestoration, resetSourceTracking, selectedSource?.path]);

  const handleToggleParsedRow = useCallback((rowKey: string) => {
    if (rowKey) {
      dispatch({ type: 'TOGGLE_ROW_EXPANSION', payload: rowKey });
    }
  }, []);

  const { downloadItem, copyLogs: handleCopyLogs } = useLogDownloadMenu({
    getText: getCopyText,
    isTableView: isParsedView,
    fileBase: nodeLogsFileBase(nodeName, selectedSource),
    source: 'NodeLogsTab',
    disabled: !hasCopyableContent,
    copyShortcut: 'Shift+C',
  });
  useLogSelectionCopy({ rootRef: logsContentRef, active: isActive, source: 'NodeLogsTab' });
  useLogKeyboardShortcuts({
    isActive,
    options,
    hasAnsiLogEntries,
    hasCopyableContent,
    hasLogs: totalLogCount > 0,
    canParseLogs,
    dispatch,
    copyLogs: handleCopyLogs,
    filterInputRef,
    logsContentRef,
    viewerRef,
    searchRowId,
  });

  const renderMessageContent = useLogMessageRenderer({
    highlightRegex,
    showAnsiColors,
    terminalTheme,
    plainSegmentWrapper: 'span',
  });

  if (availability.pending || sources.length === 0) {
    return <NodeLogsAvailability availability={availability} hasSources={sources.length > 0} />;
  }

  const iconItems = buildLogToolbarItems({
    options,
    dispatch,
    hasAnsiLogEntries,
    canParseLogs,
    hasLogs: totalLogCount > 0,
    downloadItem,
    filterInputRef,
    searchRowId,
  });

  return (
    <div className="object-panel-tab-content">
      <div className="logs-viewer-display" ref={viewerRef}>
        <div className="logs-viewer-controls">
          <div className="logs-viewer-controls-left">
            <LogBufferFullIndicator shown={notices.bufferFullShown} />
            <div className="logs-viewer-control-group">
              <Dropdown
                options={sourceOptions}
                value={selectedSource?.path ?? ''}
                onChange={(value) =>
                  setSelectedSourcePath(Array.isArray(value) ? (value[0] ?? '') : value)
                }
                placeholder={loading ? 'Loading logs…' : 'Select source'}
                ariaLabel="Node log source"
                renderValue={() =>
                  selectedSource ? getNodeLogSourceLeafLabel(selectedSource.label) : 'Select source'
                }
              />
            </div>

            <IconBar items={iconItems} />
          </div>
          {options.searchOpen ? (
            <LogSearchRow
              id={searchRowId}
              inputRef={filterInputRef}
              options={options}
              dispatch={dispatch}
              ariaLabel="Filter node logs"
            />
          ) : null}
        </div>

        <ActiveFilterChips
          ariaLabel="Active log filters"
          chips={searchChips}
          onClearAll={() => clearLogSearch(dispatch, { caseSensitiveMatches, regexMatches })}
          className="logs-viewer-active-filters"
          summary={renderLogCount(displayedLogCount, totalLogCount, textFilterHidesLines)}
        />
        <LogWarningBar warnings={notices.warnings} />

        <ScrollableRegion
          ref={logsContentRef}
          className="logs-viewer-content selectable"
          aria-label="Log output"
          tabIndex={isParsedView ? -1 : 0}
        >
          <NodeLogContent
            loading={loading}
            error={error}
            hasContent={hasContent}
            showTable={isParsedView && !statusMessage}
            displayRows={renderedDisplayRows}
            logsContentRef={logsContentRef}
            wrapText={wrapText}
            renderMessageContent={renderMessageContent}
            parsedLogs={parsedRows}
            tableColumns={tableColumns}
            expandedRows={expandedRows}
            onToggleParsedRow={handleToggleParsedRow}
          />
        </ScrollableRegion>
      </div>
    </div>
  );
};

export default NodeLogsTab;
