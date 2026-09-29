import { Dropdown, type DropdownOption } from '@shared/components/dropdowns/Dropdown';
import { ErrorSurface } from '@shared/components/errors/ErrorSurface';
import IconBar from '@shared/components/IconBar/IconBar';
import ScrollableRegion from '@shared/components/ScrollableRegion';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable';
import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { containsAnsi } from '../Logs/ansi';
import {
  initialLogOptionsState,
  logOptionsReducer,
  type ParsedLogEntry,
} from '../Logs/logOptionsReducer';
import { findLogOverlap } from '../Logs/logOverlap';
import { buildLogSearchRegex } from '../Logs/logSearch';
import { buildLogToolbarItems, LogTextFilter } from '../Logs/logToolbar';
import {
  getLogViewerScrollPosition,
  setLogViewerScrollPosition,
} from '../Logs/logViewerPrefsCache';
import { formatRawOrPrettyJsonLine } from '../Logs/parsedLogUtils';
import type { CapabilityState } from '../types';
import { fetchNodeLogs, type NodeLogFetchResponse, type NodeLogSource } from './nodeLogsApi';
import '../Logs/LogViewer.css';
import './NodeLogsTab.css';
import { errorHandler } from '@utils/errorHandler';
import { useLogCopyAction, useLogSelectionCopy } from '../Logs/hooks/useLogCopyAction';
import { useLogKeyboardShortcuts } from '../Logs/hooks/useLogKeyboardShortcuts';
import { useLogMessageRenderer } from '../Logs/hooks/useLogMessageRenderer';
import {
  logCopyText,
  splitDisplayRows,
  useLogPresentation,
  useRawViewFallback,
} from '../Logs/hooks/useLogPresentation';
import { useLogScrollRestoration } from '../Logs/hooks/useLogScrollRestoration';
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

const resolveNodeLogBatch = (
  batch: NodeLogFetchBatch,
  existingContent: string,
  clusterId: string
): NodeLogBatchResolution | null => {
  if (!batch.response) {
    return null;
  }
  const responseError = nodeLogResponseError(batch.response, clusterId);
  if (responseError) {
    return { status: 'error', message: responseError };
  }
  const incomingContent = batch.response.content ?? '';
  const content =
    batch.appendMode && existingContent
      ? appendNodeLogContent(existingContent, incomingContent)
      : incomingContent;
  return {
    status: 'success',
    content,
    truncated: Boolean(batch.response.truncated),
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
  const loadedSourcePathRef = useRef<string | null>(null);
  const lastSuccessfulFetchAtRef = useRef<string | null>(null);
  const previousSourcePathRef = useRef<string | null>(null);

  useEffect(() => {
    contentRef.current = content;
  }, [content]);

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
        const resolution = resolveNodeLogBatch(batch, contentRef.current, clusterId);
        if (!resolution) {
          return;
        }
        if (resolution.status === 'error') {
          setError(resolution.message);
          setContent((current) => (plan.sourceChanged ? '' : current));
          setTruncated(false);
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
        setTruncated(false);
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

const getNodeLogCountLabel = (hasSelectedSource: boolean, displayedLogCount: number): string => {
  if (!hasSelectedSource) {
    return 'Select a log source';
  }
  const suffix = displayedLogCount === 1 ? '' : 's';
  return `${displayedLogCount} matching log${suffix}`;
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
        <div className="logs-viewer-display">
          <div className="logs-viewer-content">
            <div className="logs-viewer-display-loading">
              Checking if logs are available for this node...
            </div>
          </div>
        </div>
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

type NodeLogContentProps = {
  error: string | null;
  hasSelectedSource: boolean;
  loading: boolean;
  hasLoadedContent: boolean;
  hasInvalidRegex: boolean;
  hasFilteredLines: boolean;
  hasContent: boolean;
  isParsedView: boolean;
  canParseLogs: boolean;
  renderedDisplayRows: RenderedLogRow[];
  logsContentRef: React.RefObject<HTMLElement | null>;
  wrapText: boolean;
  renderMessageContent: (message: string, keyPrefix: string) => React.ReactNode;
  parsedLogs: ParsedLogEntry[];
  tableColumns: GridColumnDefinition<ParsedLogEntry>[];
  expandedRows: Set<string>;
  onToggleParsedRow: (rowKey: string) => void;
};

const NodeLogContent = ({
  error,
  hasSelectedSource,
  loading,
  hasLoadedContent,
  hasInvalidRegex,
  hasFilteredLines,
  hasContent,
  isParsedView,
  canParseLogs,
  renderedDisplayRows,
  logsContentRef,
  wrapText,
  renderMessageContent,
  parsedLogs,
  tableColumns,
  expandedRows,
  onToggleParsedRow,
}: NodeLogContentProps) => {
  if (error) {
    return (
      <div className="logs-viewer-display-error">
        <ErrorSurface kind="reported" message={error} />
      </div>
    );
  }
  if (!hasSelectedSource) {
    return <div className="logs-viewer-display-loading">Select a log source to view logs.</div>;
  }
  if (loading && !hasLoadedContent) {
    return <div className="logs-viewer-display-loading">Loading logs…</div>;
  }
  if (hasInvalidRegex) {
    return <div className="logs-viewer-display-error">Enter a valid regular expression.</div>;
  }
  if (!hasFilteredLines) {
    const message = hasContent
      ? 'No log lines match the current filter.'
      : 'No logs returned for this source.';
    return <div className="logs-viewer-display-loading">{message}</div>;
  }
  if (!isParsedView) {
    return (
      <RawLogViewer
        rows={renderedDisplayRows}
        scrollContainerRef={logsContentRef}
        wrapText={wrapText}
        renderRow={(row, index) => (
          <div className="log-viewer-line">
            {renderMessageContent(row.line, `node-log-line-${index}`)}
          </div>
        )}
      />
    );
  }
  if (!canParseLogs) {
    return (
      <div className="logs-viewer-display-loading">No JSON log lines match the current filter.</div>
    );
  }
  return (
    <ParsedLogTable
      rows={parsedLogs}
      columns={tableColumns}
      expandedRows={expandedRows}
      onToggleRow={onToggleParsedRow}
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
  const {
    textFilter,
    autoRefresh,
    wrapText,
    showAnsiColors,
    highlightMatches,
    inverseMatches,
    caseSensitiveMatches,
    regexMatches,
    displayMode,
    expandedRows,
  } = options;
  const logsContentRef = useRef<HTMLElement>(null);
  const filterInputRef = useRef<HTMLInputElement>(null);
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
    filterText,
    filteredEntries: filteredLines,
    hasVisibleLines,
    canParseLogs,
    hasInvalidRegex,
    parsedRows,
    tableColumns,
    parsedCsv,
  } = useLogPresentation({
    entries: lines,
    options,
    searchTexts: nodeLogSearchTexts,
    lineOf: nodeLogLine,
  });
  const highlightRegex = useMemo(
    () =>
      highlightMatches && !inverseMatches
        ? buildLogSearchRegex(filterText, {
            regexMode: regexMatches,
            caseSensitive: caseSensitiveMatches,
            global: true,
          })
        : null,
    [caseSensitiveMatches, filterText, highlightMatches, inverseMatches, regexMatches]
  );
  const isParsedView = displayMode === 'parsed';

  useRawViewFallback({ displayMode, hasVisibleLines, canParseLogs, dispatch });

  const displayLines = useMemo(
    () =>
      filteredLines.map((line) => {
        return formatRawOrPrettyJsonLine(line, displayMode, showAnsiColors);
      }),
    [displayMode, filteredLines, showAnsiColors]
  );

  const renderedDisplayRows = useMemo<RenderedLogRow[]>(
    () =>
      splitDisplayRows(displayLines, (index) => `${selectedSource?.path ?? 'node-log'}-${index}`),
    [displayLines, selectedSource?.path]
  );

  const displayedText = useMemo(
    () => logCopyText(displayMode, displayLines, parsedCsv),
    [displayLines, displayMode, parsedCsv]
  );
  const hasAnsiLogEntries = useMemo(
    () => filteredLines.some((line) => containsAnsi(line)),
    [filteredLines]
  );
  const hasLoadedContent = content.length > 0;
  const hasCopyableContent = displayedText.length > 0;
  const displayedLogCount = isParsedView
    ? parsedRows.length
    : filteredLines.filter((line) => line.length > 0).length;
  const countLabel = getNodeLogCountLabel(Boolean(selectedSource), displayedLogCount);
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

  const handleCopyLogs = useLogCopyAction({ text: displayedText, dispatch, source: 'NodeLogsTab' });
  useLogSelectionCopy({ rootRef: logsContentRef, active: isActive, source: 'NodeLogsTab' });
  useLogKeyboardShortcuts({
    isActive,
    options,
    hasAnsiLogEntries,
    hasCopyableContent,
    canParseLogs,
    dispatch,
    copyLogs: handleCopyLogs,
    filterInputRef,
    logsContentRef,
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
    hasCopyableContent,
    copyLogs: handleCopyLogs,
  });

  return (
    <div className="object-panel-tab-content">
      <div className="logs-viewer-display">
        <div className="logs-viewer-controls">
          <div className="logs-viewer-controls-left">
            <div className="logs-viewer-control-group">
              <Dropdown
                options={sourceOptions}
                value={selectedSource?.path ?? ''}
                onChange={(value) =>
                  setSelectedSourcePath(Array.isArray(value) ? (value[0] ?? '') : value)
                }
                placeholder={loading ? 'Loading logs…' : 'Select log source'}
                className="logs-viewer-selector-dropdown"
                ariaLabel="Node log source"
                renderValue={() =>
                  selectedSource
                    ? getNodeLogSourceLeafLabel(selectedSource.label)
                    : 'Select log source'
                }
              />
            </div>

            <LogTextFilter
              inputRef={filterInputRef}
              value={textFilter}
              dispatch={dispatch}
              ariaLabel="Filter node logs"
            />

            <IconBar items={iconItems} />

            <span
              className="logs-viewer-count"
              role="status"
              aria-label="Selected node log source"
              title={selectedSource?.path || '/'}
            >
              {countLabel}
            </span>
          </div>
        </div>

        {truncated && !error && (
          <div className="logs-viewer-warning-bar">
            Showing only the most recent {Math.floor(NODE_LOG_TAIL_BYTES / 1024)} KB for
            responsiveness.
          </div>
        )}

        <ScrollableRegion
          ref={logsContentRef}
          className="logs-viewer-content selectable"
          aria-label="Log output"
          tabIndex={isParsedView ? -1 : 0}
        >
          <NodeLogContent
            error={error}
            hasSelectedSource={Boolean(selectedSource)}
            loading={loading}
            hasLoadedContent={hasLoadedContent}
            hasInvalidRegex={hasInvalidRegex}
            hasFilteredLines={filteredLines.length > 0}
            hasContent={content.length > 0}
            isParsedView={isParsedView}
            canParseLogs={canParseLogs}
            renderedDisplayRows={renderedDisplayRows}
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
