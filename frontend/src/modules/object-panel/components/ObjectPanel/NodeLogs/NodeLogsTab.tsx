import { Dropdown, type DropdownOption } from '@shared/components/dropdowns/Dropdown';
import { ErrorSurface } from '@shared/components/errors/ErrorSurface';
import IconBar, { type IconBarItem } from '@shared/components/IconBar/IconBar';
import {
  AnsiColorIcon,
  AutoRefreshIcon,
  CopyIcon,
  HighlightSearchIcon,
  InverseSearchIcon,
  ParseJsonIcon,
  PrettyJsonIcon,
  RegexSearchIcon,
  WrapTextIcon,
} from '@shared/components/icons/LogIcons';
import { CaseSensitiveIcon } from '@shared/components/icons/SharedIcons';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable';
import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { containsAnsi, stripAnsi } from '../Logs/ansi';
import { buildCsv } from '../Logs/logExport';
import { buildLogSearchRegex } from '../Logs/logSearch';
import { getLogViewerScrollTop, setLogViewerScrollTop } from '../Logs/logViewerPrefsCache';
import type { ParsedLogEntry } from '../Logs/logViewerReducer';
import { buildParsedLogDataColumns } from '../Logs/parsedLogColumns';
import {
  deriveParsedLogFieldKeys,
  formatParsedValue,
  formatRawOrPrettyJsonLine,
  tryParseJSONObject,
} from '../Logs/parsedLogUtils';
import type { CapabilityState, LogDisplayMode } from '../types';
import { fetchNodeLogs, type NodeLogFetchResponse, type NodeLogSource } from './nodeLogsApi';
import '../Logs/LogViewer.css';
import './NodeLogsTab.css';
import { useKeyboardSurface } from '@ui/shortcuts';
import { errorHandler } from '@utils/errorHandler';
import { useLogMessageRenderer } from '../Logs/hooks/useLogMessageRenderer';
import { useLogScrollRestoration } from '../Logs/hooks/useLogScrollRestoration';
import { useTerminalTheme } from '../Logs/hooks/useTerminalTheme';
import ParsedLogTable from '../Logs/ParsedLogTable';
import RawLogViewer, { type RenderedLogRow } from '../Logs/RawLogViewer';
import { getSelectedTextWithinRoot, selectAllTextWithinRoot } from '../Logs/textSelection';

const NODE_LOG_TAIL_BYTES = 256 * 1024;
const NODE_LOG_AUTO_REFRESH_MS = 5000;
const NODE_LOG_APPEND_OVERLAP_MS = 5000;

type CopyFeedback = 'idle' | 'copied' | 'error';

type NodeLogSourceOptionMetadata =
  | { kind: 'header' }
  | {
      kind: 'child';
      childLabel: string;
      isLastChild: boolean;
    };

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
  const maxOverlap = Math.min(existingLines.length, incomingLines.length);

  let overlap = 0;
  for (let candidate = maxOverlap; candidate > 0; candidate -= 1) {
    let matches = true;
    for (let index = 0; index < candidate; index += 1) {
      if (existingLines[existingLines.length - candidate + index] !== incomingLines[index]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      overlap = candidate;
      break;
    }
  }

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
  result: Awaited<ReturnType<typeof fetchNodeLogs>> | NodeLogFetchResponse
): NodeLogFetchResponse | null => {
  if ('status' in result) {
    return result.status === 'executed' ? (result.data ?? null) : null;
  }
  return result;
};

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

    options.push({
      value: `header:${root}`,
      label: root,
      group: 'header',
      metadata: { kind: 'header' } satisfies NodeLogSourceOptionMetadata,
    });

    groupSources.forEach((source, index) => {
      const segments = source.label.split(' / ');
      const childLabel = segments.slice(1).join(' / ') || segments[0] || source.label;
      options.push({
        value: source.path,
        label: childLabel,
        metadata: {
          kind: 'child',
          childLabel,
          isLastChild: index === groupSources.length - 1,
        } satisfies NodeLogSourceOptionMetadata,
      });
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

const getCopyIconFeedback = (copyFeedback: CopyFeedback): 'success' | 'error' | null => {
  if (copyFeedback === 'copied') {
    return 'success';
  }
  return copyFeedback === 'error' ? 'error' : null;
};

const renderNodeLogSourceOption = (option: DropdownOption): React.ReactNode => {
  if (option.group === 'header') {
    return <span className="node-log-source-header">{option.label}</span>;
  }
  const metadata = option.metadata as NodeLogSourceOptionMetadata | undefined;
  if (metadata?.kind !== 'child') {
    return <span className="node-log-source-label">{option.label}</span>;
  }
  const className = [
    'node-log-source-label',
    'node-log-source-child',
    metadata.isLastChild && 'node-log-source-child-last',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <span className={className}>
      <span className="node-log-source-child-text">{metadata.childLabel}</span>
    </span>
  );
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
  logsContentRef: React.RefObject<HTMLDivElement | null>;
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

type NodeLogIconItemsOptions = {
  highlightMatches: boolean;
  inverseMatches: boolean;
  caseSensitiveMatches: boolean;
  regexMatches: boolean;
  autoRefresh: boolean;
  wrapText: boolean;
  hasAnsiLogEntries: boolean;
  showAnsiColors: boolean;
  canParseLogs: boolean;
  displayMode: LogDisplayMode;
  isParsedView: boolean;
  hasCopyableContent: boolean;
  copyIconFeedback: 'success' | 'error' | null;
  toggleHighlightMatches: () => void;
  toggleInverseMatches: () => void;
  toggleCaseSensitiveMatches: () => void;
  toggleRegexMatches: () => void;
  toggleAutoRefresh: () => void;
  toggleWrapText: () => void;
  toggleAnsiColors: () => void;
  togglePrettyJson: () => void;
  toggleParsedJson: () => void;
  copyLogs: () => void;
};

const buildNodeLogIconItems = (options: NodeLogIconItemsOptions): IconBarItem[] => {
  const items: IconBarItem[] = [
    {
      type: 'toggle',
      id: 'highlightSearch',
      icon: <HighlightSearchIcon width={16} height={16} />,
      active: options.highlightMatches,
      onClick: options.toggleHighlightMatches,
      title: 'Highlight matching text - disabled when Invert is enabled',
      ariaLabel: 'Highlight matching text - disabled when Invert is enabled',
      disabled: options.inverseMatches,
    },
    {
      type: 'toggle',
      id: 'inverseSearch',
      icon: <InverseSearchIcon width={16} height={16} />,
      active: options.inverseMatches,
      onClick: options.toggleInverseMatches,
      title: 'Invert the text filter to show only non-matching logs',
      ariaLabel: 'Invert the text filter to show only non-matching logs',
    },
    {
      type: 'toggle',
      id: 'caseSensitiveSearch',
      icon: <CaseSensitiveIcon width={16} height={16} />,
      active: options.caseSensitiveMatches,
      onClick: options.toggleCaseSensitiveMatches,
      title: 'Case-sensitive search - disabled when regex is enabled',
      ariaLabel: 'Case-sensitive search - disabled when regex is enabled',
      disabled: options.regexMatches,
    },
    {
      type: 'toggle',
      id: 'regexSearch',
      icon: <RegexSearchIcon width={16} height={16} />,
      active: options.regexMatches,
      onClick: options.toggleRegexMatches,
      title: 'Enable regular expression support for the text filter',
      ariaLabel: 'Enable regular expression support for the text filter',
    },
    { type: 'separator' },
    {
      type: 'toggle',
      id: 'autoRefresh',
      icon: <AutoRefreshIcon width={16} height={16} />,
      active: options.autoRefresh,
      onClick: options.toggleAutoRefresh,
      title: 'Toggle auto-refresh',
      ariaLabel: 'Toggle auto-refresh',
    },
    {
      type: 'toggle',
      id: 'wrapText',
      icon: <WrapTextIcon />,
      active: options.wrapText,
      onClick: options.toggleWrapText,
      title: 'Wrap text',
      ariaLabel: 'Wrap text',
      disabled: options.isParsedView,
    },
  ];
  if (options.hasAnsiLogEntries) {
    items.push({
      type: 'toggle',
      id: 'ansiColors',
      icon: <AnsiColorIcon width={16} height={16} />,
      active: options.showAnsiColors,
      onClick: options.toggleAnsiColors,
      title: 'Show ANSI colors if present',
      ariaLabel: 'Show ANSI colors if present',
      disabled: options.isParsedView,
    });
  }
  if (options.canParseLogs) {
    items.push(
      {
        type: 'toggle',
        id: 'prettyJson',
        icon: <PrettyJsonIcon width={16} height={16} />,
        active: options.displayMode === 'pretty',
        onClick: options.togglePrettyJson,
        title: 'Show pretty JSON',
        ariaLabel: 'Show pretty JSON',
      },
      {
        type: 'toggle',
        id: 'parsedJson',
        icon: <ParseJsonIcon width={16} height={16} />,
        active: options.isParsedView,
        onClick: options.toggleParsedJson,
        title: 'Parse the JSON into a table',
        ariaLabel: 'Parse the JSON into a table',
      }
    );
  }
  items.push(
    { type: 'separator' },
    {
      type: 'action',
      id: 'copy',
      icon: <CopyIcon width={20} height={20} />,
      onClick: options.copyLogs,
      title: 'Copy to clipboard',
      ariaLabel: 'Copy to clipboard',
      disabled: !options.hasCopyableContent,
      feedback: options.copyIconFeedback,
    }
  );
  return items;
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
  const [textFilter, setTextFilter] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [wrapText, setWrapText] = useState(true);
  const [showAnsiColors, setShowAnsiColors] = useState(true);
  const [highlightMatches, setHighlightMatches] = useState(false);
  const [inverseMatches, setInverseMatches] = useState(false);
  const [caseSensitiveMatches, setCaseSensitiveMatches] = useState(false);
  const [regexMatches, setRegexMatches] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<CopyFeedback>('idle');
  const [displayMode, setDisplayMode] = useState<LogDisplayMode>('raw');
  const [parsedLogs, setParsedLogs] = useState<ParsedLogEntry[]>([]);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(() => new Set<string>());
  const logsContentRef = useRef<HTMLDivElement>(null);
  const terminalTheme = useTerminalTheme(logsContentRef);
  const deferredTextFilter = useDeferredValue(textFilter);
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

  const filterRegex = useMemo(
    () =>
      buildLogSearchRegex(deferredTextFilter, {
        regexMode: regexMatches,
        caseSensitive: caseSensitiveMatches,
      }),
    [caseSensitiveMatches, deferredTextFilter, regexMatches]
  );
  const highlightRegex = useMemo(
    () =>
      highlightMatches && !inverseMatches
        ? buildLogSearchRegex(deferredTextFilter, {
            regexMode: regexMatches,
            caseSensitive: caseSensitiveMatches,
            global: true,
          })
        : null,
    [caseSensitiveMatches, deferredTextFilter, highlightMatches, inverseMatches, regexMatches]
  );
  const hasInvalidRegex = Boolean(regexMatches && deferredTextFilter.trim() && !filterRegex);
  const isParsedView = displayMode === 'parsed';

  const filteredLines = useMemo(() => {
    const lines = content.split('\n');
    const trimmedFilter = deferredTextFilter.trim();
    if (!trimmedFilter) {
      return lines;
    }
    if (hasInvalidRegex) {
      return [] as string[];
    }
    const normalizedFilter = caseSensitiveMatches ? trimmedFilter : trimmedFilter.toLowerCase();
    return lines.filter((line) => {
      const normalizedLine = stripAnsi(line);
      const haystack = caseSensitiveMatches ? normalizedLine : normalizedLine.toLowerCase();
      const matches = filterRegex
        ? filterRegex.test(normalizedLine)
        : haystack.includes(normalizedFilter);
      if (filterRegex) {
        filterRegex.lastIndex = 0;
      }
      return inverseMatches ? !matches : matches;
    });
  }, [
    caseSensitiveMatches,
    content,
    deferredTextFilter,
    filterRegex,
    hasInvalidRegex,
    inverseMatches,
  ]);

  const parsedCandidates = useMemo<ParsedLogEntry[]>(() => {
    if (filteredLines.length === 0) {
      return [];
    }

    return filteredLines.flatMap((line, index) => {
      const parsedData = tryParseJSONObject(line);
      if (!parsedData) {
        return [];
      }

      return [
        {
          data: parsedData,
          rawLine: stripAnsi(line),
          lineNumber: index + 1,
        },
      ];
    });
  }, [filteredLines]);

  const canParseLogs = parsedCandidates.length > 0;

  const updateDisplayMode = useCallback((nextMode: LogDisplayMode) => {
    setDisplayMode(nextMode);
    setExpandedRows(new Set<string>());
  }, []);

  useEffect(() => {
    if (displayMode !== 'raw' && !canParseLogs && filteredLines.length > 0) {
      updateDisplayMode('raw');
    }
  }, [canParseLogs, displayMode, filteredLines.length, updateDisplayMode]);

  useEffect(() => {
    if (!isParsedView) {
      setParsedLogs([]);
      return;
    }

    if (!parsedCandidates.length) {
      setParsedLogs([]);
      return;
    }

    setParsedLogs(parsedCandidates);
  }, [isParsedView, parsedCandidates]);

  const derivedFieldKeys = useMemo(() => deriveParsedLogFieldKeys(parsedLogs), [parsedLogs]);

  const tableColumns = useMemo(() => {
    if (derivedFieldKeys.length === 0) {
      return [] as GridColumnDefinition<ParsedLogEntry>[];
    }
    return buildParsedLogDataColumns(derivedFieldKeys);
  }, [derivedFieldKeys]);

  const displayLines = useMemo(
    () =>
      filteredLines.map((line) => {
        return formatRawOrPrettyJsonLine(line, displayMode, showAnsiColors);
      }),
    [displayMode, filteredLines, showAnsiColors]
  );

  const renderedDisplayRows = useMemo<RenderedLogRow[]>(
    () =>
      displayLines.flatMap((line, index) =>
        line.split('\n').map((segment, segmentIndex) => ({
          key: `${selectedSource?.path ?? 'node-log'}-${index}-${segmentIndex}`,
          line: segment,
        }))
      ),
    [displayLines, selectedSource?.path]
  );

  const parsedCsv = useMemo(() => {
    if (!isParsedView || parsedLogs.length === 0 || tableColumns.length === 0) {
      return '';
    }

    const headerRow = tableColumns.map((column) =>
      typeof column.header === 'string' ? column.header : column.key
    );
    const dataRows = parsedLogs.map((entry) =>
      tableColumns.map((column) => formatParsedValue(entry.data[column.key]))
    );

    return buildCsv([headerRow, ...dataRows]);
  }, [isParsedView, parsedLogs, tableColumns]);

  const displayedText = useMemo(
    () => (isParsedView ? parsedCsv : displayLines.join('\n')),
    [displayLines, isParsedView, parsedCsv]
  );
  const hasAnsiLogEntries = useMemo(
    () => filteredLines.some((line) => containsAnsi(line)),
    [filteredLines]
  );
  const hasLoadedContent = content.length > 0;
  const hasCopyableContent = displayedText.length > 0;
  const displayedLogCount = isParsedView
    ? parsedLogs.length
    : filteredLines.filter((line) => line.length > 0).length;
  const countLabel = getNodeLogCountLabel(Boolean(selectedSource), displayedLogCount);
  const rowCount = getNodeLogRowCount(
    content,
    isParsedView,
    parsedLogs.length,
    renderedDisplayRows.length
  );

  const { resetScrollRestoration } = useLogScrollRestoration({
    rootRef: logsContentRef,
    isParsedView,
    rowCount,
    tailFollowSignal: `${selectedSource?.path ?? ''}:${parsedLogs.length}:${renderedDisplayRows.length}`,
    cacheKey: panelId,
    getScrollTop: getLogViewerScrollTop,
    setScrollTop: setLogViewerScrollTop,
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
    if (!rowKey) {
      return;
    }

    setExpandedRows((current) => {
      const next = new Set(current);
      if (next.has(rowKey)) {
        next.delete(rowKey);
      } else {
        next.add(rowKey);
      }
      return next;
    });
  }, []);

  const resetCopyFeedback = useCallback(() => {
    window.setTimeout(() => {
      setCopyFeedback('idle');
    }, 1200);
  }, []);

  const handleCopyLogs = useCallback(async () => {
    if (!displayedText) {
      setCopyFeedback('error');
      resetCopyFeedback();
      return;
    }

    try {
      await navigator.clipboard.writeText(displayedText);
      setCopyFeedback('copied');
    } catch {
      setCopyFeedback('error');
    }
    resetCopyFeedback();
  }, [displayedText, resetCopyFeedback]);

  useKeyboardSurface({
    kind: 'editor',
    rootRef: logsContentRef,
    active: isActive,
    captureWhenActive: true,
    onNativeAction: ({ action, selection }) => {
      if (action === 'copy') {
        const text = getSelectedTextWithinRoot(selection, logsContentRef.current);
        if (!text) {
          return false;
        }
        void navigator.clipboard.writeText(text).catch(() => {
          /* ignore clipboard failures */
        });
        return true;
      }
      if (action === 'selectAll') {
        return selectAllTextWithinRoot(selection, logsContentRef.current);
      }
      return false;
    },
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

  const copyIconFeedback = getCopyIconFeedback(copyFeedback);
  const iconItems = buildNodeLogIconItems({
    highlightMatches,
    inverseMatches,
    caseSensitiveMatches,
    regexMatches,
    autoRefresh,
    wrapText,
    hasAnsiLogEntries,
    showAnsiColors,
    canParseLogs,
    displayMode,
    isParsedView,
    hasCopyableContent,
    copyIconFeedback,
    toggleHighlightMatches: () => setHighlightMatches((value) => (inverseMatches ? false : !value)),
    toggleInverseMatches: () => setInverseMatches((value) => !value),
    toggleCaseSensitiveMatches: () =>
      setCaseSensitiveMatches((value) => (regexMatches ? false : !value)),
    toggleRegexMatches: () => setRegexMatches((value) => !value),
    toggleAutoRefresh: () => setAutoRefresh((value) => !value),
    toggleWrapText: () => setWrapText((value) => !value),
    toggleAnsiColors: () => setShowAnsiColors((value) => !value),
    togglePrettyJson: () => updateDisplayMode(displayMode === 'pretty' ? 'raw' : 'pretty'),
    toggleParsedJson: () => updateDisplayMode(displayMode === 'parsed' ? 'raw' : 'parsed'),
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
                size="compact"
                className="logs-viewer-selector-dropdown"
                dropdownClassName="node-log-source-menu"
                ariaLabel="Node log source"
                renderOption={renderNodeLogSourceOption}
                renderValue={() =>
                  selectedSource
                    ? getNodeLogSourceLeafLabel(selectedSource.label)
                    : 'Select log source'
                }
              />
            </div>

            <div className="logs-viewer-control-group logs-viewer-filter-group">
              <input
                className="logs-viewer-text-filter"
                type="text"
                value={textFilter}
                onChange={(event) => setTextFilter(event.target.value)}
                placeholder="Filter logs..."
                aria-label="Filter node logs"
              />
              {!!textFilter && (
                <button
                  type="button"
                  className="logs-viewer-filter-clear"
                  onClick={() => setTextFilter('')}
                  title="Clear filter"
                  aria-label="Clear filter"
                >
                  ×
                </button>
              )}
            </div>

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

        <div ref={logsContentRef} className="logs-viewer-content selectable" tabIndex={-1}>
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
            parsedLogs={parsedLogs}
            tableColumns={tableColumns}
            expandedRows={expandedRows}
            onToggleParsedRow={handleToggleParsedRow}
          />
        </div>
      </div>
    </div>
  );
};

export default NodeLogsTab;
