/**
 * frontend/src/core/refresh/components/diagnostics/modeDetails.ts
 *
 * Pure resolver for the Diagnostics MODE column. Three situations used to
 * collapse into one "polling" label; they have very different meanings:
 *
 *   polling                  — the domain polls by design (no stream exists)
 *   polling (fallback)       — a stream-covered domain's stream is unhealthy;
 *                              polls cover the gap and streaming resumes on
 *                              its own once the server confirms a subscribe
 *   polling (blocked: drift) — streaming produced drifted data and was blocked
 *                              for this scope; it will NOT self-heal (cleared
 *                              only by manual refresh, reset views, kubeconfig
 *                              change, or auth recovery)
 */

import type { RefreshDomain } from '../../types';

export type ModeDetailsInput = {
  domain: RefreshDomain;
  streamMode: 'streaming' | 'watch' | null;
  streamActive: boolean;
  streamHealthy: boolean;
  pollingEnabled: boolean;
  streamingBlocked: boolean;
  streamOnly?: boolean;
};

export type ModeDetails = { label: string; tooltip?: string };

export const resolveModeDetails = (input: ModeDetailsInput): ModeDetails => {
  const { streamMode, streamActive, streamHealthy, pollingEnabled, streamingBlocked, streamOnly } =
    input;
  if (streamMode && streamOnly) {
    return { label: streamMode, tooltip: 'Stream-only domain' };
  }
  if (streamingBlocked) {
    return {
      label: 'polling (blocked: drift)',
      tooltip:
        'Streaming was blocked for this scope after drift was detected; polling is the source of truth. Cleared by manual refresh, reset views, kubeconfig change, or auth recovery.',
    };
  }
  if (streamMode && streamActive && streamHealthy) {
    return { label: streamMode, tooltip: 'Stream delivering updates' };
  }
  if (pollingEnabled) {
    if (streamMode) {
      return {
        label: 'polling (fallback)',
        tooltip:
          'Stream-covered domain polling while its stream is unhealthy; streaming resumes automatically once the subscription recovers.',
      };
    }
    return { label: 'polling', tooltip: 'Snapshot polling active' };
  }
  if (streamMode && streamActive) {
    return { label: streamMode, tooltip: 'Stream active but unhealthy' };
  }
  return { label: 'snapshot', tooltip: 'Snapshot fetched on demand' };
};
