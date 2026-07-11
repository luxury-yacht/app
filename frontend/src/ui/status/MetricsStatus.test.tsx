/**
 * frontend/src/ui/status/MetricsStatus.test.tsx
 *
 * Verifies the header metrics indicator maps availability state to the right
 * StatusIndicator severity/message — in particular that a permanently disabled
 * poller reads as amber (degraded) with its reason, not a stuck "collecting".
 */

import type { MetricsAvailability, MetricsBannerInfo } from '@shared/utils/metricsAvailability';
import type { ReactNode } from 'react';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let mockMetricsInfo: MetricsAvailability | null = null;
let mockBannerInfo: MetricsBannerInfo | null = null;

vi.mock('@/core/refresh/hooks/useMetricsAvailability', () => ({
  useClusterMetricsAvailability: () => mockMetricsInfo,
}));

vi.mock('@shared/hooks/useMetricsBannerInfo', () => ({
  useMetricsBannerInfo: () => mockBannerInfo,
}));

vi.mock('@shared/components/status/StatusIndicator', () => ({
  __esModule: true,
  default: ({ status, message }: { status: string; message: ReactNode }) => (
    <div data-testid="indicator" data-status={status}>
      {message}
    </div>
  ),
}));

import MetricsStatus from './MetricsStatus';

describe('MetricsStatus', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    mockMetricsInfo = null;
    mockBannerInfo = null;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = () => {
    act(() => {
      root.render(<MetricsStatus />);
    });
    return container.querySelector('[data-testid="indicator"]');
  };

  it('shows amber (degraded) with the reason when metrics are disabled', () => {
    // A DisabledPoller (no metrics permission / metrics-server absent) is a
    // restriction, not an app fault: amber, not alarming red — and never a stuck
    // "Collecting metrics…".
    mockMetricsInfo = {
      disabled: true,
      lastError: 'Insufficient permissions for Metrics API',
      stale: true,
      successCount: 0,
      failureCount: 0,
    };
    mockBannerInfo = {
      message: 'Insufficient permissions for Metrics API',
      tooltip: 'Insufficient permissions for Metrics API',
    };

    const indicator = render();
    expect(indicator?.getAttribute('data-status')).toBe('degraded');
    expect(indicator?.textContent).toContain('Insufficient permissions for Metrics API');
  });

  it('is healthy when there is no banner info', () => {
    mockMetricsInfo = { stale: false, successCount: 3, failureCount: 0 };
    mockBannerInfo = null;

    const indicator = render();
    expect(indicator?.getAttribute('data-status')).toBe('healthy');
  });

  it('is inactive when no metrics payload has arrived', () => {
    mockMetricsInfo = null;
    mockBannerInfo = null;

    const indicator = render();
    expect(indicator?.getAttribute('data-status')).toBe('inactive');
  });
});
