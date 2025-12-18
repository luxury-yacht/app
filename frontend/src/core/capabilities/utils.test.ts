import { describe, expect, it } from 'vitest';

import { computeCapabilityState } from './utils';
import type { CapabilityEntry } from './types';

const makeEntry = (overrides: Partial<CapabilityEntry>): CapabilityEntry => ({
  key: 'test|verb|ns|name|subresource|id',
  request: {
    id: 'id',
    verb: 'get',
    resourceKind: 'Pod',
    namespace: 'default',
    name: 'demo',
    subresource: undefined,
  },
  status: 'idle',
  error: null,
  result: undefined,
  lastFetched: undefined,
  ...overrides,
});

describe('computeCapabilityState', () => {
  it('treats missing entries as pending', () => {
    const state = computeCapabilityState(undefined);
    expect(state.allowed).toBe(false);
    expect(state.pending).toBe(true);
    expect(state.status).toBe('idle');
    expect(state.reason).toBeUndefined();
  });

  it('flags loading entries as pending', () => {
    const entry = makeEntry({ status: 'loading' });
    const state = computeCapabilityState(entry);
    expect(state.allowed).toBe(false);
    expect(state.pending).toBe(true);
    expect(state.status).toBe('loading');
    expect(state.reason).toBeUndefined();
  });

  it('returns allowed for ready entries with allowed result', () => {
    const entry = makeEntry({
      status: 'ready',
      result: {
        id: 'id',
        verb: 'get',
        resourceKind: 'Pod',
        allowed: true,
      },
    });
    const state = computeCapabilityState(entry);
    expect(state.allowed).toBe(true);
    expect(state.pending).toBe(false);
    expect(state.reason).toBeUndefined();
  });

  it('carries denied reason for ready entries that are not allowed', () => {
    const entry = makeEntry({
      status: 'ready',
      result: {
        id: 'id',
        verb: 'update',
        resourceKind: 'Deployment',
        allowed: false,
        deniedReason: 'forbidden',
      },
    });
    const state = computeCapabilityState(entry);
    expect(state.allowed).toBe(false);
    expect(state.pending).toBe(false);
    expect(state.reason).toBe('forbidden');
  });

  it('surfaces evaluation errors as the reason when present', () => {
    const entry = makeEntry({
      status: 'ready',
      result: {
        id: 'id',
        verb: 'update',
        resourceKind: 'Deployment',
        allowed: false,
        evaluationError: 'ssar unavailable',
      },
    });
    const state = computeCapabilityState(entry);
    expect(state.allowed).toBe(false);
    expect(state.reason).toBe('ssar unavailable');
  });

  it('returns error state when entry recorded an error', () => {
    const entry = makeEntry({ status: 'error', error: 'cluster unreachable' });
    const state = computeCapabilityState(entry);
    expect(state.allowed).toBe(false);
    expect(state.pending).toBe(false);
    expect(state.status).toBe('error');
    expect(state.reason).toBe('cluster unreachable');
  });
});
