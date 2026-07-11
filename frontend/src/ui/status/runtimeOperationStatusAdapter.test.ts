import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  normalizePortForwardSession,
  normalizePortForwardStatusEvent,
  type PortForwardStatus,
  parsePortForwardStatus,
} from './runtimeOperationStatusAdapter';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parsePortForwardStatus', () => {
  const known: PortForwardStatus[] = ['connecting', 'active', 'reconnecting', 'error', 'stopped'];

  it('passes every known backend status through unchanged', () => {
    for (const status of known) {
      expect(parsePortForwardStatus(status)).toBe(status);
    }
  });

  it('falls back to "connecting" for an unrecognized status', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(parsePortForwardStatus('bogus-status')).toBe('connecting');
  });

  it('logs an unrecognized status at most once per distinct value', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    parsePortForwardStatus('mystery-state');
    parsePortForwardStatus('mystery-state');
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('normalizePortForwardSession', () => {
  const rawSession = {
    id: 'pf-1',
    clusterId: 'cluster-a',
    clusterName: 'Cluster A',
    namespace: 'default',
    podName: 'web',
    containerPort: 8080,
    localPort: 18080,
    status: 'active',
    startedAt: '2026-05-18T00:00:00Z',
  };

  it('keeps a known status as the typed union value', () => {
    expect(normalizePortForwardSession(rawSession).status).toBe('active');
  });

  it('coerces an unrecognized status to the fallback', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(normalizePortForwardSession({ ...rawSession, status: 'weird-pf' }).status).toBe(
      'connecting'
    );
  });
});

describe('normalizePortForwardStatusEvent', () => {
  const rawEvent = {
    sessionId: 'pf-1',
    status: 'reconnecting',
    statusReason: 'pod replaced',
    localPort: 18081,
    podName: 'web-replacement',
  };

  it('keeps a known status as the typed union value', () => {
    expect(normalizePortForwardStatusEvent(rawEvent).status).toBe('reconnecting');
  });

  it('coerces an unrecognized status to the fallback', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(normalizePortForwardStatusEvent({ ...rawEvent, status: 'huh' }).status).toBe(
      'connecting'
    );
  });
});
