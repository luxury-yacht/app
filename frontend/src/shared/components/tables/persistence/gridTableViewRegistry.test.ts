/**
 * frontend/src/shared/components/tables/persistence/gridTableViewRegistry.test.ts
 *
 * Test suite for gridTableViewRegistry.
 * Covers key behaviors and edge cases for gridTableViewRegistry.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import {
  isRegisteredGridTableView,
  listRegisteredGridTableViews,
  registerGridTableView,
  resetGridTableViewRegistryForTests,
} from './gridTableViewRegistry';

describe('gridTableViewRegistry', () => {
  const baseline = ['cluster-nodes', 'namespace-workloads'];

  beforeEach(() => {
    resetGridTableViewRegistryForTests(baseline);
  });

  it('reports registered view ids and lists them', () => {
    expect(isRegisteredGridTableView('cluster-nodes')).toBe(true);
    expect(isRegisteredGridTableView('missing')).toBe(false);
    expect(listRegisteredGridTableViews().sort()).toEqual(baseline.sort());
  });

  it('registers new ids and trims whitespace', () => {
    registerGridTableView('  custom-view ');
    expect(isRegisteredGridTableView('custom-view')).toBe(true);
    expect(listRegisteredGridTableViews()).toContain('custom-view');
  });

  it('ignores empty registrations', () => {
    registerGridTableView('   ');
    registerGridTableView('');
    expect(listRegisteredGridTableViews().sort()).toEqual(baseline.sort());
  });
});
