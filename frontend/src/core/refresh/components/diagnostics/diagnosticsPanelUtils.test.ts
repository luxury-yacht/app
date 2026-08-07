import { describe, expect, it } from 'vitest';
import type { RefreshDomain } from '../../types';
import {
  formatDurationMs,
  formatInterval,
  formatLastUpdated,
  resolveDomainNamespace,
} from './diagnosticsPanelUtils';

describe('diagnosticsPanelUtils', () => {
  it.each([
    [0, '—'],
    [-1, '—'],
    [500, '0.5s'],
    [1_000, '1s'],
    [1_500, '1.5s'],
  ])('formats interval %s as %s', (interval, expected) => {
    expect(formatInterval(interval)).toBe(expected);
  });

  it.each<[RefreshDomain, string | undefined, string]>([
    ['pods', undefined, '-'],
    ['pods', 'cluster-a|', '-'],
    ['namespace-workloads', 'cluster-a|namespace:alpha', 'alpha'],
    ['namespace-workloads', 'cluster-a|alpha', 'alpha'],
    ['pods', 'cluster-a|workload:alpha:Deployment:api', 'alpha'],
    ['pods', 'cluster-a|workload:', '-'],
    ['pods', 'cluster-a|namespace:alpha', 'alpha'],
    ['pods', 'cluster-a|namespace:all', 'All'],
    ['pods', 'cluster-a|namespace:', '-'],
    ['pods', 'cluster-a|node:worker-a', '-'],
    ['object-maintenance', 'cluster-a|node:worker-a', 'worker-a'],
    ['object-maintenance', 'cluster-a|node:', '-'],
    ['object-maintenance', 'cluster-a|custom-scope', 'custom-scope'],
    ['cluster-events', 'cluster-a|namespace:alpha', '-'],
  ])('resolves %s scope %s as %s', (domain, scope, expected) => {
    expect(resolveDomainNamespace(domain, scope)).toBe(expected);
  });

  it('formats missing and populated update times', () => {
    expect(formatLastUpdated()).toEqual({ display: '—', tooltip: '—' });
    const updated = formatLastUpdated(Date.now() - 1_000);
    expect(updated.display).not.toBe('—');
    expect(updated.tooltip).toContain('ago)');
  });

  it.each([
    [undefined, '—'],
    [null, '—'],
    [Number.NaN, '—'],
    [0, '—'],
    [500, '500ms'],
    [1_500, '1.5s'],
    [15_000, '15s'],
    [90_000, '1.5m'],
    [900_000, '15m'],
  ])('formats duration %s as %s', (duration, expected) => {
    expect(formatDurationMs(duration)).toBe(expected);
  });
});
