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
  test('covers permissionErrors scenarios', async () => {
    {
      // Scenario: formats domain and resource details when message is generic
      const status: PermissionDeniedStatus = {
        message: 'permission denied',
        reason: 'Forbidden',
        code: 403,
        details: { domain: 'nodes', resource: 'core/nodes' },
      };

      expect(formatPermissionDeniedStatus(status)).toBe(
        'permission denied (domain nodes, resource core/nodes)'
      );
    }

    {
      // Scenario: avoids duplicating details already in the message
      const status: PermissionDeniedStatus = {
        message: 'permission denied for domain nodes (core/nodes)',
        reason: 'Forbidden',
        code: 403,
        details: { domain: 'nodes', resource: 'core/nodes' },
      };

      expect(formatPermissionDeniedStatus(status)).toBe(
        'permission denied for domain nodes (core/nodes)'
      );
    }

    {
      // Scenario: falls back to kind/name when domain/resource are missing
      const status: PermissionDeniedStatus = {
        message: 'Forbidden',
        reason: 'Forbidden',
        code: 403,
        details: { kind: 'Pod', name: 'api-server' },
      };

      expect(formatPermissionDeniedStatus(status)).toBe('Forbidden (resource Pod/api-server)');
    }
    // Scenario: recognizes forbidden status payloads
    expect(isPermissionDeniedStatus({ reason: 'Forbidden', code: 403 })).toBe(true);
    expect(isPermissionDeniedStatus({ reason: 'Other', code: 400 })).toBe(false);

    for (const payload of [
      null,
      [],
      { kind: 1, reason: 'Forbidden' },
      { apiVersion: 1, reason: 'Forbidden' },
      { message: 1, reason: 'Forbidden' },
      { reason: 1, code: 403 },
      { reason: 'Forbidden', code: '403' },
      { reason: 'Forbidden', details: 'invalid' },
      { reason: 'Forbidden', details: { domain: 1 } },
      { reason: 'Forbidden', details: { resource: 1 } },
      { reason: 'Forbidden', details: { kind: 1 } },
      { reason: 'Forbidden', details: { name: 1 } },
    ]) {
      // Scenarios: rejects malformed permission payload %#
      expect(isPermissionDeniedStatus(payload)).toBe(false);
    }

    {
      // Scenario: resolvePermissionDeniedMessage prefers structured status
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
    }
  });
});
