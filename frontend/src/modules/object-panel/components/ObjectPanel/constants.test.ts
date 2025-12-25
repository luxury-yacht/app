/**
 * frontend/src/modules/object-panel/components/ObjectPanel/constants.test.ts
 *
 * Tests for constants.
 */
import { describe, expect, it } from 'vitest';

import {
  CLUSTER_SCOPE,
  INACTIVE_SCOPE,
  WORKLOAD_KIND_API_NAMES,
  RESOURCE_CAPABILITIES,
  getObjectDetailsRefresherName,
} from './constants';

describe('ObjectPanel constants', () => {
  it('generates refresher names in a case-insensitive manner', () => {
    expect(getObjectDetailsRefresherName('Deployment')).toBe('object-deployment');
    expect(getObjectDetailsRefresherName('customResource')).toBe('object-customresource');
  });

  it('returns null when no kind is provided', () => {
    expect(getObjectDetailsRefresherName(undefined)).toBeNull();
    expect(getObjectDetailsRefresherName(null)).toBeNull();
  });

  it('exposes workload kind API aliases for table lookups', () => {
    expect(WORKLOAD_KIND_API_NAMES.deployment).toBe('Deployment');
    expect(WORKLOAD_KIND_API_NAMES.statefulset).toBe('StatefulSet');
  });

  it('defines capability presets for key resource kinds', () => {
    expect(RESOURCE_CAPABILITIES.pod).toMatchObject({ logs: true, delete: true });
    expect(RESOURCE_CAPABILITIES.deployment).toMatchObject({ scale: true, restart: true });
    expect(RESOURCE_CAPABILITIES.secret).toMatchObject({ delete: true });
  });

  it('provides scope sentinels for cluster-wide interactions', () => {
    expect(CLUSTER_SCOPE).toBe('__cluster__');
    expect(INACTIVE_SCOPE).toBe('__inactive__');
  });
});
