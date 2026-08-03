import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const telemetryMocks = vi.hoisted(() => ({
  recordBrokerRequestCompleted: vi.fn(),
  recordBrokerRequestStarted: vi.fn(),
}));

vi.mock('@/core/telemetry/sentry', () => telemetryMocks);

import { beginBrokerRead, completeBrokerRead, resetBrokerReadDiagnosticsForTesting } from './store';

describe('broker read telemetry correlation', () => {
  beforeEach(() => {
    resetBrokerReadDiagnosticsForTesting();
    telemetryMocks.recordBrokerRequestStarted.mockReset();
    telemetryMocks.recordBrokerRequestCompleted.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('publishes the same request token and measured duration at start and failure', () => {
    const error = new Error('failed');
    const request = {
      broker: 'data-access' as const,
      resource: 'pods',
      adapter: 'refresh-domain' as const,
      reason: 'user' as const,
      label: 'refresh pods',
      scope: 'cluster-a',
    };

    const token = beginBrokerRead(request);
    vi.setSystemTime(1_042);
    completeBrokerRead({ token, status: 'error', error });

    expect(telemetryMocks.recordBrokerRequestStarted).toHaveBeenCalledWith({
      id: 'broker-read-1',
      ...request,
    });
    expect(telemetryMocks.recordBrokerRequestCompleted).toHaveBeenCalledWith(
      { id: 'broker-read-1', ...request },
      { status: 'error', durationMs: 42, error }
    );
  });
});
