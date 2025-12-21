import { useState, useEffect, useCallback, useRef, useMemo, useLayoutEffect } from 'react';
import { GetLogs, ClearLogs } from '@wailsjs/go/backend/App';
import { errorHandler } from '@utils/errorHandler';
import LoadingSpinner from '@shared/components/LoadingSpinner';
import { useShortcut, useKeyboardNavigationScope } from '@ui/shortcuts';
import { KeyboardScopePriority, KeyboardShortcutPriority } from '@ui/shortcuts/priorities';
import { DockablePanel, useDockablePanelState } from '@/components/dockable';
import { Dropdown } from '@shared/components/dropdowns/Dropdown';
import './AppLogsPanel.css';

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  source?: string;
}

const LOG_LEVEL_SELECT_ALL_VALUE = '__log_levels_all__';
const LOG_LEVEL_BASE_OPTIONS = [
  { value: 'info', label: 'Info' },
  { value: 'warn', label: 'Warning' },
  { value: 'error', label: 'Error' },
  { value: 'debug', label: 'Debug' },
];
const LOG_LEVEL_OPTIONS = [
  { value: LOG_LEVEL_SELECT_ALL_VALUE, label: 'Select All' },
  ...LOG_LEVEL_BASE_OPTIONS,
];
const ALL_LEVEL_VALUES = LOG_LEVEL_BASE_OPTIONS.map((option) => option.value);
const DEFAULT_LOG_LEVELS = ['info', 'warn', 'error'];

export function useAppLogsPanel() {
  const panelState = useDockablePanelState('app-logs');
  return panelState;
}

function AppLogsPanel() {
  const panelState = useAppLogsPanel();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isAutoScroll, setIsAutoScroll] = useState(true);
  const [isLoading, setIsLoading] = useState(false);

  const [logLevelFilter, setLogLevelFilter] = useState<string[]>(DEFAULT_LOG_LEVELS);
  const [componentFilter, setComponentFilter] = useState<string[]>([]);
  const [textFilter, setTextFilter] = useState<string>('');
  const logsContainerRef = useRef<HTMLDivElement>(null);
  const textFilterInputRef = useRef<HTMLInputElement>(null);
  const panelScopeRef = useRef<HTMLDivElement>(null);
  const isPinnedToBottomRef = useRef(true);
  const prevScrollHeightRef = useRef(0);
  const prevScrollTopRef = useRef(0);
  const offsetFromBottomRef = useRef(0);
  const SCROLL_THRESHOLD = 10;

  // Separate ref to track auto-scroll without causing re-renders
  const isAutoScrollRef = useRef(isAutoScroll);

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

  const loadLogs = useCallback(async (showLoadingSpinner = false) => {
    try {
      // Only show loading spinner on initial load or when explicitly requested
      if (showLoadingSpinner) {
        setIsLoading(true);
      }
      const logEntries = await GetLogs();
      setLogs(logEntries);
    } catch (error) {
      errorHandler.handle(error, { action: 'loadLogs' });
    } finally {
      if (showLoadingSpinner) {
        setIsLoading(false);
      }
    }
  }, []); // No dependencies - use refs instead

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

  const handleClearLogs = useCallback(async () => {
    try {
      await ClearLogs();
      setLogs([]);
    } catch (error) {
      errorHandler.handle(error, { action: 'clearLogs' });
    }
  }, []);

  const normalizeLevel = useCallback((level: string) => {
    const normalized = level.toLowerCase();
    return normalized === 'warning' ? 'warn' : normalized;
  }, []);

  const handleLogLevelDropdownChange = useCallback(
    (value: string | string[]) => {
      if (!Array.isArray(value)) {
        return;
      }

      if (value.includes(LOG_LEVEL_SELECT_ALL_VALUE)) {
        if (logLevelFilter.length === ALL_LEVEL_VALUES.length) {
          setLogLevelFilter([]);
        } else {
          setLogLevelFilter(ALL_LEVEL_VALUES);
        }
        return;
      }

      setLogLevelFilter(value.filter((item) => item !== LOG_LEVEL_SELECT_ALL_VALUE));
    },
    [ALL_LEVEL_VALUES, logLevelFilter]
  );

  const renderLogLevelOption = useCallback(
    (option: { value: string; label: string }, isSelected: boolean) => {
      const isSelectAll = option.value === LOG_LEVEL_SELECT_ALL_VALUE;
      const checked = isSelectAll ? logLevelFilter.length === ALL_LEVEL_VALUES.length : isSelected;
      return (
        <span className="dropdown-filter-option">
          <span className="dropdown-filter-check">{checked ? '✓' : ''}</span>
          <span className="dropdown-filter-label">{option.label}</span>
        </span>
      );
    },
    [ALL_LEVEL_VALUES, logLevelFilter]
  );

  const componentNames = useMemo(
    () =>
      Array.from(
        new Set(logs.map((log) => log.source).filter((source): source is string => Boolean(source)))
      ).sort(),
    [logs]
  );

  const COMPONENT_SELECT_ALL_VALUE = '__components_all__';
  const componentOptions = useMemo(
    () => [
      { value: COMPONENT_SELECT_ALL_VALUE, label: 'Select All' },
      ...componentNames.map((component) => ({
        value: component,
        label: component,
      })),
    ],
    [componentNames]
  );

  const handleComponentDropdownChange = useCallback(
    (value: string | string[]) => {
      if (!Array.isArray(value)) {
        return;
      }

      if (value.includes(COMPONENT_SELECT_ALL_VALUE)) {
        if (componentFilter.length === componentNames.length) {
          setComponentFilter([]);
        } else {
          setComponentFilter(componentNames);
        }
        return;
      }

      setComponentFilter(value.filter((item) => item !== COMPONENT_SELECT_ALL_VALUE));
    },
    [componentFilter, componentNames]
  );

  useEffect(() => {
    setComponentFilter((prev) => {
      if (prev.length === 0) {
        return prev;
      }

      const validSelections = prev.filter((name) => componentNames.includes(name));
      return validSelections.length === prev.length ? prev : validSelections;
    });
  }, [componentNames]);

  const renderComponentOption = useCallback(
    (option: { value: string; label: string }, isSelected: boolean) => {
      const isSelectAll = option.value === COMPONENT_SELECT_ALL_VALUE;
      const checked = isSelectAll ? componentFilter.length === componentNames.length : isSelected;
      return (
        <span className="dropdown-filter-option">
          <span className="dropdown-filter-check">{checked ? '✓' : ''}</span>
          <span className="dropdown-filter-label">{option.label}</span>
        </span>
      );
    },
    [componentFilter, componentNames]
  );

  const handleCopyToClipboard = useCallback(() => {
    // Filter logs the same way as the display
    const logsToCopy = logs.filter((log) => {
      // Filter by level
      const logLevel = normalizeLevel(log.level);
      if (logLevelFilter.length > 0 && !logLevelFilter.includes(logLevel)) {
        return false;
      }
      // Filter by component
      if (componentFilter.length > 0 && !componentFilter.includes(log.source ?? '')) {
        return false;
      }
      // Filter by text (case-insensitive search in message and source)
      if (textFilter.trim()) {
        const searchText = textFilter.toLowerCase();
        const matchesMessage = log.message.toLowerCase().includes(searchText);
        const matchesSource = log.source?.toLowerCase().includes(searchText) || false;
        if (!matchesMessage && !matchesSource) {
          return false;
        }
      }
      return true;
    });

    // Format logs for clipboard
    const formattedLogs = logsToCopy
      .map((log) => {
        const timestamp = formatTimestamp(log.timestamp);
        const level = log.level.toUpperCase().padEnd(5);
        const source = log.source ? `[${log.source}] ` : '';
        return `${timestamp} ${level} ${source}${log.message}`;
      })
      .join('\n');

    // Copy to clipboard
    navigator.clipboard
      .writeText(formattedLogs)
      .then(() => {
        // Logs copied to clipboard successfully
      })
      .catch((err) => {
        errorHandler.handle(err, { action: 'copyLogs' }, 'Failed to copy logs to clipboard');
      });
  }, [logs, logLevelFilter, componentFilter, textFilter, formatTimestamp, normalizeLevel]);

  // Load logs when panel becomes visible
  useEffect(() => {
    if (!panelState.isOpen) {
      return;
    }

    // Wait for opening animation to complete (300ms) before loading logs
    const loadTimer = setTimeout(() => {
      loadLogs(true); // Show spinner on initial load
    }, 300);

    // Listen for real-time log events from backend
    const handleLogAdded = () => {
      loadLogs(); // No spinner for real-time updates
    };

    const runtime = window.runtime;
    if (runtime?.EventsOn) {
      runtime.EventsOn('log-added', handleLogAdded);
    }

    return () => {
      clearTimeout(loadTimer);
      runtime?.EventsOff?.('log-added');
    };
  }, [panelState.isOpen, loadLogs]);

  // ESC key to close panel
  useShortcut({
    key: 'Escape',
    handler: () => {
      if (panelState.isOpen) {
        panelState.setOpen(false);
        return true;
      }
      return false;
    },
    description: 'Close app logs panel',
    category: 'App Logs',
    enabled: panelState.isOpen,
    view: 'global',
    priority: panelState.isOpen ? KeyboardShortcutPriority.APP_LOGS_ESCAPE : 0,
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
    // Filter by text (case-insensitive search in message and source)
    if (textFilter.trim()) {
      const searchText = textFilter.toLowerCase();
      const matchesMessage = log.message.toLowerCase().includes(searchText);
      const matchesSource = log.source?.toLowerCase().includes(searchText) || false;
      if (!matchesMessage && !matchesSource) {
        return false;
      }
    }
    return true;
  });

  const showFilteredCount =
    (logLevelFilter.length > 0 && logLevelFilter.length !== ALL_LEVEL_VALUES.length) ||
    (componentFilter.length > 0 && componentFilter.length !== componentNames.length) ||
    textFilter.trim().length > 0;

  // Add shortcuts for logs panel (only visible when panel is open)
  useShortcut({
    key: 's',
    handler: () => {
      if (panelState.isOpen) {
        setIsAutoScroll((prev) => !prev);
        return true;
      }
      return false;
    },
    description: 'Toggle auto-scroll',
    category: 'Logs Panel',
    enabled: panelState.isOpen, // Only show in help when logs panel is open
    view: 'global',
    priority: panelState.isOpen ? KeyboardShortcutPriority.APP_LOGS_ACTION : 0,
  });

  useShortcut({
    key: 'c',
    modifiers: { shift: true },
    handler: () => {
      if (panelState.isOpen) {
        handleClearLogs();
        return true;
      }
      return false;
    },
    description: 'Clear logs',
    category: 'Logs Panel',
    enabled: panelState.isOpen, // Only show in help when logs panel is open
    view: 'global',
    priority: panelState.isOpen ? KeyboardShortcutPriority.APP_LOGS_ACTION : 0,
  });

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

  useKeyboardNavigationScope({
    ref: panelScopeRef,
    priority: KeyboardScopePriority.APP_LOGS_PANEL,
    disabled: !panelState.isOpen,
    allowNativeSelector: '.app-logs-panel-controls *',
    onNavigate: ({ direction, event }) => {
      const target = event.target as HTMLElement | null;
      if (target && panelScopeRef.current?.contains(target)) {
        if (logsContainerRef.current?.contains(target)) {
          return direction === 'forward' ? 'bubble' : focusFirstControl() ? 'handled' : 'bubble';
        }
        return 'native';
      }
      if (direction === 'forward') {
        return focusFirstControl() ? 'handled' : 'bubble';
      }
      return focusLastControl() ? 'handled' : 'bubble';
    },
    onEnter: ({ direction }) => {
      if (direction === 'forward') {
        focusFirstControl();
      } else {
        focusLastControl();
      }
    },
  });

  return (
    <DockablePanel
      panelRef={panelScopeRef}
      panelId="app-logs"
      title="Application Logs"
      isOpen={panelState.isOpen}
      defaultPosition="bottom"
      defaultSize={{ width: 800, height: 300 }}
      minWidth={950}
      minHeight={150}
      maxHeight={600}
      allowMaximize
      maximizeTargetSelector=".content-body"
      onClose={() => panelState.setOpen(false)}
      headerContent={
        <div className="app-logs-panel-header-content">
          <div className="app-logs-panel-title">
            <h3>Application Logs</h3>
            <span className="app-logs-count">
              {showFilteredCount ? `(${filteredLogs.length} / ${logs.length})` : `(${logs.length})`}
            </span>
          </div>

          <div className="app-logs-panel-controls" onMouseDown={(e) => e.stopPropagation()}>
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

            <Dropdown
              options={LOG_LEVEL_OPTIONS}
              value={logLevelFilter}
              onChange={handleLogLevelDropdownChange}
              multiple
              size="small"
              ariaLabel="Filter by log level"
              dropdownClassName="dropdown-filter-menu"
              renderOption={renderLogLevelOption}
              renderValue={() => 'Log Levels'}
            />

            <Dropdown
              options={componentOptions}
              value={componentFilter}
              onChange={handleComponentDropdownChange}
              multiple
              size="small"
              ariaLabel="Filter by component"
              dropdownClassName="dropdown-filter-menu"
              renderOption={renderComponentOption}
              renderValue={() => 'Components'}
            />

            <label className="app-logs-auto-scroll">
              <input
                type="checkbox"
                checked={isAutoScroll}
                onChange={(e) => setIsAutoScroll(e.target.checked)}
              />
              Auto-scroll
            </label>

            <button
              className="app-logs-button"
              onClick={handleCopyToClipboard}
              title="Copy logs to clipboard"
            >
              Copy
            </button>

            <button className="app-logs-button" onClick={handleClearLogs} title="Clear logs">
              Clear
            </button>
          </div>
        </div>
      }
      contentClassName="app-logs-panel-content"
    >
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
              <span className="log-message">{log.message}</span>
            </div>
          ))
        )}
      </div>
    </DockablePanel>
  );
}

export default AppLogsPanel;
