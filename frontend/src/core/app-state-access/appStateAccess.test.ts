import { describe, expect, it, vi } from 'vitest';
import {
  getBrokerReadDiagnosticsSnapshot,
  resetBrokerReadDiagnosticsForTesting,
} from '@/core/read-diagnostics';

import { requestAppState } from './appStateAccess';

describe('appStateAccess', () => {
  it('records diagnostics for app-state reads', async () => {
    resetBrokerReadDiagnosticsForTesting();

    await requestAppState({
      resource: 'app-info',
      adapter: 'rpc-read',
      read: vi.fn().mockResolvedValue({ version: '1.0.0' }),
    });

    expect(getBrokerReadDiagnosticsSnapshot()).toEqual([
      expect.objectContaining({
        broker: 'app-state-access',
        resource: 'app-info',
        adapter: 'rpc-read',
        successCount: 1,
        lastStatus: 'success',
      }),
    ]);
  });

  it('executes app-state reads through the shared request path', async () => {
    resetBrokerReadDiagnosticsForTesting();
    const read = vi.fn().mockResolvedValue({ version: '1.0.0' });

    await expect(
      requestAppState({
        resource: 'app-info',
        read,
      })
    ).resolves.toEqual({ version: '1.0.0' });

    expect(read).toHaveBeenCalledTimes(1);
  });
});
