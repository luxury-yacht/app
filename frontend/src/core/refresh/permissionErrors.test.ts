/**
 * frontend/src/core/refresh/permissionErrors.test.ts
 *
 * Tests for structured permission-denied formatting helpers.
 */

import { describe, expect, test } from 'vitest';

import {
  formatPermissionDeniedStatus,
  isPermissionDeniedStatus,
  resolvePermissionDeniedMessage,
} from './permissionErrors';
import type { PermissionDeniedStatus } from './types';

describe('permissionErrors', () => {
  test('formats domain and resource details when message is generic', () => {
    const status: PermissionDeniedStatus = {
      message: 'permission denied',
      reason: 'Forbidden',
      code: 403,
      details: { domain: 'nodes', resource: 'core/nodes' },
    };

    expect(formatPermissionDeniedStatus(status)).toBe(
      'permission denied (domain nodes, resource core/nodes)'
    );
  });

  test('avoids duplicating details already in the message', () => {
    const status: PermissionDeniedStatus = {
      message: 'permission denied for domain nodes (core/nodes)',
      reason: 'Forbidden',
      code: 403,
      details: { domain: 'nodes', resource: 'core/nodes' },
    };

    expect(formatPermissionDeniedStatus(status)).toBe(
      'permission denied for domain nodes (core/nodes)'
    );
  });

  test('falls back to kind/name when domain/resource are missing', () => {
    const status: PermissionDeniedStatus = {
      message: 'Forbidden',
      reason: 'Forbidden',
      code: 403,
      details: { kind: 'Pod', name: 'api-server' },
    };

    expect(formatPermissionDeniedStatus(status)).toBe('Forbidden (resource Pod/api-server)');
  });

  test('recognizes forbidden status payloads', () => {
    expect(isPermissionDeniedStatus({ reason: 'Forbidden', code: 403 })).toBe(true);
    expect(isPermissionDeniedStatus({ reason: 'Other', code: 400 })).toBe(false);
  });

  test('resolvePermissionDeniedMessage prefers structured status', () => {
    const status: PermissionDeniedStatus = {
      message: 'permission denied',
      reason: 'Forbidden',
      code: 403,
      details: { domain: 'pods' },
    };

    expect(resolvePermissionDeniedMessage('fallback', status)).toBe(
      'permission denied (domain pods)'
    );
    expect(resolvePermissionDeniedMessage('fallback', { code: 400 })).toBe('fallback');
  });
});
