/**
 * frontend/src/core/refresh/components/diagnostics/modeDetails.test.ts
 *
 * Tests for the Diagnostics MODE column resolver. The label must distinguish
 * the three very different situations that all used to read as "polling":
 * a domain that polls by design, a stream-covered domain temporarily polling
 * because its stream is unhealthy (self-healing), and a scope whose streaming
 * was BLOCKED after drift (sticky until an app-level reset).
 */

import { describe, expect, it } from 'vitest';

import { resolveModeDetails } from './modeDetails';

describe('resolveModeDetails', () => {
  it('labels a healthy stream as streaming', () => {
    const details = resolveModeDetails({
      domain: 'namespaces',
      streamMode: 'streaming',
      streamActive: true,
      streamHealthy: true,
      pollingEnabled: true,
      streamingBlocked: false,
    });
    expect(details.label).toBe('streaming');
  });

  it('labels a poll-by-design domain as plain polling', () => {
    const details = resolveModeDetails({
      domain: 'cluster-overview',
      streamMode: null,
      streamActive: false,
      streamHealthy: false,
      pollingEnabled: true,
      streamingBlocked: false,
    });
    expect(details.label).toBe('polling');
  });

  it('labels a stream-covered domain polling on an unhealthy stream as a fallback', () => {
    const details = resolveModeDetails({
      domain: 'namespaces',
      streamMode: 'streaming',
      streamActive: true,
      streamHealthy: false,
      pollingEnabled: true,
      streamingBlocked: false,
    });
    expect(details.label).toBe('polling (fallback)');
    expect(details.tooltip).toContain('resumes automatically');
  });

  it('labels a drift-blocked scope distinctly — it will NOT self-heal', () => {
    const details = resolveModeDetails({
      domain: 'pods',
      streamMode: 'streaming',
      streamActive: false,
      streamHealthy: false,
      pollingEnabled: true,
      streamingBlocked: true,
    });
    expect(details.label).toBe('polling (blocked: drift)');
    expect(details.tooltip).toContain('manual refresh');
  });

  it('keeps the stream-only and on-demand labels', () => {
    expect(
      resolveModeDetails({
        domain: 'container-logs',
        streamMode: 'streaming',
        streamActive: true,
        streamHealthy: true,
        pollingEnabled: false,
        streamingBlocked: false,
        streamOnly: true,
      }).label
    ).toBe('streaming');
    expect(
      resolveModeDetails({
        domain: 'catalog-diff',
        streamMode: null,
        streamActive: false,
        streamHealthy: false,
        pollingEnabled: false,
        streamingBlocked: false,
      }).label
    ).toBe('snapshot');
  });
});
