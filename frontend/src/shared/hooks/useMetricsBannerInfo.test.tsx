import type { MetricsAvailability, MetricsBannerInfo } from '@shared/utils/metricsAvailability';
import type React from 'react';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMetricsBannerInfo } from './useMetricsBannerInfo';

describe('useMetricsBannerInfo', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  let latestBanner: MetricsBannerInfo | null;

  const Probe: React.FC<{ metrics: MetricsAvailability | null }> = ({ metrics }) => {
    latestBanner = useMetricsBannerInfo(metrics);
    return null;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    latestBanner = null;
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
  });

  const render = (metrics: MetricsAvailability | null) => {
    act(() => {
      root.render(<Probe metrics={metrics} />);
    });
  };

  it('flips the banner to stale at the payload threshold with NO new payload', () => {
    // A dead metrics-server on a quiet cluster produces no doorbell and no
    // refetch, so this flip must come from the client clock alone.
    const metrics: MetricsAvailability = {
      stale: false,
      collectedAt: Math.floor(Date.now() / 1000),
      staleAfterSeconds: 45,
      successCount: 3,
      failureCount: 0,
    };
    render(metrics);
    expect(latestBanner).toBeNull();

    act(() => {
      vi.advanceTimersByTime(46_000);
    });
    expect(latestBanner).not.toBeNull();
    expect(latestBanner?.message).toContain('Awaiting metrics data');
  });

  it('keeps a fresh payload banner-free before the threshold', () => {
    const metrics: MetricsAvailability = {
      stale: false,
      collectedAt: Math.floor(Date.now() / 1000),
      staleAfterSeconds: 45,
      successCount: 3,
      failureCount: 0,
    };
    render(metrics);
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(latestBanner).toBeNull();
  });

  it('a fresh payload replacing a stale one clears the banner', () => {
    const collected = Math.floor(Date.now() / 1000);
    render({ stale: false, collectedAt: collected, staleAfterSeconds: 45, successCount: 3 });
    act(() => {
      vi.advanceTimersByTime(46_000);
    });
    expect(latestBanner).not.toBeNull();

    // The next collection's payload arrives (doorbell refetch): fresh again.
    render({
      stale: false,
      collectedAt: collected + 46,
      staleAfterSeconds: 45,
      successCount: 4,
    });
    expect(latestBanner).toBeNull();
  });

  it('honors server-computed stale immediately', () => {
    render({ stale: true, collectedAt: 100, successCount: 3 });
    expect(latestBanner?.message).toContain('Awaiting metrics data');
  });

  it('payloads without staleAfterSeconds keep server-stale-only behavior (no client flip)', () => {
    // cluster-overview is poll-refreshed: its payload carries no threshold and
    // its server-side stale flag refreshes every poll.
    render({ stale: false, collectedAt: Math.floor(Date.now() / 1000), successCount: 3 });
    act(() => {
      vi.advanceTimersByTime(600_000);
    });
    expect(latestBanner).toBeNull();
  });

  it('reports null for missing metrics', () => {
    render(null);
    expect(latestBanner).toBeNull();
  });
});
