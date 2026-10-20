/**
 * frontend/src/core/refresh/refreshIntent.ts
 *
 * Why a refresh read happens. One vocabulary carries a read from the broker
 * through the orchestrator, readiness deferral, and replay; see
 * docs/architecture/data-freshness.md, "Request intents".
 */

export type RefreshIntent = 'startup' | 'foreground' | 'background' | 'stream-signal' | 'user';

// Auto-refresh off pauses passive work. Only a newly shown scope and an
// explicit user request still read.
const RUNS_WHILE_PAUSED: ReadonlySet<RefreshIntent> = new Set(['foreground', 'user']);

export const runsWhilePaused = (intent: RefreshIntent): boolean => RUNS_WHILE_PAUSED.has(intent);

// Most demanding first: `user` is a manual read, `stream-signal` must not be
// skipped for stream health, and `foreground` still runs while paused. Merged
// work replays with the strongest intent the pause allows.
const PRECEDENCE: readonly RefreshIntent[] = [
  'user',
  'stream-signal',
  'foreground',
  'startup',
  'background',
];

export const strongestIntent = (intents: Iterable<RefreshIntent>): RefreshIntent | undefined => {
  const present = new Set(intents);
  return PRECEDENCE.find((intent) => present.has(intent));
};
