import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  logAppLogsDebug,
  logAppLogsError,
  logAppLogsInfo,
  logAppLogsWarn,
  subscribeAppLogsAdded,
} from './appLogsClient';

const backendMocks = vi.hoisted(() => ({
  failure: null as Error | null,
  log: vi.fn<(level: string, message: string, source: string) => void>(),
  logWithCluster:
    vi.fn<
      (
        level: string,
        message: string,
        source: string,
        clusterId: string,
        clusterName: string
      ) => void
    >(),
}));
const desktopMocks = vi.hoisted(() => ({
  available: true,
  onEvent: vi.fn<(eventName: string, eventHandler: (event?: unknown) => void) => () => void>(
    () => () => undefined
  ),
}));

vi.mock('@core/backend-api', () => ({
  LogAppLogsFromFrontend: (level: string, message: string, source: string) => {
    backendMocks.log(level, message, source);
    if (backendMocks.failure) {
      return Promise.reject(backendMocks.failure);
    }
  },
  LogAppLogsFromFrontendWithCluster: (
    level: string,
    message: string,
    source: string,
    clusterId: string,
    clusterName: string
  ) => {
    backendMocks.logWithCluster(level, message, source, clusterId, clusterName);
    if (backendMocks.failure) {
      return Promise.reject(backendMocks.failure);
    }
  },
}));

vi.mock('@core/desktop-runtime', () => ({
  desktopRuntimeAvailable: () => desktopMocks.available,
  onEvent: (eventName: string, eventHandler: (event?: unknown) => void) =>
    desktopMocks.onEvent(eventName, eventHandler),
}));

const logAppLogsFromFrontendMock = backendMocks.log;
const logAppLogsFromFrontendWithClusterMock = backendMocks.logWithCluster;

describe('appLogsClient', () => {
  beforeEach(() => {
    logAppLogsFromFrontendMock.mockReset();
    logAppLogsFromFrontendWithClusterMock.mockReset();
    backendMocks.failure = null;
    desktopMocks.available = true;
    desktopMocks.onEvent.mockReset();
  });

  it('sends frontend logs to backend application logs with normalized inputs', () => {
    logAppLogsDebug(' debug message ', ' DebugSource ');
    logAppLogsInfo(' info message ', ' InfoSource ');
    logAppLogsWarn(' warn message ', ' WarnSource ');
    logAppLogsError(' error message ', ' ErrorSource ');

    expect(logAppLogsFromFrontendMock).toHaveBeenNthCalledWith(
      1,
      'debug',
      'debug message',
      'DebugSource'
    );
    expect(logAppLogsFromFrontendMock).toHaveBeenNthCalledWith(
      2,
      'info',
      'info message',
      'InfoSource'
    );
    expect(logAppLogsFromFrontendMock).toHaveBeenNthCalledWith(
      3,
      'warn',
      'warn message',
      'WarnSource'
    );
    expect(logAppLogsFromFrontendMock).toHaveBeenNthCalledWith(
      4,
      'error',
      'error message',
      'ErrorSource'
    );
  });

  it('uses Frontend as the default source and skips blank messages', () => {
    logAppLogsInfo(' visible message ', '   ');
    logAppLogsError('   ', 'Errors');

    expect(logAppLogsFromFrontendMock).toHaveBeenCalledTimes(1);
    expect(logAppLogsFromFrontendMock).toHaveBeenCalledWith('info', 'visible message', 'Frontend');
  });

  it('sends frontend logs with structured cluster metadata when available', () => {
    logAppLogsWarn(' cluster warning ', ' CatalogStream ', {
      clusterId: ' cluster-a ',
      clusterName: ' Alpha ',
    });

    expect(logAppLogsFromFrontendWithClusterMock).toHaveBeenCalledWith(
      'warn',
      'cluster warning',
      'CatalogStream',
      'cluster-a',
      'Alpha'
    );
    expect(logAppLogsFromFrontendMock).not.toHaveBeenCalled();
  });

  it('ignores an unavailable desktop host or failing backend logging call', () => {
    desktopMocks.available = false;
    expect(() => logAppLogsError('missing api', 'Frontend')).not.toThrow();

    desktopMocks.available = true;
    logAppLogsFromFrontendMock.mockImplementationOnce(() => {
      throw new Error('backend failed');
    });

    expect(() => logAppLogsError('backend failure', 'Frontend')).not.toThrow();
  });

  it.each([false, true])(
    'contains asynchronous logging failure (cluster=%s)',
    async (clusterScoped) => {
      const backendLog = clusterScoped ? backendMocks.logWithCluster : backendMocks.log;
      backendMocks.failure = new Error('logging transport closed');
      const cluster = clusterScoped ? { clusterId: 'cluster-a' } : undefined;

      logAppLogsError('first message', 'Frontend', cluster);
      // Allow an unhandled rejection to reach the host, just as a rejected Wails call would.
      await new Promise((resolve) => setTimeout(resolve, 0));
      backendMocks.failure = null;
      logAppLogsInfo('later message', 'Frontend', cluster);

      expect(backendLog).toHaveBeenCalledTimes(2);
    }
  );

  it('subscribes to app-logs events and returns the Wails disposer', () => {
    const dispose = vi.fn();
    const handler = vi.fn();
    desktopMocks.onEvent.mockImplementation(
      (_eventName: string, eventHandler: (event?: unknown) => void) => {
        eventHandler({ sequence: 12 });
        eventHandler('unexpected payload');
        return dispose;
      }
    );

    const unsubscribe = subscribeAppLogsAdded(handler);

    expect(desktopMocks.onEvent).toHaveBeenCalledWith('app-logs:added', expect.any(Function));
    expect(handler).toHaveBeenNthCalledWith(1, { sequence: 12 });
    expect(handler).toHaveBeenNthCalledWith(2, undefined);

    unsubscribe();

    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('does not subscribe when the desktop host is unavailable', () => {
    const handler = vi.fn();
    desktopMocks.available = false;

    const unsubscribe = subscribeAppLogsAdded(handler);
    unsubscribe();

    expect(desktopMocks.onEvent).not.toHaveBeenCalled();
  });
});
