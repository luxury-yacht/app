/**
 * frontend/src/components/content/AppLogsPanel/AppLogsPanel.tsx
 *
 * UI component for AppLogsPanel.
 * Handles rendering and interactions for the shared components.
 */

import { useState, useEffect, useCallback, useRef, useMemo, useLayoutEffect } from 'react';
import { ClearAppLogs, SetAppLogsPanelVisible } from '@wailsjs/go/backend/App';
import { errorHandler } from '@utils/errorHandler';
import LoadingSpinner from '@shared/components/LoadingSpinner';
import { useShortcut, useKeyboardSurface } from '@ui/shortcuts';
import { KeyboardScopePriority, KeyboardShortcutPriority } from '@ui/shortcuts/priorities';
import { DockablePanel } from '@ui/dockable';
import { Dropdown } from '@shared/components/dropdowns/Dropdown';
import IconBar, { type IconBarItem } from '@shared/components/IconBar/IconBar';
import { AutoScrollIcon, CopyIcon } from '@shared/components/icons/LogIcons';
import { DeleteIcon } from '@shared/components/icons/MenuIcons';
import { readAppLogs, readAppLogsSince } from '@/core/app-state-access';
import { subscribeAppLogsAdded, type AppLogsAddedEvent } from '@/core/logging/appLogsClient';
import './AppLogsPanel.css';

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
const ALL_LEVEL_VALUES = LOG_LEVEL_BASE_OPTIONS.map((option) => option.value);
const DEFAULT_LOG_LEVELS = ALL_LEVEL_VALUES;

const findLatestSequence = (entries: LogEntry[], fallback = 0) =>
  entries.reduce(
    (latest, entry) =>
      typeof entry.sequence === 'number' && entry.sequence > latest ? entry.sequence : latest,
    fallback
  );

const buildClusterOption = (log: LogEntry) => {
  const clusterId = log.clusterId?.trim() ?? '';
  const clusterName = log.clusterName?.trim() ?? '';
  const value = clusterId || clusterName;

  if (!value) {
    return null;
  }

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

  const label = fileName && context ? `${fileName}:${context}` : context || value;

  return {
    value,
    label,
    metadata: {
      fileName,
      context,
    },
  };
};

interface AppLogsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

function AppLogsPanel({ isOpen, onClose }: AppLogsPanelProps) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isAutoScroll, setIsAutoScroll] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<'idle' | 'copied' | 'error'>('idle');

  const [logLevelFilter, setLogLevelFilter] = useState<string[]>(DEFAULT_LOG_LEVELS);
  const [componentFilter, setComponentFilter] = useState<string[]>([]);
  const [clusterFilter, setClusterFilter] = useState<string[]>([]);
  const [textFilter, setTextFilter] = useState<string>('');
  const logsContainerRef = useRef<HTMLDivElement>(null);
  const textFilterInputRef = useRef<HTMLInputElement>(null);
  const panelScopeRef = useRef<HTMLDivElement>(null);
  const isPinnedToBottomRef = useRef(true);
  const prevScrollHeightRef = useRef(0);
  const prevScrollTopRef = useRef(0);
  const offsetFromBottomRef = useRef(0);
  const latestSequenceRef = useRef(0);
  const SCROLL_THRESHOLD = 10;

  // Separate ref to track auto-scroll without causing re-renders
  const isAutoScrollRef = useRef(isAutoScroll);

  // Keep backend menu/panel visibility aligned with this panel's open state.
  useEffect(() => {
    SetAppLogsPanelVisible(isOpen).catch((error) => {
      errorHandler.handle(error, { action: 'setAppLogsPanelVisible' });
    });
  }, [isOpen]);

  // Update ref when state changes
  useEffect(() => {
    isAutoScrollRef.current = isAutoScroll;
  }, [isAutoScroll]);

  const updatePinnedState = useCallback(() => {
    const container = logsContainerRef.current;
    if (!container) {
      return;
    }
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    isPinnedToBottomRef.current = distanceFromBottom <= SCROLL_THRESHOLD;
    prevScrollTopRef.current = container.scrollTop;
    prevScrollHeightRef.current = container.scrollHeight;
    offsetFromBottomRef.current = Math.max(distanceFromBottom, 0);
  }, [SCROLL_THRESHOLD]);

  const handleLogsScroll = useCallback(() => {
    updatePinnedState();
  }, [updatePinnedState]);

  useEffect(() => {
    const container = logsContainerRef.current;
    if (!container) {
      return;
    }
    prevScrollHeightRef.current = container.scrollHeight;
    prevScrollTopRef.current = container.scrollTop;
  }, []);

  // Auto-scroll when logs change
  useLayoutEffect(() => {
    const container = logsContainerRef.current;
    if (!container) {
      return;
    }

    const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);

    if (isAutoScroll && isPinnedToBottomRef.current && logs.length > 0) {
      container.scrollTop = maxScrollTop;
      prevScrollTopRef.current = container.scrollTop;
      prevScrollHeightRef.current = container.scrollHeight;
      offsetFromBottomRef.current = 0;
    } else {
      const previousTop = prevScrollTopRef.current;
      const clampedTop = Math.max(0, Math.min(previousTop, maxScrollTop));
      container.scrollTop = clampedTop;
      prevScrollTopRef.current = container.scrollTop;
      prevScrollHeightRef.current = container.scrollHeight;
      offsetFromBottomRef.current = Math.max(
        container.scrollHeight - container.scrollTop - container.clientHeight,
        0
      );
    }
  }, [logs, logLevelFilter, componentFilter, textFilter, isAutoScroll]);

  useEffect(() => {
    if (!isAutoScroll) {
      return;
    }
    updatePinnedState();
  }, [isAutoScroll, updatePinnedState]);

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
        const logEntries = await readAppLogs();
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

        const nextLogs = [...prevLogs, ...newEntries].slice(-1000);
        latestSequenceRef.current = findLatestSequence(nextLogs, latestBeforeAppend);
        return nextLogs;
      });
    } catch (error) {
      errorHandler.handle(error, { action: 'loadLogDeltas' });
    }
  }, []);

  const formatTimestamp = useCallback((timestamp: string) => {
    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
        fractionalSecondDigits: 3,
      } as any);

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

  const handleToggleAutoScroll = useCallback(() => {
    setIsAutoScroll((prev) => !prev);
  }, []);

  const normalizeLevel = useCallback((level: string) => {
    const normalized = level.toLowerCase();
    return normalized === 'warning' ? 'warn' : normalized;
  }, []);

  const handleLogLevelDropdownChange = useCallback((value: string | string[]) => {
    if (!Array.isArray(value)) {
      return;
    }

    setLogLevelFilter(value);
  }, []);

  const renderLogLevelOption = useCallback(
    (option: { value: string; label: string }, isSelected: boolean) => {
      return (
        <span className="dropdown-filter-option">
          <span className="dropdown-filter-check">{isSelected ? '✓' : ''}</span>
          <span className="dropdown-filter-label">{option.label}</span>
        </span>
      );
    },
    []
  );

  const componentNames = useMemo(
    () =>
      Array.from(
        new Set(logs.map((log) => log.source).filter((source): source is string => Boolean(source)))
      ).sort(),
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
    const options: Array<NonNullable<ReturnType<typeof buildClusterOption>>> = [];
    logs.forEach((log) => {
      const option = buildClusterOption(log);
      if (!option || seen.has(option.value)) {
        return;
      }
      seen.add(option.value);
      options.push(option);
    });
    options.sort((left, right) => left.label.localeCompare(right.label));
    return options;
  }, [logs]);

  const clusterValues = useMemo(
    () => clusterOptions.map((option) => option.value),
    [clusterOptions]
  );

  const handleComponentDropdownChange = useCallback((value: string | string[]) => {
    if (!Array.isArray(value)) {
      return;
    }

    setComponentFilter(value);
  }, []);

  useEffect(() => {
    setComponentFilter((prev) => {
      if (prev.length === 0) {
        return prev;
      }

      const validSelections = prev.filter((name) => componentNames.includes(name));
      return validSelections.length === prev.length ? prev : validSelections;
    });
  }, [componentNames]);

  const handleClusterDropdownChange = useCallback((value: string | string[]) => {
    if (!Array.isArray(value)) {
      return;
    }

    setClusterFilter(value);
  }, []);

  useEffect(() => {
    setClusterFilter((prev) => {
      if (prev.length === 0) {
        return prev;
      }

      const validSelections = prev.filter((name) => clusterValues.includes(name));
      return validSelections.length === prev.length ? prev : validSelections;
    });
  }, [clusterValues]);

  const renderComponentOption = useCallback(
    (option: { value: string; label: string }, isSelected: boolean) => {
      return (
        <span className="dropdown-filter-option">
          <span className="dropdown-filter-check">{isSelected ? '✓' : ''}</span>
          <span className="dropdown-filter-label">{option.label}</span>
        </span>
      );
    },
    []
  );

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
        <span className="dropdown-filter-option">
          <span className="dropdown-filter-check">{isSelected ? '✓' : ''}</span>
          {fileName && context ? (
            <span className="app-logs-cluster-label">
              <span className="app-logs-cluster-file">{fileName}</span>
              <span className="app-logs-cluster-separator" aria-hidden="true">
                :
              </span>
              <span className="app-logs-cluster-context">{context}</span>
            </span>
          ) : (
            <span className="dropdown-filter-label">{option.label}</span>
          )}
        </span>
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

    const unsubscribe = subscribeAppLogsAdded(loadLogDeltas);

    return () => {
      clearTimeout(loadTimer);
      unsubscribe();
    };
  }, [isOpen, loadLogDeltas, loadLogs]);

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
    category: 'Application Logs Panel',
    enabled: isOpen,
    priority: isOpen ? KeyboardShortcutPriority.APP_LOGS_ESCAPE : 0,
  });

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

  // Filter logs based on selected level, component, and text
  const filteredLogs = logs.filter((log) => {
    // Filter by level
    const level = normalizeLevel(log.level);
    if (logLevelFilter.length > 0 && !logLevelFilter.includes(level)) {
      return false;
    }
    // Filter by component
    if (componentFilter.length > 0 && !componentFilter.includes(log.source ?? '')) {
      return false;
    }
    // Filter by cluster
    const clusterValue = log.clusterId || log.clusterName || '';
    if (clusterFilter.length > 0 && !clusterFilter.includes(clusterValue)) {
      return false;
    }
    // Filter by text (case-insensitive search in message and source)
    if (textFilter.trim()) {
      const searchText = textFilter.toLowerCase();
      const matchesMessage = log.message.toLowerCase().includes(searchText);
      const matchesSource = log.source?.toLowerCase().includes(searchText) || false;
      const matchesClusterId = log.clusterId?.toLowerCase().includes(searchText) || false;
      const matchesClusterName = log.clusterName?.toLowerCase().includes(searchText) || false;
      if (!matchesMessage && !matchesSource && !matchesClusterId && !matchesClusterName) {
        return false;
      }
    }
    return true;
  });

  const showFilteredCount =
    (logLevelFilter.length > 0 && logLevelFilter.length !== ALL_LEVEL_VALUES.length) ||
    (componentFilter.length > 0 && componentFilter.length !== componentNames.length) ||
    (clusterFilter.length > 0 && clusterFilter.length !== clusterValues.length) ||
    textFilter.trim().length > 0;

  // Add shortcuts for Application Logs Panel actions.
  useShortcut({
    key: 's',
    handler: () => {
      if (isOpen) {
        handleToggleAutoScroll();
        return true;
      }
      return false;
    },
    description: 'Toggle auto-scroll',
    category: 'Application Logs Panel',
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
    description: 'Clear logs',
    category: 'Application Logs Panel',
    enabled: isOpen,
    priority: isOpen ? KeyboardShortcutPriority.APP_LOGS_ACTION : 0,
  });

  const resetCopyFeedback = useCallback(() => {
    window.setTimeout(() => {
      setCopyFeedback('idle');
    }, 1200);
  }, []);

  const handleCopyToClipboard = useCallback(async () => {
    if (filteredLogs.length === 0) {
      setCopyFeedback('error');
      resetCopyFeedback();
      return;
    }

    const formattedLogs = filteredLogs
      .map((log) => {
        const timestamp = formatTimestamp(log.timestamp);
        const level = log.level.toUpperCase().padEnd(5);
        const source = log.source ? `[${log.source}] ` : '';
        const cluster = log.clusterName || log.clusterId;
        const clusterPart = cluster ? `[${cluster}] ` : '';
        return `${timestamp} ${level} ${source}${clusterPart}${log.message}`;
      })
      .join('\n');

    try {
      await navigator.clipboard.writeText(formattedLogs);
      setCopyFeedback('copied');
    } catch (err) {
      setCopyFeedback('error');
      errorHandler.handle(err, { action: 'copyLogs' }, 'Failed to copy logs to clipboard');
    }
    resetCopyFeedback();
  }, [filteredLogs, formatTimestamp, resetCopyFeedback]);

  const appLogsIconBarItems = useMemo<IconBarItem[]>(
    () => [
      {
        type: 'toggle',
        id: 'appLogsAutoScroll',
        icon: <AutoScrollIcon />,
        active: isAutoScroll,
        onClick: handleToggleAutoScroll,
        title: 'Toggle auto-scroll (S)',
        ariaLabel: 'Toggle auto-scroll',
      },
      { type: 'separator' },
      {
        type: 'action',
        id: 'copyAppLogs',
        icon: <CopyIcon />,
        onClick: handleCopyToClipboard,
        title: 'Copy logs to clipboard',
        ariaLabel: 'Copy logs to clipboard',
        disabled: filteredLogs.length === 0,
        feedback: copyFeedback === 'copied' ? 'success' : copyFeedback === 'error' ? 'error' : null,
      },
      {
        type: 'action',
        id: 'clearAppLogs',
        icon: <DeleteIcon />,
        onClick: handleClearAppLogs,
        title: 'Clear logs',
        ariaLabel: 'Clear logs',
        disabled: logs.length === 0,
      },
    ],
    [
      copyFeedback,
      filteredLogs.length,
      handleClearAppLogs,
      handleCopyToClipboard,
      handleToggleAutoScroll,
      isAutoScroll,
      logs.length,
    ]
  );

  const focusFirstControl = useCallback(() => {
    if (textFilterInputRef.current) {
      textFilterInputRef.current.focus();
      return true;
    }
    if (logsContainerRef.current) {
      logsContainerRef.current.focus();
      return true;
    }
    return false;
  }, []);

  const focusLastControl = useCallback(() => {
    if (logsContainerRef.current) {
      logsContainerRef.current.focus();
      return true;
    }
    if (textFilterInputRef.current) {
      textFilterInputRef.current.focus();
      return true;
    }
    return false;
  }, []);

  useKeyboardSurface({
    kind: 'panel',
    rootRef: panelScopeRef,
    active: isOpen,
    captureWhenActive: true,
    priority: KeyboardScopePriority.APP_LOGS_PANEL,
    onKeyDown: (event) => {
      if (event.key !== 'Tab') {
        return false;
      }

      const direction = event.shiftKey ? 'backward' : 'forward';
      const target = event.target as HTMLElement | null;

      if (target && panelScopeRef.current?.contains(target)) {
        if (logsContainerRef.current?.contains(target)) {
          return direction === 'forward' ? false : focusFirstControl();
        }
        return false;
      }

      if (direction === 'forward') {
        return focusFirstControl();
      }
      return focusLastControl();
    },
  });

  return (
    <DockablePanel
      panelRef={panelScopeRef}
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
      <div className="app-logs-panel-toolbar" onMouseDown={(e) => e.stopPropagation()}>
        <div className="app-logs-panel-controls">
          <Dropdown
            options={clusterOptions}
            value={clusterFilter}
            onChange={handleClusterDropdownChange}
            multiple
            size="small"
            showBulkActions
            ariaLabel="Filter by cluster"
            dropdownClassName="dropdown-filter-menu"
            renderOption={renderClusterOption}
            renderValue={() => 'Clusters'}
          />

          <Dropdown
            options={componentOptions}
            value={componentFilter}
            onChange={handleComponentDropdownChange}
            multiple
            size="small"
            showBulkActions
            ariaLabel="Filter by component"
            dropdownClassName="dropdown-filter-menu"
            renderOption={renderComponentOption}
            renderValue={() => 'Components'}
          />

          <Dropdown
            options={LOG_LEVEL_BASE_OPTIONS}
            value={logLevelFilter}
            onChange={handleLogLevelDropdownChange}
            multiple
            size="small"
            showBulkActions
            ariaLabel="Filter by log level"
            dropdownClassName="dropdown-filter-menu"
            renderOption={renderLogLevelOption}
            renderValue={() => 'Log Levels'}
          />

          <div className="app-logs-filter-group">
            <input
              type="text"
              className="app-logs-text-filter"
              placeholder="Filter logs..."
              value={textFilter}
              onChange={(e) => setTextFilter(e.target.value)}
              title="Filter by text (searches message and source)"
              ref={textFilterInputRef}
            />
            {textFilter && (
              <button
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

      <div
        ref={logsContainerRef}
        className="app-logs-container selectable"
        onScroll={handleLogsScroll}
        tabIndex={-1}
      >
        {isLoading ? (
          <LoadingSpinner message="Loading logs..." />
        ) : logs.length === 0 ? (
          <div className="app-logs-empty">No logs available</div>
        ) : filteredLogs.length === 0 ? (
          <div className="app-logs-empty">No logs match the selected filter</div>
        ) : (
          filteredLogs.map((log, index) => (
            <div key={index} className={`log-entry ${getLevelClass(log.level)}`}>
              <span className="log-timestamp">{formatTimestamp(log.timestamp)}</span>
              <span className={`log-level ${log.level.toUpperCase()}`}>{log.level}</span>
              {log.source && <span className="log-source">[{log.source}]</span>}
              {(log.clusterName || log.clusterId) && (
                <span className="log-cluster">[{log.clusterName || log.clusterId}]</span>
              )}
              <span className="log-message">{log.message}</span>
            </div>
          ))
        )}
      </div>
    </DockablePanel>
  );
}

export default AppLogsPanel;
