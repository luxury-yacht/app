/**
 * frontend/src/shared/components/errors/formatErrorForClipboard.test.ts
 *
 * Test suite for formatErrorForClipboard.
 * Covers the plain-text representation copied from error notifications.
 */

import { ErrorCategory, type ErrorDetails, ErrorSeverity } from '@utils/errorHandler';
import { describe, expect, it } from 'vitest';
import { formatErrorForClipboard } from './formatErrorForClipboard';

const baseError = (overrides: Partial<ErrorDetails> = {}): ErrorDetails => ({
  message: 'raw error',
  category: ErrorCategory.NETWORK,
  severity: ErrorSeverity.ERROR,
  timestamp: new Date('2024-01-01T00:00:00.000Z'),
  retryable: false,
  ...overrides,
});

describe('formatErrorForClipboard', () => {
  it('includes category, primary message, technical details, suggestions, and context', () => {
    const text = formatErrorForClipboard(
      baseError({
        userMessage: 'Could not reach the cluster',
        technicalMessage: 'dial tcp 10.0.0.1:443: connection refused',
        suggestions: ['Check your network', 'Verify the kubeconfig'],
        context: { action: 'listPods', clusterId: 'c1' },
      })
    );

    expect(text).toContain('[NETWORK] Could not reach the cluster');
    expect(text).toContain('Technical details:');
    expect(text).toContain('dial tcp 10.0.0.1:443: connection refused');
    expect(text).toContain('Suggestions:');
    expect(text).toContain('- Check your network');
    expect(text).toContain('- Verify the kubeconfig');
    expect(text).toContain('Context:');
    expect(text).toContain('"action": "listPods"');
    expect(text).toContain('"clusterId": "c1"');
  });

  it('falls back to the raw message and omits empty sections', () => {
    const text = formatErrorForClipboard(baseError({ message: 'something broke' }));

    expect(text).toBe('[NETWORK] something broke');
    expect(text).not.toContain('Technical details:');
    expect(text).not.toContain('Suggestions:');
    expect(text).not.toContain('Context:');
  });

  it('omits a technical section that only repeats the primary message', () => {
    const text = formatErrorForClipboard(
      baseError({ userMessage: 'same text', technicalMessage: 'same text' })
    );

    expect(text).toBe('[NETWORK] same text');
  });

  it('omits the context section when it serializes to nothing useful', () => {
    const text = formatErrorForClipboard(
      baseError({
        userMessage: 'retryable failure',
        // retryFn is a function; JSON.stringify drops it, leaving no useful context.
        context: { retryFn: async () => undefined },
      })
    );

    expect(text).toBe('[NETWORK] retryable failure');
    expect(text).not.toContain('Context:');
  });

  it('keeps serializable context keys while dropping function values', () => {
    const text = formatErrorForClipboard(
      baseError({
        userMessage: 'mixed context',
        context: { action: 'retryThing', retryFn: async () => undefined },
      })
    );

    expect(text).toContain('Context:');
    expect(text).toContain('"action": "retryThing"');
    expect(text).not.toContain('retryFn');
  });

  it('does not throw on circular context and simply omits it', () => {
    const circular: Record<string, unknown> = { action: 'loop' };
    circular.self = circular;

    const text = formatErrorForClipboard(
      baseError({ userMessage: 'circular context', context: circular })
    );

    expect(text).toBe('[NETWORK] circular context');
  });
});
