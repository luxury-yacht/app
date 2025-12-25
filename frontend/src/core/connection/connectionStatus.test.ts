/**
 * frontend/src/core/connection/connectionStatus.test.ts
 *
 * Tests for connection status context helpers.
 */
import { describe, it, expect } from 'vitest';
import {
  getDefaultConnectionStatus,
  mapConnectionStatusEvent,
  ConnectionStatusEvent,
} from './connectionStatus';

describe('connectionStatus helpers', () => {
  it('falls back to default label/message when fields missing', () => {
    const event: ConnectionStatusEvent = { state: 'offline' };
    const status = mapConnectionStatusEvent(event);

    expect(status.state).toBe('offline');
    expect(status.label).toBe(getDefaultConnectionStatus().label);
    expect(status.message).toBe(getDefaultConnectionStatus().label);
    expect(status.updatedAt).toBeGreaterThan(0);
  });

  it('carries custom metadata and retry timing', () => {
    const event: ConnectionStatusEvent = {
      state: 'retrying',
      label: 'Retrying',
      message: 'Retrying workloads',
      description: 'Transient failure',
      nextRetryMs: 2500,
      updatedAt: 12345,
    };
    const status = mapConnectionStatusEvent(event);
    expect(status.state).toBe('retrying');
    expect(status.label).toBe('Retrying');
    expect(status.message).toBe('Retrying workloads');
    expect(status.description).toBe('Transient failure');
    expect(status.nextRetryMs).toBe(2500);
    expect(status.updatedAt).toBe(12345);
  });
});
