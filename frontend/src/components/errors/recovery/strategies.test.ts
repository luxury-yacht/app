/**
 * frontend/src/components/errors/recovery/strategies.test.ts
 *
 * Test suite for strategies.
 * Covers key behaviors and edge cases for strategies.
 */

import { describe, expect, it } from 'vitest';

import {
  canAutoRecover,
  getRecoveryMessage,
  getRecoveryStrategy,
  shouldLogToServer,
} from './strategies';
import { RecoveryStrategy } from '../types';

describe('error recovery strategies', () => {
  it('classifies common failure patterns', () => {
    expect(getRecoveryStrategy(new Error('Network timeout while fetching data'))).toBe(
      RecoveryStrategy.RETRY
    );
    expect(getRecoveryStrategy(new Error('Loading chunk 12 failed'))).toBe(RecoveryStrategy.RELOAD);
    expect(getRecoveryStrategy(new Error('403 Forbidden: permission denied'))).toBe(
      RecoveryStrategy.FATAL
    );
    expect(getRecoveryStrategy(new Error('Unexpected panel failure'), 'panel-sidecar')).toBe(
      RecoveryStrategy.DEGRADE
    );
    expect(getRecoveryStrategy(new Error('Table renderer blew up'), 'resource-table')).toBe(
      RecoveryStrategy.REFRESH
    );
    expect(getRecoveryStrategy(new Error('Failed to load kubeconfigs'))).toBe(
      RecoveryStrategy.RESET
    );
  });

  it('provides user-facing guidance strings', () => {
    expect(getRecoveryMessage(RecoveryStrategy.RETRY)).toMatch(/try again/i);
    expect(getRecoveryMessage(RecoveryStrategy.RELOAD)).toMatch(/reload/i);
    expect(getRecoveryMessage(RecoveryStrategy.FATAL)).toMatch(/critical/i);
  });

  it('indicates which strategies support automatic recovery', () => {
    expect(canAutoRecover(RecoveryStrategy.RETRY)).toBe(true);
    expect(canAutoRecover(RecoveryStrategy.REFRESH)).toBe(true);
    expect(canAutoRecover(RecoveryStrategy.RESET)).toBe(true);
    expect(canAutoRecover(RecoveryStrategy.RELOAD)).toBe(false);
    expect(canAutoRecover(RecoveryStrategy.FATAL)).toBe(false);
  });

  it('logs important errors back to the server', () => {
    expect(shouldLogToServer(new Error('Forbidden'), RecoveryStrategy.FATAL)).toBe(true);
    expect(shouldLogToServer(new Error('Loading chunk 7 failed'), RecoveryStrategy.RELOAD)).toBe(
      true
    );
    expect(shouldLogToServer(new Error('Minor issue'), RecoveryStrategy.RETRY)).toBe(false);
  });
});
