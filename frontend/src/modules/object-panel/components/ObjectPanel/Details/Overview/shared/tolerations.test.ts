import { describe, expect, it } from 'vitest';
import { parseToleration } from './tolerations';

describe('parseToleration', () => {
  it('covers parseToleration scenarios', async () => {
    // Scenario: parses an operator-only toleration
    expect(parseToleration('Exists')).toEqual({
      label: 'Exists',
      tooltip: 'Tolerates any taint. Can deploy to any node.',
    });
    // Scenario: parses effect and eviction-time suffixes
    expect(parseToleration('custom-taint Exists (NoExecute)')).toEqual({
      label: 'custom-taint:NoExecute',
      tooltip: 'Tolerates any value for this key.',
    });
    expect(parseToleration('dedicated Equal database (NoExecute) for 60s')).toEqual({
      label: 'dedicated=database:NoExecute',
      tooltip: 'Pod evicted after 60s if a matching taint persists.',
    });
    // Scenario: accepts whitespace separators without treating malformed suffixes as metadata
    expect(parseToleration('dedicated Equal database (NoSchedule)\tfor\t120s')).toEqual({
      label: 'dedicated=database:NoSchedule',
      tooltip: 'Pod evicted after 120s if a matching taint persists.',
    });
    expect(parseToleration('dedicated Equal database for seconds')).toEqual({
      label: 'dedicated=database',
      tooltip: 'Tolerates any effect.',
    });
  });
});
