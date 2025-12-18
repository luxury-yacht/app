import React, { useEffect, useState } from 'react';
import { refreshOrchestrator } from '@/core/refresh';
import { useClusterMetricsAvailability } from '@/core/refresh/hooks/useMetricsAvailability';
import { useConnectionStatus } from '@/core/connection/connectionStatus';
import { eventBus } from '@/core/events';
import './RefreshStatusIndicator.css';

const RefreshStatusIndicator: React.FC = () => {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const connectionStatus = useConnectionStatus();
  const metricsInfo = useClusterMetricsAvailability();

  useEffect(() => {
    // Check initial state from localStorage
    const stored = localStorage.getItem('autoRefreshEnabled');
    setIsPaused(stored === 'false');

    const handleRefreshStart = () => setIsRefreshing(true);
    const handleRefreshComplete = () => setIsRefreshing(false);

    // Listen for settings changes
    const handleStorageChange = () => {
      const enabled = localStorage.getItem('autoRefreshEnabled') !== 'false';
      setIsPaused(!enabled);
    };

    const unsubStart = eventBus.on('refresh:start', handleRefreshStart);
    const unsubComplete = eventBus.on('refresh:complete', handleRefreshComplete);
    const unsubAutoRefresh = eventBus.on('settings:auto-refresh', (enabled) => {
      setIsPaused(!enabled);
    });
    window.addEventListener('storage', handleStorageChange);

    return () => {
      unsubStart();
      unsubComplete();
      unsubAutoRefresh();
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  const metricsUnavailable = Boolean(metricsInfo?.stale) || Boolean(metricsInfo?.lastError);
  const metricsTooltip = metricsInfo?.lastError
    ? metricsInfo.lastError
    : metricsUnavailable
      ? 'Metrics API unavailable'
      : 'Metrics are up to date';

  const isConnectionRestricted = ['offline', 'auth_failed', 'rebuilding'].includes(
    connectionStatus.state
  );
  const manualRefreshDisabled = isPaused || isConnectionRestricted;

  const getStatusClass = () => {
    if (isPaused) return 'status-disabled';
    if (connectionStatus.state === 'offline') return 'status-offline';
    if (connectionStatus.state === 'auth_failed') return 'status-auth';
    if (connectionStatus.state === 'rebuilding') return 'status-rebuilding';
    if (connectionStatus.state === 'retrying') return 'status-retrying';
    if (isRefreshing) return 'status-refreshing';
    return 'status-active';
  };

  const formatRetryHint = () => {
    if (!connectionStatus.nextRetryMs) {
      return undefined;
    }
    const seconds = Math.max(1, Math.round(connectionStatus.nextRetryMs / 1000));
    return `Retrying in ${seconds}s`;
  };

  const getTooltipText = () => {
    if (isPaused) {
      return 'Auto-refresh paused';
    }
    const pieces = [
      connectionStatus.label,
      connectionStatus.message !== connectionStatus.label ? connectionStatus.message : undefined,
      connectionStatus.state === 'retrying' ? formatRetryHint() : undefined,
      manualRefreshDisabled ? 'Manual refresh unavailable' : 'Click to refresh now (⌘R)',
    ];
    return pieces.filter(Boolean).join(' • ');
  };

  const handleClick = () => {
    if (manualRefreshDisabled) {
      return;
    }
    void refreshOrchestrator.triggerManualRefreshForContext();
  };

  return (
    <div className="refresh-status-wrapper">
      <div
        className={`refresh-status-indicator ${getStatusClass()}`}
        title={getTooltipText()}
        onClick={handleClick}
        style={{ cursor: manualRefreshDisabled ? 'default' : 'pointer' }}
      >
        <div className="status-dot"></div>
      </div>
      {metricsUnavailable && (
        <div className="metrics-status-indicator" title={metricsTooltip}>
          <div className="status-dot"></div>
        </div>
      )}
    </div>
  );
};

export default RefreshStatusIndicator;
