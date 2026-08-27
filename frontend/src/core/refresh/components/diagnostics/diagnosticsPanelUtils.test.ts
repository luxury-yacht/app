import { describe, expect, it } from 'vitest';
import {
  formatDurationMs,
  formatInterval,
  formatLastUpdated,
  resolveDomainNamespace,
} from './diagnosticsPanelUtils';

describe('diagnosticsPanelUtils', () => {
  it('covers diagnosticsPanelUtils scenarios', async () => {
    for (const [interval, expected] of [
      [0, '—'],
      [-1, '—'],
      [500, '0.5s'],
      [1_000, '1s'],
      [1_500, '1.5s'],
    ] as const) {
      // Scenarios: formats interval %s as %s
      expect(formatInterval(interval)).toBe(expected);
    }

    for (const [domain, scope, expected] of [
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
    ] as const) {
      // Scenarios: resolves %s scope %s as %s
      expect(resolveDomainNamespace(domain, scope)).toBe(expected);
    }

    {
      // Scenario: formats missing and populated update times
      expect(formatLastUpdated()).toEqual({ display: '—', tooltip: '—' });
      const updated = formatLastUpdated(Date.now() - 1_000);
      expect(updated.display).not.toBe('—');
      expect(updated.tooltip).toContain('ago)');
    }

    for (const [duration, expected] of [
      [undefined, '—'],
      [null, '—'],
      [Number.NaN, '—'],
      [0, '—'],
      [500, '500ms'],
      [1_500, '1.5s'],
      [15_000, '15s'],
      [90_000, '1.5m'],
      [900_000, '15m'],
    ] as const) {
      // Scenarios: formats duration %s as %s
      expect(formatDurationMs(duration)).toBe(expected);
    }
  });
});
