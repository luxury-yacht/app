// Opt-in diagnostics for a Windows development capture. Keep logging imports
// off the bootstrap path and emit batches after measuring, not at every mark.
type Stage = { stage: string; elapsedMs: number };
type Timing = {
  transferId: string;
  windowName: string;
  clusterId: string;
  started: number;
  stages: Stage[];
};

const enabled = import.meta.env.VITE_PANEL_OPEN_TIMING === '1';
const sources = new Map<string, Timing>();
const bootstrapStages: Stage[] = [];
let bootstrapReported = false;
let logger: Promise<typeof import('@/core/logging/appLogsClient')> | undefined;
const milliseconds = (value: number) => Math.round(value * 100) / 100;

function emit(timing: Timing, phase: 'source' | 'destination') {
  const message = `[DEBUG-panel-open] ${JSON.stringify({
    transferId: timing.transferId,
    windowName: timing.windowName,
    phase,
    startedUnixMs: performance.timeOrigin + timing.started,
    totalMs: milliseconds(performance.now() - timing.started),
    stages: timing.stages,
  })}`;
  logger ??= import('@/core/logging/appLogsClient');
  void logger
    .then(({ logAppLogsInfo }) =>
      logAppLogsInfo(message, 'PanelOpenTiming', { clusterId: timing.clusterId })
    )
    .catch(() => {
      // Diagnostic delivery must not affect a transfer or bootstrap failure.
    });
}

export function startPanelOpenTiming(transferId: string, clusterId: string, windowName: string) {
  if (enabled && !sources.has(transferId)) {
    sources.set(transferId, {
      transferId,
      clusterId,
      windowName,
      started: performance.now(),
      stages: [],
    });
  }
}

export function markPanelOpenTiming(transferId: string, stage: string) {
  const timing = sources.get(transferId);
  if (timing) {
    timing.stages.push({ stage, elapsedMs: milliseconds(performance.now() - timing.started) });
  }
}

export function finishPanelOpenTiming(transferId: string) {
  const timing = sources.get(transferId);
  if (timing) {
    markPanelOpenTiming(transferId, 'settled');
    sources.delete(transferId);
    emit(timing, 'source');
  }
}

export function markPanelBootstrapTiming(stage: string) {
  if (enabled && !bootstrapReported) {
    bootstrapStages.push({ stage, elapsedMs: milliseconds(performance.now()) });
  }
}

export function reportPanelBootstrapTiming(
  transferId: string,
  clusterId: string,
  windowName: string
) {
  if (enabled && !bootstrapReported) {
    bootstrapReported = true;
    emit({ transferId, clusterId, windowName, started: 0, stages: bootstrapStages }, 'destination');
  }
}
