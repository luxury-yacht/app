import { afterEach, expect, it, vi } from 'vitest';

const { log } = vi.hoisted(() => ({ log: vi.fn() }));
vi.mock('@/core/logging/appLogsClient', () => ({ logAppLogsInfo: log }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
  log.mockReset();
});

it('keeps interleaved transfer durations and cluster identities separate', async () => {
  vi.stubEnv('VITE_PANEL_OPEN_TIMING', '1');
  let now = 10;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const timing = await import('./panelOpenTiming');
  timing.startPanelOpenTiming('first', 'cluster-a', 'workspace-1');
  now = 20;
  timing.startPanelOpenTiming('second', 'cluster-b', 'workspace-2');
  now = 40;
  timing.markPanelOpenTiming('first', 'publication-flushed');
  now = 70;
  timing.finishPanelOpenTiming('second');
  now = 100;
  timing.finishPanelOpenTiming('first');
  timing.finishPanelOpenTiming('first');
  await vi.waitFor(() => expect(log.mock.calls).toHaveLength(2));
  const samples = log.mock.calls.map(([message]) =>
    JSON.parse(message.slice('[DEBUG-panel-open] '.length))
  );
  expect(samples[0]).toMatchObject({ transferId: 'second', phase: 'source', totalMs: 50 });
  expect(samples[1]).toMatchObject({
    transferId: 'first',
    totalMs: 90,
    stages: [
      { stage: 'publication-flushed', elapsedMs: 30 },
      { stage: 'settled', elapsedMs: 90 },
    ],
  });
  expect(log.mock.calls.map((call) => call[2])).toEqual([
    { clusterId: 'cluster-b' },
    { clusterId: 'cluster-a' },
  ]);
});

it('does not record or emit transfer diagnostics unless explicitly enabled', async () => {
  vi.stubEnv('VITE_PANEL_OPEN_TIMING', '');
  const timing = await import('./panelOpenTiming');
  timing.startPanelOpenTiming('disabled', 'cluster-a', 'workspace-1');
  timing.markPanelOpenTiming('disabled', 'publication-flushed');
  timing.finishPanelOpenTiming('disabled');
  timing.markPanelBootstrapTiming('entry');
  timing.reportPanelBootstrapTiming('disabled', 'cluster-a', 'panel-1');
  await Promise.resolve();
  expect(log).not.toHaveBeenCalled();
});

it('includes time before the entry module and reports destination startup only once', async () => {
  vi.stubEnv('VITE_PANEL_OPEN_TIMING', '1');
  let now = 600;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const timing = await import('./panelOpenTiming');
  timing.markPanelBootstrapTiming('entry');
  now = 650;
  timing.markPanelBootstrapTiming('preferences-ready');
  now = 900;
  timing.reportPanelBootstrapTiming('open-1', 'cluster-a', 'panel-1');
  timing.reportPanelBootstrapTiming('open-1', 'cluster-a', 'panel-1');
  await vi.waitFor(() => expect(log).toHaveBeenCalledTimes(1));
  const sample = JSON.parse(log.mock.calls[0][0].slice('[DEBUG-panel-open] '.length));
  expect(sample).toMatchObject({
    transferId: 'open-1',
    windowName: 'panel-1',
    phase: 'destination',
    totalMs: 900,
    stages: [
      { stage: 'entry', elapsedMs: 600 },
      { stage: 'preferences-ready', elapsedMs: 650 },
    ],
  });
});
