/**
 * frontend/src/shared/components/tables/persistence/gridTableViewRegistry.test.ts
 *
 * Test suite for gridTableViewRegistry.
 * Covers key behaviors and edge cases for gridTableViewRegistry.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { compareUtf16Strings } from '@/shared/utils/sort';
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
    expect(listRegisteredGridTableViews().sort(compareUtf16Strings)).toEqual(
      baseline.sort(compareUtf16Strings)
    );
  });

  it('registers new ids and trims whitespace', () => {
    registerGridTableView('  custom-view ');
    expect(isRegisteredGridTableView('custom-view')).toBe(true);
    expect(listRegisteredGridTableViews()).toContain('custom-view');
  });

  it('ignores empty registrations', () => {
    registerGridTableView('   ');
    registerGridTableView('');
    expect(listRegisteredGridTableViews().sort(compareUtf16Strings)).toEqual(
      baseline.sort(compareUtf16Strings)
    );
  });
});
