/**
 * frontend/src/utils/emptyState.test.ts
 *
 * Test suite for emptyState.
 * Covers key behaviors and edge cases for emptyState.
 */

import { describe, expect, it } from 'vitest';
import type { RefreshFailure } from '@/core/refresh/refreshFailure';
import { makeErrorStatus } from '@/test-utils/errorStatusFixtures';
import { resolveEmptyStateMessage } from './emptyState';

const backendFailure = (status: ReturnType<typeof makeErrorStatus>): RefreshFailure => ({
  kind: 'backend',
  status,
});

describe('resolveEmptyStateMessage', () => {
  it('returns fallback when no failure is provided', () => {
    expect(resolveEmptyStateMessage(undefined, 'fallback')).toBe('fallback');
    expect(resolveEmptyStateMessage(null)).toBe('No data available');
  });

  it('says a denied read is a permission problem', () => {
    const denial = backendFailure(
      makeErrorStatus('Forbidden', 'permission denied for domain roles')
    );
    expect(resolveEmptyStateMessage(denial, 'fallback')).toBe('Insufficient permissions');
  });

  // The reason decides, not words such as "rbac" in the message.
  it('does not call a timeout on an RBAC resource a permission problem', () => {
    const timeout = backendFailure(
      makeErrorStatus(
        'DeadlineExceeded',
        'listing rbac.authorization.k8s.io/v1 roles: context deadline exceeded'
      )
    );
    expect(resolveEmptyStateMessage(timeout, 'fallback')).toBe('fallback');
  });

  it('shows the fallback for a failure the browser raised', () => {
    const local: RefreshFailure = {
      kind: 'local',
      message: 'Failed to fetch',
      errorName: 'TypeError',
    };
    expect(resolveEmptyStateMessage(local, 'fallback')).toBe('fallback');
  });
});
