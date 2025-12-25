/**
 * frontend/src/utils/emptyState.test.ts
 *
 * Test suite for emptyState.
 * Covers key behaviors and edge cases for emptyState.
 */

import { describe, expect, it } from 'vitest';
import { resolveEmptyStateMessage } from './emptyState';

describe('resolveEmptyStateMessage', () => {
  it('returns fallback when no error is provided', () => {
    expect(resolveEmptyStateMessage(undefined, 'fallback')).toBe('fallback');
    expect(resolveEmptyStateMessage(null)).toBe('No data available');
  });

  it('returns fallback for non-permission errors', () => {
    expect(resolveEmptyStateMessage('internal server error', 'fallback')).toBe('fallback');
    expect(resolveEmptyStateMessage('network timeout')).toBe('No data available');
  });

  it('normalizes permission related errors', () => {
    const permissionErrors = [
      'Forbidden',
      'access denied to resource',
      'unauthorized operation',
      'cannot list resource',
      'RBAC: cannot get resource',
      '403 response',
      'not authorized',
    ];

    permissionErrors.forEach((message) => {
      expect(resolveEmptyStateMessage(message, 'fallback')).toBe('Insufficient permissions');
    });
  });
});
