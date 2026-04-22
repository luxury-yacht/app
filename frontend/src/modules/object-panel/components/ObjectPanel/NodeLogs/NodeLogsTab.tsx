import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import GridTable, {
  type GridColumnDefinition,
  GRIDTABLE_VIRTUALIZATION_DEFAULT,
} from '@shared/components/tables/GridTable';
import { Dropdown, type DropdownOption } from '@shared/components/dropdowns/Dropdown';
import IconBar, { type IconBarItem } from '@shared/components/IconBar/IconBar';
import {
  AutoRefreshIcon,
  AnsiColorIcon,
  CopyIcon,
  HighlightSearchIcon,
  InverseSearchIcon,
  ParseJsonIcon,
  PrettyJsonIcon,
  RegexSearchIcon,
  WrapTextIcon,
} from '@shared/components/icons/LogIcons';
import { CaseSensitiveIcon } from '@shared/components/icons/MenuIcons';
import type { LogDisplayMode, CapabilityState } from '../types';
import { containsAnsi, parseAnsiTextSegments, stripAnsi } from '../Logs/ansi';
import {
  DEFAULT_TERMINAL_THEME,
  resolveTerminalTheme,
  type TerminalThemeColors,
} from '@shared/terminal/terminalTheme';
import { formatParsedValue, tryParseJSONObject } from '../Logs/jsonLogs';
import { getLogViewerScrollTop, setLogViewerScrollTop } from '../Logs/logViewerPrefsCache';
import type { ParsedLogEntry } from '../Logs/logViewerReducer';
import { fetchNodeLogs, type NodeLogSource } from './nodeLogsApi';
import '../Logs/LogViewer.css';
import './NodeLogsTab.css';
import { useKeyboardSurface } from '@ui/shortcuts';
import { getSelectedTextWithinRoot, selectAllTextWithinRoot } from '../Logs/textSelection';

const NODE_LOG_TAIL_BYTES = 256 * 1024;
const NODE_LOG_AUTO_REFRESH_MS = 5000;
const NODE_LOG_APPEND_OVERLAP_MS = 5000;
const PARSED_COLUMN_MIN_WIDTH = 50;
const PARSED_TIMESTAMP_MIN_WIDTH = 80;
const PARSED_COLUMN_AUTOSIZE_MAX_WIDTH = 520;
const PARSED_TIMESTAMP_AUTOSIZE_MAX_WIDTH = 280;

type CopyFeedback = 'idle' | 'copied' | 'error';

type NodeLogSourceOptionMetadata =
  | { kind: 'header' }
  | {
      kind: 'child';
      childLabel: string;
      isLastChild: boolean;
    };

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const escapeCsvCell = (value: string): string =>
  /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

const buildSearchRegex = (
  searchText: string,
  regexMode: boolean,
  caseSensitive: boolean
): RegExp | null => {
  const trimmed = searchText.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return new RegExp(regexMode ? trimmed : escapeRegExp(trimmed), caseSensitive ? 'g' : 'gi');
  } catch {
    return null;
  }
};

const getParsedRowKey = (item: ParsedLogEntry): string => `log-${item.seq ?? item.lineNumber}`;

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
  const [content, setContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [truncated, setTruncated] = useState(false);
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
  const [terminalTheme, setTerminalTheme] = useState<TerminalThemeColors>(DEFAULT_TERMINAL_THEME);
  const logsContentRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef('');
  const loadedSourcePathRef = useRef<string | null>(null);
  const lastSuccessfulFetchAtRef = useRef<string | null>(null);
  const scrollRestoredRef = useRef(false);
  const wasAtBottomRef = useRef(true);
  const previousSourcePathRef = useRef<string | null>(null);
  const forceTailRestoreRef = useRef(true);
  const deferredTextFilter = useDeferredValue(textFilter);
  const sourceOptions = useMemo<DropdownOption[]>(
    () => buildNodeLogSourceOptions(sources),
    [sources]
  );

  useEffect(() => {
    const updateTheme = () => {
      setTerminalTheme(
        resolveTerminalTheme(
          logsContentRef.current ? getComputedStyle(logsContentRef.current) : null
        )
      );
    };

    updateTheme();

    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'class'],
    });

    return () => observer.disconnect();
  }, []);

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

  useEffect(() => {
    contentRef.current = content;
  }, [content]);
  const filterRegex = useMemo(
    () => buildSearchRegex(deferredTextFilter, regexMatches, caseSensitiveMatches),
    [caseSensitiveMatches, deferredTextFilter, regexMatches]
  );
  const highlightRegex = useMemo(
    () =>
      highlightMatches && !inverseMatches
        ? buildSearchRegex(deferredTextFilter, regexMatches, caseSensitiveMatches)
        : null,
    [caseSensitiveMatches, deferredTextFilter, highlightMatches, inverseMatches, regexMatches]
  );
  const hasInvalidRegex = Boolean(regexMatches && deferredTextFilter.trim() && !filterRegex);
  const isParsedView = displayMode === 'parsed';

  useEffect(() => {
    if (!isActive || !clusterId || !nodeName || !selectedSource?.path) {
      return;
    }

    let cancelled = false;
    const activeSourcePath = selectedSource.path;
    const sourceChanged = loadedSourcePathRef.current !== activeSourcePath;
    const incrementalSinceTime =
      !sourceChanged && refreshNonce > 0
        ? buildNodeLogSinceTime(lastSuccessfulFetchAtRef.current)
        : undefined;
    const requestStartedAt = new Date().toISOString();

    if (sourceChanged) {
      setContent('');
      setTruncated(false);
    }
    setLoading(true);
    setError(null);

    const fetchLogs = async () => {
      const runFetch = async (sinceTime?: string) =>
        fetchNodeLogs(clusterId, nodeName, {
          sourcePath: activeSourcePath,
          tailBytes: NODE_LOG_TAIL_BYTES,
          sinceTime,
        });

      let appendMode = Boolean(incrementalSinceTime);
      let response = await runFetch(incrementalSinceTime);

      if (appendMode && (response.error || response.truncated)) {
        response = await runFetch();
        appendMode = false;
      }

      return { appendMode, response };
    };

    void fetchLogs()
      .then(({ appendMode, response }) => {
        if (cancelled) {
          return;
        }
        if (response.error) {
          setError(response.error);
          if (sourceChanged) {
            setContent('');
          }
          setTruncated(false);
          return;
        }
        const nextContent =
          appendMode && contentRef.current
            ? appendNodeLogContent(contentRef.current, response.content ?? '')
            : (response.content ?? '');
        loadedSourcePathRef.current = activeSourcePath;
        lastSuccessfulFetchAtRef.current = requestStartedAt;
        startTransition(() => {
          setContent(nextContent);
          setTruncated(Boolean(response.truncated));
        });
      })
      .catch((fetchError) => {
        if (cancelled) {
          return;
        }
        setError(fetchError instanceof Error ? fetchError.message : 'Failed to fetch node logs');
        if (sourceChanged) {
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
  }, [clusterId, isActive, nodeName, refreshNonce, selectedSource?.path]);

  useEffect(() => {
    if (!autoRefresh || !isActive || !selectedSource?.path) {
      return;
    }

    const timerId = window.setInterval(() => {
      setRefreshNonce((value) => value + 1);
    }, NODE_LOG_AUTO_REFRESH_MS);

    return () => {
      window.clearInterval(timerId);
    };
  }, [autoRefresh, isActive, selectedSource?.path]);

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

  const derivedFieldKeys = useMemo(() => {
    if (parsedLogs.length === 0) {
      return [] as string[];
    }

    const seen = new Set<string>();
    parsedLogs.forEach((entry) => {
      Object.keys(entry.data).forEach((key) => {
        seen.add(key);
      });
    });

    return Array.from(seen).sort();
  }, [parsedLogs]);

  const tableColumns = useMemo(() => {
    if (derivedFieldKeys.length === 0) {
      return [] as GridColumnDefinition<ParsedLogEntry>[];
    }

    const columns: GridColumnDefinition<ParsedLogEntry>[] = [];
    const timestampCandidates = ['timestamp', 'time', 'ts'];
    const levelCandidates = ['level', 'severity', 'log_level'];

    const jsonTimestampKey = derivedFieldKeys.find((key) => timestampCandidates.includes(key));
    if (jsonTimestampKey) {
      columns.push({
        key: jsonTimestampKey,
        header: jsonTimestampKey,
        sortable: false,
        minWidth: PARSED_TIMESTAMP_MIN_WIDTH,
        autoSizeMaxWidth: PARSED_TIMESTAMP_AUTOSIZE_MAX_WIDTH,
        render: (item: ParsedLogEntry) => formatParsedValue(item.data[jsonTimestampKey]),
      });
    }

    const jsonLevelKey = derivedFieldKeys.find((key) => levelCandidates.includes(key));
    if (jsonLevelKey) {
      columns.push({
        key: jsonLevelKey,
        header: jsonLevelKey,
        sortable: false,
        minWidth: PARSED_COLUMN_MIN_WIDTH,
        autoSizeMaxWidth: PARSED_COLUMN_AUTOSIZE_MAX_WIDTH,
        render: (item: ParsedLogEntry) => formatParsedValue(item.data[jsonLevelKey]),
      });
    }

    const addedKeys = new Set(columns.map((column) => column.key));
    derivedFieldKeys.forEach((key) => {
      if (addedKeys.has(key)) {
        return;
      }

      columns.push({
        key,
        header: key,
        sortable: false,
        minWidth: PARSED_COLUMN_MIN_WIDTH,
        autoSizeMaxWidth: PARSED_COLUMN_AUTOSIZE_MAX_WIDTH,
        render: (item: ParsedLogEntry) => (
          <div className="parsed-log-cell">{formatParsedValue(item.data[key])}</div>
        ),
      });
    });

    return columns;
  }, [derivedFieldKeys]);

  const displayLines = useMemo(
    () =>
      filteredLines.map((line) => {
        if (displayMode === 'pretty') {
          const parsed = tryParseJSONObject(line);
          if (parsed) {
            return JSON.stringify(parsed, null, 2);
          }
        }

        return showAnsiColors ? line : stripAnsi(line);
      }),
    [displayMode, filteredLines, showAnsiColors]
  );

  const renderedDisplayRows = useMemo(
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
      escapeCsvCell(typeof column.header === 'string' ? column.header : column.key)
    );
    const dataRows = parsedLogs.map((entry) =>
      tableColumns.map((column) => escapeCsvCell(formatParsedValue(entry.data[column.key])))
    );

    return [headerRow, ...dataRows].map((row) => row.join(',')).join('\n');
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
  const countLabel = selectedSource
    ? `${displayedLogCount} matching log${displayedLogCount === 1 ? '' : 's'}`
    : 'Select a log source';

  const getScrollContainer = useCallback((): HTMLElement | null => {
    const root = logsContentRef.current;
    if (!root) {
      return null;
    }
    if (isParsedView) {
      return root.querySelector<HTMLElement>('.gridtable-wrapper');
    }
    return root;
  }, [isParsedView]);

  useEffect(() => {
    const sourcePath = selectedSource?.path ?? null;
    if (sourcePath === previousSourcePathRef.current) {
      return;
    }

    previousSourcePathRef.current = sourcePath;
    loadedSourcePathRef.current = null;
    lastSuccessfulFetchAtRef.current = null;
    scrollRestoredRef.current = false;
    wasAtBottomRef.current = true;
    forceTailRestoreRef.current = true;
  }, [selectedSource?.path]);

  useEffect(() => {
    const scrollEl = getScrollContainer();
    if (!scrollEl) {
      return;
    }

    const handler = () => {
      wasAtBottomRef.current =
        scrollEl.scrollTop + scrollEl.clientHeight >= scrollEl.scrollHeight - 16;
      if (!scrollRestoredRef.current) {
        return;
      }
      setLogViewerScrollTop(panelId, scrollEl.scrollTop);
    };

    scrollEl.addEventListener('scroll', handler, { passive: true });
    return () => {
      scrollEl.removeEventListener('scroll', handler);
    };
  }, [getScrollContainer, panelId]);

  useEffect(() => {
    if (scrollRestoredRef.current) {
      return;
    }

    const rowCount =
      content.length === 0 ? 0 : isParsedView ? parsedLogs.length : renderedDisplayRows.length;
    if (rowCount === 0) {
      return;
    }

    const scrollEl = getScrollContainer();
    if (!scrollEl) {
      return;
    }
    if (scrollEl.scrollHeight <= scrollEl.clientHeight) {
      return;
    }

    const maxScrollTop = scrollEl.scrollHeight - scrollEl.clientHeight;
    const savedScrollTop = forceTailRestoreRef.current ? undefined : getLogViewerScrollTop(panelId);
    const targetScrollTop =
      savedScrollTop != null ? Math.min(savedScrollTop, maxScrollTop) : maxScrollTop;

    scrollEl.scrollTop = targetScrollTop;
    scrollRestoredRef.current = true;
    forceTailRestoreRef.current = false;
  }, [
    content.length,
    getScrollContainer,
    isParsedView,
    panelId,
    parsedLogs.length,
    renderedDisplayRows.length,
    selectedSource?.path,
  ]);

  useEffect(() => {
    if (!wasAtBottomRef.current || !scrollRestoredRef.current) {
      return;
    }

    const scrollEl = getScrollContainer();
    if (!scrollEl) {
      return;
    }

    let rafId: number | undefined;
    const scrollToBottom = () => {
      const element = getScrollContainer();
      if (!element) {
        return;
      }
      element.scrollTop = element.scrollHeight;
    };

    if (isParsedView) {
      let attempts = 0;
      const maxAttempts = 20;
      const checkAndScroll = () => {
        const element = getScrollContainer();
        if (element && element.scrollHeight > element.clientHeight) {
          rafId = requestAnimationFrame(scrollToBottom);
        } else if (attempts < maxAttempts) {
          attempts += 1;
          rafId = requestAnimationFrame(checkAndScroll);
        }
      };
      rafId = requestAnimationFrame(checkAndScroll);
    } else {
      rafId = requestAnimationFrame(scrollToBottom);
    }

    return () => {
      if (rafId != null) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [
    getScrollContainer,
    isParsedView,
    parsedLogs.length,
    renderedDisplayRows.length,
    selectedSource?.path,
  ]);

  const handleParsedTableClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const row = (event.target as HTMLElement | null)?.closest<HTMLElement>('.gridtable-row');
    const rowKey = row?.dataset.rowKey;
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

  const handleParsedRowKeyboard = useCallback((item: ParsedLogEntry) => {
    const rowKey = getParsedRowKey(item);
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

  const getParsedRowClassName = useCallback(
    (item: ParsedLogEntry) =>
      expandedRows.has(getParsedRowKey(item)) ? 'parsed-row-expanded' : undefined,
    [expandedRows]
  );

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

  const renderHighlightedMessage = useCallback(
    (text: string, keyPrefix: string) => {
      if (!text) {
        return '\u00A0';
      }
      if (!highlightRegex) {
        return text;
      }

      const matches = Array.from(text.matchAll(highlightRegex));
      if (matches.length === 0) {
        return text;
      }

      const nodes: React.ReactNode[] = [];
      let lastIndex = 0;

      matches.forEach((match, index) => {
        const matchIndex = match.index ?? -1;
        const value = match[0] ?? '';
        if (matchIndex < 0 || value.length === 0) {
          return;
        }
        if (matchIndex > lastIndex) {
          nodes.push(text.slice(lastIndex, matchIndex));
        }
        nodes.push(
          <mark key={`${keyPrefix}-${matchIndex}-${index}`} className="pod-log-highlight">
            {value}
          </mark>
        );
        lastIndex = matchIndex + value.length;
      });

      if (nodes.length === 0) {
        return text;
      }
      if (lastIndex < text.length) {
        nodes.push(text.slice(lastIndex));
      }
      return nodes;
    },
    [highlightRegex]
  );

  const renderMessageContent = useCallback(
    (text: string, keyPrefix: string) => {
      const normalizedText = showAnsiColors ? text : stripAnsi(text);
      if (!showAnsiColors || !containsAnsi(text)) {
        return renderHighlightedMessage(normalizedText, keyPrefix);
      }

      const segments = parseAnsiTextSegments(text, terminalTheme);
      if (segments.length === 0) {
        return renderHighlightedMessage(stripAnsi(text), keyPrefix);
      }

      return segments.map((segment, index) => {
        const contentNode = renderHighlightedMessage(segment.text, `${keyPrefix}-${index}`);
        if (Object.keys(segment.style).length === 0) {
          return <span key={`${keyPrefix}-plain-${index}`}>{contentNode}</span>;
        }
        return (
          <span key={`${keyPrefix}-ansi-${index}`} style={segment.style}>
            {contentNode}
          </span>
        );
      });
    },
    [renderHighlightedMessage, showAnsiColors, terminalTheme]
  );

  if (availability.pending) {
    return (
      <div className="object-panel-tab-content">
        <div className="pod-logs-display">
          <div className="pod-logs-content">
            <div className="pod-logs-display-loading">
              Checking if logs are available for this node...
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (sources.length === 0) {
    return (
      <div className="object-panel-tab-content">
        <div className="pod-logs-display">
          <div className="pod-logs-content">
            <div className="pod-logs-display-error">
              <div className="node-log-unavailable-message">
                <div>Logs are not available on this node</div>
                {availability.reason ? <div>Error: {availability.reason}</div> : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="object-panel-tab-content">
      <div className="pod-logs-display">
        <div className="pod-logs-controls">
          <div className="pod-logs-controls-left">
            <div className="pod-logs-control-group">
              <Dropdown
                options={sourceOptions}
                value={selectedSource?.path ?? ''}
                onChange={(value) =>
                  setSelectedSourcePath(Array.isArray(value) ? (value[0] ?? '') : value)
                }
                placeholder={loading ? 'Loading logs…' : 'Select log source'}
                size="compact"
                className="pod-logs-selector-dropdown"
                ariaLabel="Node log source"
                renderOption={(option) => {
                  if (option.group === 'header') {
                    return <span className="node-log-source-header">{option.label}</span>;
                  }

                  const metadata = option.metadata as NodeLogSourceOptionMetadata | undefined;

                  if (metadata?.kind === 'child') {
                    return (
                      <span
                        className={[
                          'node-log-source-label',
                          'node-log-source-child',
                          metadata.isLastChild && 'node-log-source-child-last',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                      >
                        <span className="node-log-source-child-text">{metadata.childLabel}</span>
                      </span>
                    );
                  }

                  return <span className="node-log-source-label">{option.label}</span>;
                }}
                renderValue={() =>
                  selectedSource
                    ? getNodeLogSourceLeafLabel(selectedSource.label)
                    : 'Select log source'
                }
              />
            </div>

            <div className="pod-logs-control-group pod-logs-filter-group">
              <input
                className="pod-logs-text-filter"
                type="text"
                value={textFilter}
                onChange={(event) => setTextFilter(event.target.value)}
                placeholder="Filter logs..."
                aria-label="Filter node logs"
              />
              {textFilter && (
                <button
                  className="pod-logs-filter-clear"
                  onClick={() => setTextFilter('')}
                  title="Clear filter"
                  aria-label="Clear filter"
                >
                  ×
                </button>
              )}
            </div>

            <IconBar
              items={
                [
                  {
                    type: 'toggle',
                    id: 'highlightSearch',
                    icon: <HighlightSearchIcon />,
                    active: highlightMatches,
                    onClick: () =>
                      setHighlightMatches((value) => (inverseMatches ? false : !value)),
                    title: 'Highlight matching text - disabled when Invert is enabled',
                    ariaLabel: 'Highlight matching text - disabled when Invert is enabled',
                    disabled: inverseMatches,
                  },
                  {
                    type: 'toggle',
                    id: 'inverseSearch',
                    icon: <InverseSearchIcon />,
                    active: inverseMatches,
                    onClick: () => setInverseMatches((value) => !value),
                    title: 'Invert the text filter to show only non-matching logs',
                    ariaLabel: 'Invert the text filter to show only non-matching logs',
                  },
                  {
                    type: 'toggle',
                    id: 'caseSensitiveSearch',
                    icon: <CaseSensitiveIcon width={16} height={16} />,
                    active: caseSensitiveMatches,
                    onClick: () =>
                      setCaseSensitiveMatches((value) => (regexMatches ? false : !value)),
                    title: 'Case-sensitive search - disabled when regex is enabled',
                    ariaLabel: 'Case-sensitive search - disabled when regex is enabled',
                    disabled: regexMatches,
                  },
                  {
                    type: 'toggle',
                    id: 'regexSearch',
                    icon: <RegexSearchIcon />,
                    active: regexMatches,
                    onClick: () => setRegexMatches((value) => !value),
                    title: 'Enable regular expression support for the text filter',
                    ariaLabel: 'Enable regular expression support for the text filter',
                  },
                  { type: 'separator' },
                  {
                    type: 'toggle',
                    id: 'autoRefresh',
                    icon: <AutoRefreshIcon />,
                    active: autoRefresh,
                    onClick: () => setAutoRefresh((value) => !value),
                    title: 'Toggle auto-refresh',
                    ariaLabel: 'Toggle auto-refresh',
                  },
                  {
                    type: 'toggle',
                    id: 'wrapText',
                    icon: <WrapTextIcon />,
                    active: wrapText,
                    onClick: () => setWrapText((value) => !value),
                    title: 'Wrap text',
                    ariaLabel: 'Wrap text',
                    disabled: isParsedView,
                  },
                  ...(hasAnsiLogEntries
                    ? [
                        {
                          type: 'toggle' as const,
                          id: 'ansiColors',
                          icon: <AnsiColorIcon />,
                          active: showAnsiColors,
                          onClick: () => setShowAnsiColors((value) => !value),
                          title: 'Show ANSI colors if present',
                          ariaLabel: 'Show ANSI colors if present',
                          disabled: isParsedView,
                        },
                      ]
                    : []),
                  ...(canParseLogs
                    ? [
                        {
                          type: 'toggle' as const,
                          id: 'prettyJson',
                          icon: <PrettyJsonIcon />,
                          active: displayMode === 'pretty',
                          onClick: () =>
                            updateDisplayMode(displayMode === 'pretty' ? 'raw' : 'pretty'),
                          title: 'Show pretty JSON',
                          ariaLabel: 'Show pretty JSON',
                        },
                        {
                          type: 'toggle' as const,
                          id: 'parsedJson',
                          icon: <ParseJsonIcon />,
                          active: isParsedView,
                          onClick: () =>
                            updateDisplayMode(displayMode === 'parsed' ? 'raw' : 'parsed'),
                          title: 'Parse the JSON into a table',
                          ariaLabel: 'Parse the JSON into a table',
                        },
                      ]
                    : []),
                  { type: 'separator' },
                  {
                    type: 'action',
                    id: 'copy',
                    icon: <CopyIcon />,
                    onClick: handleCopyLogs,
                    title: 'Copy to clipboard',
                    ariaLabel: 'Copy to clipboard',
                    disabled: !hasCopyableContent,
                    feedback:
                      copyFeedback === 'copied'
                        ? 'success'
                        : copyFeedback === 'error'
                          ? 'error'
                          : null,
                  },
                ] satisfies IconBarItem[]
              }
            />

            <span
              className="pod-logs-count"
              aria-label="Selected node log source"
              title={selectedSource?.path || '/'}
            >
              {countLabel}
            </span>
          </div>
        </div>

        {truncated && !error && (
          <div className="pod-logs-warning-bar">
            Showing only the most recent {Math.floor(NODE_LOG_TAIL_BYTES / 1024)} KB for
            responsiveness.
          </div>
        )}

        <div ref={logsContentRef} className="pod-logs-content selectable" tabIndex={-1}>
          {error ? (
            <div className="pod-logs-display-error">{error}</div>
          ) : !selectedSource ? (
            <div className="pod-logs-display-loading">Select a log source to view logs.</div>
          ) : loading && !hasLoadedContent ? (
            <div className="pod-logs-display-loading">Loading logs…</div>
          ) : hasInvalidRegex ? (
            <div className="pod-logs-display-error">Enter a valid regular expression.</div>
          ) : filteredLines.length === 0 ? (
            <div className="pod-logs-display-loading">
              {content.length === 0
                ? 'No logs returned for this source.'
                : 'No log lines match the current filter.'}
            </div>
          ) : isParsedView ? (
            !canParseLogs ? (
              <div className="pod-logs-display-loading">
                No JSON log lines match the current filter.
              </div>
            ) : (
              <div onClick={handleParsedTableClick} style={{ height: '100%' }}>
                <GridTable
                  data={parsedLogs}
                  columns={tableColumns}
                  keyExtractor={(item: ParsedLogEntry) => getParsedRowKey(item)}
                  onRowClick={handleParsedRowKeyboard}
                  getRowClassName={getParsedRowClassName}
                  className="parsed-logs-table"
                  tableClassName="gridtable-parsed-logs"
                  virtualization={GRIDTABLE_VIRTUALIZATION_DEFAULT}
                  isKindColumnKey={() => false}
                />
              </div>
            )
          ) : (
            <div className={`pod-logs-text ${!wrapText ? 'no-wrap' : ''}`}>
              {renderedDisplayRows.map((row, index) => (
                <div key={row.key} className="pod-log-line">
                  {renderMessageContent(row.line, `node-log-line-${index}`)}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default NodeLogsTab;
