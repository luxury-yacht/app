/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/registry.test.tsx
 *
 * After the X1 descriptor migration, registry.ts only provides the GenericOverview fallback (for
 * unregistered/custom-resource kinds) and per-kind action capabilities. Built-in kinds render via
 * descriptorRegistry (covered by driftCheck.test.ts and the per-kind descriptor tests).
 */

import { describe, it, expect } from 'vitest';
import { overviewRegistry, getResourceCapabilities } from './registry';
import { GenericOverview } from './GenericOverview';

describe('overviewRegistry fallback', () => {
  it('renders the generic overview for any kind (unregistered / custom resources)', () => {
    const element = overviewRegistry.renderComponent({ kind: 'CustomResource', foo: 'bar' });
    expect(element.type).toBe(GenericOverview);
    expect(element.props).toMatchObject({ kind: 'CustomResource', foo: 'bar' });
  });
});

describe('getResourceCapabilities', () => {
  it('exposes capabilities for registered kinds and defaults to delete for unknown kinds', () => {
    expect(getResourceCapabilities('Secret')).toEqual({ delete: true, edit: true });
    expect(getResourceCapabilities('Pod')).toEqual({
      delete: true,
      objPanelLogs: true,
      exec: true,
    });
    expect(getResourceCapabilities('HTTPRoute')).toEqual({ delete: true, edit: true });
    expect(getResourceCapabilities('CronJob')).toEqual({
      delete: true,
      trigger: true,
      suspend: true,
    });
    expect(getResourceCapabilities('Deployment')).toEqual({
      delete: true,
      restart: true,
      scale: true,
      edit: true,
    });
    expect(getResourceCapabilities('custom.foo')).toEqual({ delete: true });
  });
});
