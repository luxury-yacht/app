/**
 * frontend/src/core/refresh/permissionErrors.test.ts
 *
 * Tests for structured permission-denied formatting helpers.
 */

import { describe, expect, test } from 'vitest';

import { makeErrorStatus } from '@/test-utils/errorStatusFixtures';
import { formatPermissionDeniedStatus, resolvePermissionDeniedMessage } from './permissionErrors';

describe('permissionErrors', () => {
  test('formats domain and resource details when message is generic', () => {
    const status = makeErrorStatus('Forbidden', 'permission denied', {
      details: { domain: 'nodes', resource: 'core/nodes' },
    });

    expect(formatPermissionDeniedStatus(status)).toBe(
      'permission denied (domain nodes, resource core/nodes)'
    );
  });

  test('avoids duplicating details already in the message', () => {
    const status = makeErrorStatus('Forbidden', 'permission denied for domain nodes (core/nodes)', {
      details: { domain: 'nodes', resource: 'core/nodes' },
    });

    expect(formatPermissionDeniedStatus(status)).toBe(
      'permission denied for domain nodes (core/nodes)'
    );
  });

  test('falls back to kind/name when domain/resource are missing', () => {
    const status = makeErrorStatus('Forbidden', 'Forbidden', {
      details: { kind: 'pods', name: 'api-server' },
    });

    expect(formatPermissionDeniedStatus(status)).toBe('Forbidden (resource pods/api-server)');
  });

  test('resolvePermissionDeniedMessage formats only a denial', () => {
    const denial = makeErrorStatus('Forbidden', 'permission denied', {
      details: { domain: 'pods' },
    });

    expect(resolvePermissionDeniedMessage('fallback', denial)).toBe(
      'permission denied (domain pods)'
    );
    expect(resolvePermissionDeniedMessage('fallback', makeErrorStatus('NotFound'))).toBe(
      'fallback'
    );
  });
});
