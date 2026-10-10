/**
 * frontend/src/components/content/AppLogsPanel/AppLogsPanel.tsx
 *
 * UI component for AppLogsPanel.
 * Handles rendering and interactions for the shared components.
 */

import { Dropdown } from '@shared/components/dropdowns/Dropdown';
import {
  DropdownFilterOption,
  dropdownFilterOptionState,
} from '@shared/components/dropdowns/Dropdown/DropdownFilterOption';
import { normalizeDropdownValue } from '@shared/components/dropdowns/dropdownValue';
import {
  ALL_MULTISELECT_FILTER,
  filterSelectionFromDropdownValues,
  filterSelectionMatches,
  filterSelectionToDropdownValues,
  isNarrowingFilterSelection,
  type MultiSelectFilterSelection,
  multiSelectFilterTriggerLabel,
  pruneFilterSelectionToOptions,
} from '@shared/components/dropdowns/multiSelectFilterSelection';
import IconBar, { type IconBarItem } from '@shared/components/IconBar/IconBar';
import { DeleteIcon } from '@shared/components/icons/SharedIcons';
import LoadingSpinner from '@shared/components/LoadingSpinner';
import LogResumeScrollingButton from '@shared/components/logs/LogResumeScrollingButton';
import { buildLogAutoRefreshItem } from '@shared/components/logs/logAutoRefreshItem';
import RawLogViewer, { type RenderedLogRow } from '@shared/components/logs/RawLogViewer';
import ScrollableRegion from '@shared/components/ScrollableRegion';
import { AriaGridColumnHeader, AriaGridRow } from '@shared/components/tables/AriaGridPrimitives';
import { useLogDownloadMenu } from '@shared/hooks/useLogDownloadMenu';
import {
  type LogScrollPosition,
  useLogScrollRestoration,
} from '@shared/hooks/useLogScrollRestoration';
import { acquireColumnResizeCursor } from '@shared/utils/columnResizeCursor';
import { withStableListKeys } from '@shared/utils/stableListKeys';
import { DockablePanel } from '@ui/dockable';
import { useShortcut } from '@ui/shortcuts';
import { KeyboardShortcutPriority } from '@ui/shortcuts/priorities';
import { errorHandler } from '@utils/errorHandler';
import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { readAppLogs, readAppLogsSince } from '@/core/app-state-access';
import { ClearAppLogs, SetAppLogsPanelVisible } from '@/core/backend-api';
import { type AppLogsAddedEvent, subscribeAppLogsAdded } from '@/core/logging/appLogsClient';
import './AppLogsPanel.css';
import { compareUtf16Strings } from '@/shared/utils/sort';

interface LogEntry {
  sequence?: number;
  timestamp: string;
  level: string;
  message: string;
  source?: string;
  clusterId?: string;
  clusterName?: string;
}

const LOG_LEVEL_BASE_OPTIONS = [
  { value: 'info', label: 'Info' },
  { value: 'warn', label: 'Warning' },
  { value: 'error', label: 'Error' },
  { value: 'debug', label: 'Debug' },
];
const GLOBAL_LOG_SCOPE_VALUE = '__app_global__';
const GLOBAL_LOG_SCOPE_LABEL = 'Global';
const DEFAULT_LOG_COLUMN_WIDTHS = {
  timestamp: 90,
  level: 60,
  source: 120,
  cluster: 140,
};
const LOG_COLUMN_WIDTH_LIMITS = {
  timestamp: { min: 70, max: 180 },
  level: { min: 50, max: 120 },
  source: { min: 80, max: 320 },
  cluster: { min: 90, max: 420 },
};

type LogColumnKey = keyof typeof DEFAULT_LOG_COLUMN_WIDTHS;

interface ResizeDragState {
  column: LogColumnKey;
  startX: number;
  startWidth: number;
}

const findLatestSequence = (entries: LogEntry[], fallback = 0) =>
  entries.reduce(
    (latest, entry) =>
      typeof entry.sequence === 'number' && entry.sequence > latest ? entry.sequence : latest,
    fallback
  );

// Application Logs keep a fixed 10,000 lines, the size of the backend store
// (appLogsMaxEntries in backend/app_log_service.go). It is not the Logs tabs'
// Buffer size: troubleshooting the app can need more history than a pod's logs.
const APP_LOGS_MAX_ENTRIES = 10_000;

const keepNewestLogs = (entries: LogEntry[]) =>
  entries.length > APP_LOGS_MAX_ENTRIES ? entries.slice(-APP_LOGS_MAX_ENTRIES) : entries;

const getLogScopeValue = (log: LogEntry) => {
  const clusterId = log.clusterId?.trim() ?? '';
  const clusterName = log.clusterName?.trim() ?? '';
  return clusterId || clusterName || GLOBAL_LOG_SCOPE_VALUE;
};

const getLogScopeLabel = (log: LogEntry) =>
  log.clusterName?.trim() || log.clusterId?.trim() || GLOBAL_LOG_SCOPE_LABEL;

const clampColumnWidth = (column: LogColumnKey, width: number) => {
  const limits = LOG_COLUMN_WIDTH_LIMITS[column];
  return Math.min(limits.max, Math.max(limits.min, Math.round(width)));
};

const buildClusterOption = (log: LogEntry) => {
  const clusterId = log.clusterId?.trim() ?? '';
  const clusterName = log.clusterName?.trim() ?? '';
  const value = getLogScopeValue(log);

  let fileName = '';
  let context = '';

  if (clusterId && clusterName && clusterId !== clusterName) {
    const contextSuffix = `:${clusterName}`;
    if (clusterId.endsWith(contextSuffix) && clusterId.length > contextSuffix.length) {
      fileName = clusterId.slice(0, -contextSuffix.length);
      context = clusterName;
    } else if (clusterId.includes(':')) {
      const separatorIndex = clusterId.lastIndexOf(':');
      fileName = clusterId.slice(0, separatorIndex);
      context = clusterId.slice(separatorIndex + 1);
    } else {
      fileName = clusterId;
      context = clusterName;
    }
  } else if (clusterId.includes(':')) {
    const separatorIndex = clusterId.lastIndexOf(':');
    fileName = clusterId.slice(0, separatorIndex);
    context = clusterId.slice(separatorIndex + 1);
  } else {
    context = clusterName || clusterId;
  }

  const label = fileName && context ? `${fileName}:${context}` : context || GLOBAL_LOG_SCOPE_LABEL;

  return {
    value,
    label,
    metadata: {
      fileName,
      context,
    },
  };
};

const getLevelClass = (level: string) => {
  switch (level.toLowerCase()) {
    case 'error':
      return 'log-level-error';
    case 'warn':
    case 'warning':
      return 'log-level-warning';
    case 'debug':
      return 'log-level-debug';
    default:
      return 'log-level-info';
  }
};

interface AppLogRow extends RenderedLogRow {
  log: LogEntry;
}

const appLogRowKey = (log: LogEntry) =>
  String(log.sequence ?? `${log.timestamp}:${log.source ?? ''}:${log.message}`);

const normalizeLogLevel = (level: string) => {
  const normalized = level.toLowerCase();
  return normalized === 'warning' ? 'warn' : normalized;
};

const renderLogFilterOption = (option: { value: string; label: string }, isSelected: boolean) => (
  <DropdownFilterOption label={option.label} state={dropdownFilterOptionState(isSelected)} />
);

function matchesLogSearch(log: LogEntry, text: string, scope: string): boolean {
  if (!text.trim()) {
    return true;
  }
  const search = text.toLowerCase();
  return (
    log.message.toLowerCase().includes(search) ||
    Boolean(log.source?.toLowerCase().includes(search)) ||
    Boolean(log.clusterId?.toLowerCase().includes(search)) ||
    Boolean(log.clusterName?.toLowerCase().includes(search)) ||
    (scope === GLOBAL_LOG_SCOPE_VALUE && GLOBAL_LOG_SCOPE_LABEL.toLowerCase().includes(search))
  );
}

interface AppLogsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

function AppLogsPanel({ isOpen, onClose }: Readonly<AppLogsPanelProps>) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  // Local to this panel, like a Logs tab's: stopping holds the shown lines, starting catches up.
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [isTailFollowing, setIsTailFollowing] = useState(true);
  const [isLoading, setIsLoading] = useState(false);

  const [logLevelFilter, setLogLevelFilter] =
    useState<MultiSelectFilterSelection>(ALL_MULTISELECT_FILTER);
  const [componentFilter, setComponentFilter] =
    useState<MultiSelectFilterSelection>(ALL_MULTISELECT_FILTER);
  const [clusterFilter, setClusterFilter] =
    useState<MultiSelectFilterSelection>(ALL_MULTISELECT_FILTER);
  const [textFilter, setTextFilter] = useState<string>('');
  const [columnWidths, setColumnWidths] = useState(DEFAULT_LOG_COLUMN_WIDTHS);
  const logsContainerRef = useRef<HTMLElement>(null);
  const textFilterInputRef = useRef<HTMLInputElement>(null);
  // Read when lines arrive: while scrolled up the shown lines stay, so the cap waits.
  const isTailFollowingRef = useRef(true);
  const scrollPositionRef = useRef<LogScrollPosition | undefined>(undefined);
  const latestSequenceRef = useRef(0);
  const resizeDragRef = useRef<ResizeDragState | null>(null);
  const resizeCleanupRef = useRef<(() => void) | null>(null);

  // Keep backend menu/panel visibility aligned with this panel's open state.
  useEffect(() => {
    SetAppLogsPanelVisible(isOpen).catch((error) => {
      errorHandler.handle(error, { action: 'setAppLogsPanelVisible' });
    });
  }, [isOpen]);

  const finishColumnResize = useCallback(() => {
    resizeDragRef.current = null;
    resizeCleanupRef.current?.();
    resizeCleanupRef.current = null;
  }, []);

  useEffect(() => () => finishColumnResize(), [finishColumnResize]);

  const setColumnWidth = useCallback((column: LogColumnKey, width: number) => {
    setColumnWidths((prev) => ({
      ...prev,
      [column]: clampColumnWidth(column, width),
    }));
  }, []);

  const handleColumnResizePointerDown = useCallback(
    (column: LogColumnKey, event: PointerEvent<HTMLSpanElement>) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      finishColumnResize();

      resizeDragRef.current = {
        column,
        startX: event.clientX,
        startWidth: columnWidths[column],
      };
      const releaseCursor = acquireColumnResizeCursor();
      const previousUserSelect = document.body.style.userSelect;
      document.body.style.userSelect = 'none';

      const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
        const drag = resizeDragRef.current;
        if (!drag) {
          return;
        }
        setColumnWidth(drag.column, drag.startWidth + moveEvent.clientX - drag.startX);
      };

      const handlePointerUp = () => {
        finishColumnResize();
      };

      resizeCleanupRef.current = () => {
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
        window.removeEventListener('pointercancel', handlePointerUp);
        releaseCursor();
        document.body.style.userSelect = previousUserSelect;
      };
      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerUp);
      window.addEventListener('pointercancel', handlePointerUp);
    },
    [columnWidths, finishColumnResize, setColumnWidth]
  );

  const handleColumnResizeKeyDown = useCallback(
    (column: LogColumnKey, event: KeyboardEvent<HTMLSpanElement>) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
        return;
      }
      event.preventDefault();
      const direction = event.key === 'ArrowRight' ? 1 : -1;
      const step = event.shiftKey ? 25 : 10;
      setColumnWidth(column, columnWidths[column] + direction * step);
    },
    [columnWidths, setColumnWidth]
  );

  const columnWidthStyle = useMemo(
    () =>
      ({
        '--app-log-timestamp-width': `${columnWidths.timestamp}px`,
        '--app-log-level-width': `${columnWidths.level}px`,
        '--app-log-source-width': `${columnWidths.source}px`,
        '--app-log-cluster-width': `${columnWidths.cluster}px`,
      }) as CSSProperties,
    [columnWidths]
  );

  const renderHeaderCell = useCallback(
    (column: LogColumnKey | 'message', label: string, className: string) => (
      <AriaGridColumnHeader className={`app-logs-header-cell ${className}`}>
        <span className="app-logs-header-label">{label}</span>
        {column !== 'message' && (
          <hr
            className="app-logs-column-resizer"
            tabIndex={0}
            aria-label={`Resize ${label} column`}
            aria-orientation="vertical"
            aria-valuemin={LOG_COLUMN_WIDTH_LIMITS[column].min}
            aria-valuemax={LOG_COLUMN_WIDTH_LIMITS[column].max}
            aria-valuenow={columnWidths[column]}
            onPointerDown={(event) => handleColumnResizePointerDown(column, event)}
            onKeyDown={(event) => handleColumnResizeKeyDown(column, event)}
          />
        )}
      </AriaGridColumnHeader>
    ),
    [columnWidths, handleColumnResizeKeyDown, handleColumnResizePointerDown]
  );

  const updateLatestSequence = useCallback((entries: LogEntry[]) => {
    latestSequenceRef.current = findLatestSequence(entries);
  }, []);

  const loadLogs = useCallback(
    async (showLoadingSpinner = false) => {
      try {
        // Only show loading spinner on initial load or when explicitly requested
        if (showLoadingSpinner) {
          setIsLoading(true);
        }
        const logEntries = keepNewestLogs(await readAppLogs());
        updateLatestSequence(logEntries);
        setLogs(logEntries);
      } catch (error) {
        errorHandler.handle(error, { action: 'loadLogs' });
      } finally {
        if (showLoadingSpinner) {
          setIsLoading(false);
        }
      }
    },
    [updateLatestSequence]
  );

  const loadLogDeltas = useCallback(async (event?: AppLogsAddedEvent) => {
    const eventSequence = typeof event?.sequence === 'number' ? event.sequence : undefined;
    if (eventSequence !== undefined && eventSequence <= latestSequenceRef.current) {
      return;
    }

    try {
      const deltaEntries = await readAppLogsSince(latestSequenceRef.current);
      if (deltaEntries.length === 0) {
        return;
      }

      setLogs((prevLogs) => {
        const latestBeforeAppend = findLatestSequence(prevLogs, latestSequenceRef.current);
        const newEntries = deltaEntries.filter(
          (entry) => typeof entry.sequence !== 'number' || entry.sequence > latestBeforeAppend
        );
        if (newEntries.length === 0) {
          latestSequenceRef.current = latestBeforeAppend;
          return prevLogs;
        }

        const appended = [...prevLogs, ...newEntries];
        const nextLogs = isTailFollowingRef.current ? keepNewestLogs(appended) : appended;
        latestSequenceRef.current = findLatestSequence(nextLogs, latestBeforeAppend);
        return nextLogs;
      });
    } catch (error) {
      errorHandler.handle(error, { action: 'loadLogDeltas' });
    }
  }, []);

  const formatTimestamp = useCallback((timestamp: string) => {
    try {
      const options: Intl.DateTimeFormatOptions & { fractionalSecondDigits: number } = {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
        fractionalSecondDigits: 3,
      };
      const formatter = new Intl.DateTimeFormat('en-US', options);

      return formatter.format(new Date(timestamp));
    } catch {
      return timestamp;
    }
  }, []);

  const handleClearAppLogs = useCallback(async () => {
    try {
      await ClearAppLogs();
      setLogs([]);
    } catch (error) {
      errorHandler.handle(error, { action: 'clearLogs' });
    }
  }, []);

  const startAutoRefresh = useCallback(() => {
    setAutoRefresh(true);
    void loadLogDeltas();
  }, [loadLogDeltas]);

  const handleToggleAutoRefresh = useCallback(() => {
    if (autoRefresh) {
      setAutoRefresh(false);
    } else {
      startAutoRefresh();
    }
  }, [autoRefresh, startAutoRefresh]);

  const handleLogLevelDropdownChange = useCallback((value: string | string[]) => {
    setLogLevelFilter(
      filterSelectionFromDropdownValues(normalizeDropdownValue(value), LOG_LEVEL_BASE_OPTIONS)
    );
  }, []);

  const componentNames = useMemo(
    () =>
      Array.from(
        new Set(logs.map((log) => log.source).filter((source): source is string => Boolean(source)))
      ).sort(compareUtf16Strings),
    [logs]
  );

  const componentOptions = useMemo(
    () =>
      componentNames.map((component) => ({
        value: component,
        label: component,
      })),
    [componentNames]
  );

  const clusterOptions = useMemo(() => {
    const seen = new Set<string>();
    const options: Array<ReturnType<typeof buildClusterOption>> = [];
    logs.forEach((log) => {
      const option = buildClusterOption(log);
      if (seen.has(option.value)) {
        return;
      }
      seen.add(option.value);
      options.push(option);
    });
    options.sort((left, right) => {
      if (left.value === GLOBAL_LOG_SCOPE_VALUE) {
        return -1;
      }
      if (right.value === GLOBAL_LOG_SCOPE_VALUE) {
        return 1;
      }
      return left.label.localeCompare(right.label);
    });
    return options;
  }, [logs]);

  const handleComponentDropdownChange = useCallback(
    (value: string | string[]) => {
      setComponentFilter(
        filterSelectionFromDropdownValues(normalizeDropdownValue(value), componentOptions)
      );
    },
    [componentOptions]
  );

  useEffect(() => {
    setComponentFilter((prev) => {
      return pruneFilterSelectionToOptions(prev, componentOptions);
    });
  }, [componentOptions]);

  const handleClusterDropdownChange = useCallback(
    (value: string | string[]) => {
      setClusterFilter(
        filterSelectionFromDropdownValues(normalizeDropdownValue(value), clusterOptions, 'exact')
      );
    },
    [clusterOptions]
  );

  useEffect(() => {
    setClusterFilter((prev) => {
      return pruneFilterSelectionToOptions(prev, clusterOptions, 'exact');
    });
  }, [clusterOptions]);

  const renderClusterOption = useCallback(
    (
      option: {
        value: string;
        label: string;
        metadata?: { fileName?: unknown; context?: unknown };
      },
      isSelected: boolean
    ) => {
      const fileName =
        typeof option.metadata?.fileName === 'string' ? option.metadata.fileName : '';
      const context = typeof option.metadata?.context === 'string' ? option.metadata.context : '';

      return (
        <DropdownFilterOption
          label={
            fileName && context ? (
              <span className="app-logs-cluster-label">
                <span className="app-logs-cluster-file">{fileName}</span>
                <span className="app-logs-cluster-separator" aria-hidden="true">
                  :
                </span>
                <span className="app-logs-cluster-context">{context}</span>
              </span>
            ) : (
              option.label
            )
          }
          state={dropdownFilterOptionState(isSelected)}
        />
      );
    },
    []
  );

  // Load logs when panel becomes visible
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    // Wait for opening animation to complete (300ms) before loading logs
    const loadTimer = setTimeout(() => {
      loadLogs(true); // Show spinner on initial load
    }, 300);

    return () => {
      clearTimeout(loadTimer);
    };
  }, [isOpen, loadLogs]);

  // New lines stream in only while auto-refresh is on.
  useEffect(() => {
    if (!isOpen || !autoRefresh) {
      return;
    }
    return subscribeAppLogsAdded(loadLogDeltas);
  }, [autoRefresh, isOpen, loadLogDeltas]);

  // ESC key to close panel
  useShortcut({
    key: 'Escape',
    handler: () => {
      if (isOpen) {
        onClose();
        return true;
      }
      return false;
    },
    description: 'Close Application Logs Panel',
    category: 'Windows & Panels',
    helpOrder: 42,
    enabled: isOpen,
    priority: isOpen ? KeyboardShortcutPriority.APP_LOGS_ESCAPE : 0,
  });

  // Filter logs based on selected level, component, and text
  const filteredLogs = useMemo(
    () =>
      logs.filter((log) => {
        // Filter by level
        const level = normalizeLogLevel(log.level);
        if (!filterSelectionMatches(logLevelFilter, level)) {
          return false;
        }
        // Filter by component
        if (!filterSelectionMatches(componentFilter, log.source ?? '')) {
          return false;
        }
        // Filter by cluster
        const clusterValue = getLogScopeValue(log);
        if (!filterSelectionMatches(clusterFilter, clusterValue, 'exact')) {
          return false;
        }
        return matchesLogSearch(log, textFilter, clusterValue);
      }),
    [clusterFilter, componentFilter, logLevelFilter, logs, textFilter]
  );

  const logRows = useMemo<AppLogRow[]>(
    () =>
      withStableListKeys(filteredLogs, appLogRowKey).map(({ key, value: log }) => ({
        key,
        line: log.message,
        log,
      })),
    [filteredLogs]
  );

  const renderLogRow = useCallback(
    ({ log }: AppLogRow) => (
      <div className={`log-entry ${getLevelClass(log.level)}`}>
        <span className="log-timestamp">{formatTimestamp(log.timestamp)}</span>
        <span className={`log-level ${log.level.toUpperCase()}`}>{log.level}</span>
        <span className="log-source">{log.source ? `[${log.source}]` : ''}</span>
        <span className="log-cluster">[{getLogScopeLabel(log)}]</span>
        <span className="log-message">{log.message}</span>
      </div>
    ),
    [formatTimestamp]
  );

  const showFilteredCount =
    isNarrowingFilterSelection(logLevelFilter) ||
    isNarrowingFilterSelection(componentFilter) ||
    isNarrowingFilterSelection(clusterFilter) ||
    textFilter.trim().length > 0;

  const getScrollPosition = useCallback(() => scrollPositionRef.current, []);
  const setScrollPosition = useCallback((_cacheKey: string, position: LogScrollPosition) => {
    scrollPositionRef.current = position;
  }, []);
  const handleTailFollowingChange = useCallback((following: boolean) => {
    isTailFollowingRef.current = following;
    setIsTailFollowing(following);
  }, []);
  const { resumeTailFollowing } = useLogScrollRestoration({
    rootRef: logsContainerRef,
    isActive: isOpen,
    isParsedView: false,
    rowCount: filteredLogs.length,
    tailFollowSignal: filteredLogs,
    cacheKey: 'app-logs',
    getScrollPosition,
    setScrollPosition,
    onTailFollowingChange: handleTailFollowingChange,
  });

  // Back at the tail, lines held while scrolled up give way to the 10,000-line cap.
  useEffect(() => {
    if (isTailFollowing) {
      setLogs(keepNewestLogs);
    }
  }, [isTailFollowing]);

  const handleResumeScrolling = useCallback(() => {
    if (!autoRefresh) {
      startAutoRefresh();
    }
    resumeTailFollowing();
  }, [autoRefresh, resumeTailFollowing, startAutoRefresh]);

  // Add shortcuts for Application Logs Panel actions.
  useShortcut({
    key: 'r',
    handler: () => {
      if (isOpen) {
        handleToggleAutoRefresh();
        return true;
      }
      return false;
    },
    description: 'Toggle application log auto-refresh',
    category: 'Logs',
    helpOrder: 11,
    enabled: isOpen,
    priority: isOpen ? KeyboardShortcutPriority.APP_LOGS_ACTION : 0,
  });

  useShortcut({
    key: 'c',
    modifiers: { shift: true },
    handler: () => {
      if (isOpen) {
        handleClearAppLogs();
        return true;
      }
      return false;
    },
    description: 'Clear application logs',
    category: 'Logs',
    helpOrder: 71,
    enabled: isOpen,
    priority: isOpen ? KeyboardShortcutPriority.APP_LOGS_ACTION : 0,
  });

  // The shown logs as the Download menu copies or saves them.
  const getDownloadText = useCallback(
    () =>
      filteredLogs
        .map((log) => {
          const timestamp = formatTimestamp(log.timestamp);
          const level = log.level.toUpperCase().padEnd(5);
          const source = log.source ? `[${log.source}] ` : '';
          const clusterPart = `[${getLogScopeLabel(log)}] `;
          return `${timestamp} ${level} ${source}${clusterPart}${log.message}`;
        })
        .join('\n'),
    [filteredLogs, formatTimestamp]
  );
  const { downloadItem } = useLogDownloadMenu({
    getText: getDownloadText,
    fileBase: 'app-logs',
    source: 'AppLogsPanel',
    disabled: filteredLogs.length === 0,
  });

  const appLogsIconBarItems = useMemo<IconBarItem[]>(() => {
    return [
      buildLogAutoRefreshItem(autoRefresh, handleToggleAutoRefresh),
      { type: 'separator' },
      downloadItem,
      {
        type: 'action',
        id: 'clearAppLogs',
        icon: <DeleteIcon width={18} height={18} />,
        onClick: handleClearAppLogs,
        title: 'Clear logs',
        ariaLabel: 'Clear logs',
        disabled: logs.length === 0,
      },
    ];
  }, [autoRefresh, downloadItem, handleClearAppLogs, handleToggleAutoRefresh, logs.length]);

  let renderedLogs: ReactNode;
  if (isLoading) {
    renderedLogs = <LoadingSpinner message="Loading logs..." />;
  } else if (logs.length === 0) {
    renderedLogs = <div className="app-logs-empty">No logs available</div>;
  } else if (filteredLogs.length === 0) {
    renderedLogs = <div className="app-logs-empty">No logs match the selected filter</div>;
  } else {
    renderedLogs = (
      <RawLogViewer
        rows={logRows}
        scrollContainerRef={logsContainerRef}
        wrapText
        renderRow={renderLogRow}
      />
    );
  }

  return (
    <DockablePanel
      panelId="app-logs"
      title="Application Logs"
      isOpen={isOpen}
      defaultPosition="bottom"
      allowMaximize
      maximizeTargetSelector=".content-body"
      onClose={onClose}
      contentClassName="app-logs-panel-content"
    >
      {/* Panel-specific controls toolbar (moved from header for tab support) */}
      <div className="app-logs-panel-toolbar">
        <div className="app-logs-panel-controls">
          <Dropdown
            options={clusterOptions}
            value={filterSelectionToDropdownValues(clusterFilter, clusterOptions, 'exact')}
            onChange={handleClusterDropdownChange}
            multiple
            showBulkActions
            ariaLabel="Filter by cluster"
            renderOption={renderClusterOption}
            renderValue={(value) =>
              multiSelectFilterTriggerLabel(
                'Clusters',
                clusterFilter,
                normalizeDropdownValue(value)
              )
            }
          />

          <Dropdown
            options={componentOptions}
            value={filterSelectionToDropdownValues(componentFilter, componentOptions)}
            onChange={handleComponentDropdownChange}
            multiple
            showBulkActions
            ariaLabel="Filter by component"
            renderOption={renderLogFilterOption}
            renderValue={(value) =>
              multiSelectFilterTriggerLabel(
                'Components',
                componentFilter,
                normalizeDropdownValue(value)
              )
            }
          />

          <Dropdown
            options={LOG_LEVEL_BASE_OPTIONS}
            value={filterSelectionToDropdownValues(logLevelFilter, LOG_LEVEL_BASE_OPTIONS)}
            onChange={handleLogLevelDropdownChange}
            multiple
            showBulkActions
            ariaLabel="Filter by log level"
            renderOption={renderLogFilterOption}
            renderValue={(value) =>
              multiSelectFilterTriggerLabel(
                'Log Levels',
                logLevelFilter,
                normalizeDropdownValue(value)
              )
            }
          />

          <div className="app-logs-filter-group">
            <input
              type="text"
              className="app-logs-text-filter"
              placeholder="Filter"
              value={textFilter}
              onChange={(e) => setTextFilter(e.target.value)}
              title="Filter by text (searches message and source)"
              ref={textFilterInputRef}
            />
            {!!textFilter && (
              <button
                type="button"
                className="app-logs-filter-clear"
                onClick={() => setTextFilter('')}
                title="Clear filter"
                aria-label="Clear filter"
              >
                ×
              </button>
            )}
          </div>

          <IconBar items={appLogsIconBarItems} className="app-logs-action-iconbar" />

          <span className="app-logs-count">
            {showFilteredCount ? `(${filteredLogs.length} / ${logs.length})` : `(${logs.length})`}
          </span>
        </div>
      </div>

      <table
        className="app-logs-header"
        aria-label="Application log columns"
        style={columnWidthStyle}
      >
        <thead>
          <AriaGridRow>
            {renderHeaderCell('timestamp', 'Time', 'log-timestamp')}
            {renderHeaderCell('level', 'Level', 'log-level')}
            {renderHeaderCell('source', 'Source', 'log-source')}
            {renderHeaderCell('cluster', 'Cluster', 'log-cluster')}
            {renderHeaderCell('message', 'Message', 'log-message')}
          </AriaGridRow>
        </thead>
      </table>

      <div className="app-logs-content-frame">
        <ScrollableRegion
          ref={logsContainerRef}
          className="app-logs-container selectable"
          style={columnWidthStyle}
          aria-label="Log output"
        >
          {renderedLogs}
        </ScrollableRegion>
        {!isTailFollowing && <LogResumeScrollingButton onResume={handleResumeScrolling} />}
      </div>
    </DockablePanel>
  );
}

export default AppLogsPanel;
