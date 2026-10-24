/**
 * frontend/src/ui/panels/app-logs/AppLogsPanel.test.tsx
 *
 * The Application Logs panel as the app opens it: it tells the backend when it
 * is shown, lists the backend's lines with each field in its column, appends
 * the lines the backend announces without duplicates, filters by level,
 * component, cluster (keeping case-distinct and global scopes apart), and
 * text, pauses and resumes with auto-refresh and while scrolled up, keeps the
 * newest 10,000 lines, copies, saves, or clears them, and takes part in Tab
 * order. Runs in the full app with the real dockable panel, log table, and
 * dropdowns over the faked backend (test-utils/appState): lines come from
 * GetAppLogs and GetAppLogsSince, and announcements as `app-logs:added`
 * events. useGridTableDownloadAction.test.tsx covers the shared Download
 * button's busy state, failure reports, and feedback timer.
 */

import { Clipboard } from '@wailsio/runtime';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installAppStateHarness } from '@/test-utils/appState/harness';
import type { BackendResult } from '@/test-utils/appState/transport';
import { requireValue } from '@/test-utils/requireValue';

type LogLine = NonNullable<BackendResult<'GetAppLogs'>>[number];

const app = installAppStateHarness();
const logLine = (sequence: number, message = `line ${sequence}`, extra: Partial<LogLine> = {}) =>
  ({
    sequence,
    timestamp: '2024-01-01T00:00:00.000Z',
    level: 'info',
    message,
    source: 'core',
    ...extra,
  }) as LogLine;

const logLines = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_value, index) => logLine(from + index));

/** Answers the panel's first read and its later reads of what is new. */
const backendLines = (initial: LogLine[], since: LogLine[] = []) => {
  app.backend.answer('GetAppLogs', () => initial);
  app.backend.answer('GetAppLogsSince', () => since);
};

beforeEach(async () => {
  vi.useFakeTimers();
  vi.mocked(Clipboard.SetText).mockReset().mockResolvedValue(undefined);
  const dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['default']);
  app.startScreen(dev);
  app.backend.answer('ClearAppLogs', () => undefined);
  await app.mountApp();
});

afterEach(() => {
  vi.useRealTimers();
});

const keydown = (key: string, init: KeyboardEventInit = {}) =>
  new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });

/** View > Application Logs (Ctrl+Shift+L outside macOS). */
const togglePanel = async () => {
  await act(async () => {
    document.body.dispatchEvent(keydown('L', { ctrlKey: true, shiftKey: true }));
  });
  await app.settle();
};

const openPanel = async () => {
  await togglePanel();
  // The panel reads its lines once its opening animation ends (300 ms).
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
  await app.settle();
};

const panel = () =>
  requireValue(
    document.querySelector<HTMLElement>('.app-logs-panel-content'),
    'expected the Application Logs panel'
  );

const rows = () => Array.from(panel().querySelectorAll<HTMLElement>('.gridtable-row'));

const messages = () =>
  Array.from(panel().querySelectorAll('.gridtable-row .log-message'), (cell) => cell.textContent);

/** The line count: "(shown / all)" while filtered, "(all)" otherwise. */
const lineCount = () => panel().querySelector('.app-logs-count')?.textContent;

const control = (label: string) =>
  requireValue(
    panel().querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`),
    `expected the ${label} control`
  );

const click = async (element: HTMLElement) => {
  await act(async () => element.click());
  await app.settle();
};

const announce = async (sequence: number) => {
  await act(async () => {
    app.events.emit('app-logs:added', { sequence });
  });
  await app.settle();
};

// Scroll and row measurement settle on animation frames.
const flushFrames = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
};

/** Opens the filter dropdown named `label` and applies `choose` to its menu. */
const filter = async (label: string, choose: (menu: HTMLElement) => HTMLElement[]) => {
  const trigger = control(label);
  await click(trigger);
  const menu = requireValue(
    document.getElementById(trigger.getAttribute('aria-controls') ?? ''),
    `expected the ${label} options`
  );
  for (const target of choose(menu)) {
    await click(target);
  }
  await click(trigger);
};

// A multi-select filter's options toggle like checkboxes.
const option = (name: string) => (menu: HTMLElement) =>
  requireValue(
    Array.from(menu.querySelectorAll<HTMLElement>('button[data-dropdown-option-index]')).find(
      (candidate) => candidate.textContent?.trim() === name
    ),
    `expected the ${name} option`
  );

const bulk = (label: 'Select all' | 'Select none') => (menu: HTMLElement) =>
  requireValue(menu.querySelector<HTMLElement>(`[aria-label="${label}"]`), `expected ${label}`);

/** Keeps only the named options of a filter. */
const only =
  (...names: string[]) =>
  (menu: HTMLElement) => [bulk('Select none')(menu), ...names.map((name) => option(name)(menu))];

const autoRefresh = () =>
  requireValue(
    panel().querySelector<HTMLButtonElement>(
      'button[aria-label="Stop auto-refresh"], button[aria-label="Start auto-refresh"]'
    ),
    'expected the auto-refresh button'
  );

const autoRefreshOn = () => autoRefresh().getAttribute('aria-label') === 'Stop auto-refresh';

describe('AppLogsPanel', () => {
  it('tells the backend whether the panel is shown', async () => {
    backendLines([]);
    const latest = () => app.backend.calls('SetAppLogsPanelVisible').slice(-1)[0];
    expect(latest()).toEqual([false]);

    await openPanel();
    expect(latest()).toEqual([true]);

    await togglePanel();
    expect(latest()).toEqual([false]);
  });

  it('shows the backend’s lines with each field in its column', async () => {
    backendLines([
      logLine(1, 'Ready'),
      logLine(2, 'Slow response', {
        level: 'warn',
        source: 'refresh',
        clusterId: 'kube:alpha',
        clusterName: 'alpha',
      }),
    ]);

    await openPanel();

    expect(app.backend.calls('GetAppLogs')).toHaveLength(1);
    expect(rows()).toHaveLength(2);
    const cells = Array.from(rows()[1]?.querySelectorAll('.grid-cell') ?? [], (cell) =>
      cell.textContent?.trim()
    );
    expect(cells.slice(1)).toEqual(['warn', '[refresh]', '[alpha]', 'Slow response']);
  });

  // Long messages sit on one line like any table cell; expanding a row shows all
  // of it, as in the Logs tab's Table format.
  it('expands a row to read a long message in full', async () => {
    backendLines([logLine(1, `start ${'x'.repeat(400)} end`)]);
    await openPanel();
    const row = () => requireValue(rows()[0], 'expected a log row');
    const message = () =>
      requireValue(row().querySelector<HTMLElement>('.log-message'), 'expected the message');

    await click(message());
    expect(row().classList.contains('parsed-row-expanded')).toBe(true);
    await click(message());
    expect(row().classList.contains('parsed-row-expanded')).toBe(false);
  });

  it('appends only the new lines the backend announces and stops listening once closed', async () => {
    backendLines([logLine(1, 'Ready')], [logLine(2, 'Delta', { level: 'warn' })]);
    await openPanel();

    await announce(2);

    expect(app.backend.calls('GetAppLogsSince')).toEqual([[1]]);
    expect(app.backend.calls('GetAppLogs')).toHaveLength(1);
    expect(messages()).toEqual(['Ready', 'Delta']);
    await togglePanel();
    expect(app.events.listenerCount('app-logs:added')).toBe(0);
  });

  it('adds a line once when overlapping announcements read the same lines', async () => {
    backendLines([logLine(1, 'Ready')], [logLine(2, 'Delta')]);
    await openPanel();

    await act(async () => {
      app.events.emit('app-logs:added', { sequence: 2 });
      app.events.emit('app-logs:added', { sequence: 2 });
    });
    await app.settle();

    expect(app.backend.calls('GetAppLogsSince')).toHaveLength(2);
    expect(messages()).toEqual(['Ready', 'Delta']);
  });

  it('reports a failed read and shows no lines', async () => {
    app.backend.answer('GetAppLogs', () => {
      throw new Error('load failed');
    });

    await openPanel();

    expect(app.errors.take((record) => record.context?.action === 'loadLogs')).toHaveLength(1);
    expect(rows()).toEqual([]);
  });

  it('narrows the lines by level, component, and text and counts what is shown', async () => {
    backendLines([
      logLine(1, 'System ready'),
      logLine(2, 'Debug info', { level: 'debug', source: 'worker' }),
    ]);
    await openPanel();
    expect(lineCount()).toBe('(2)');

    await filter('Filter by component', (menu) => [option('worker')(menu)]);
    expect(lineCount()).toBe('(1 / 2)');
    expect(messages()).toEqual(['System ready']);

    await filter('Filter by component', (menu) => [bulk('Select all')(menu)]);
    await filter('Filter by log level', (menu) => [option('Debug')(menu)]);
    expect(messages()).toEqual(['System ready']);
    await filter('Filter by log level', (menu) => [bulk('Select none')(menu)]);
    expect(lineCount()).toBe('(0 / 2)');
    expect(rows()).toEqual([]);

    await filter('Filter by log level', (menu) => [bulk('Select all')(menu)]);
    const text = requireValue(
      panel().querySelector<HTMLInputElement>('.app-logs-text-filter'),
      'expected the text filter'
    );
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        text,
        'missing'
      );
      text.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await app.settle();
    expect(lineCount()).toBe('(0 / 2)');
    expect(rows()).toEqual([]);
  });

  it('filters by cluster, with lines from no cluster under Global', async () => {
    backendLines([
      logLine(1, 'Settings loaded', { source: 'Settings' }),
      logLine(2, 'Cluster A ready', {
        source: 'Auth',
        clusterId: 'kube-alpha:alpha',
        clusterName: 'alpha',
      }),
      logLine(3, 'Cluster B ready', {
        source: 'Auth',
        clusterId: 'kube-bravo:bravo',
        clusterName: 'bravo',
      }),
    ]);
    await openPanel();
    expect(
      Array.from(
        panel().querySelectorAll('.gridtable-row .log-cluster'),
        (cell) => cell.textContent
      )
    ).toEqual(['[Global]', '[alpha]', '[bravo]']);

    await filter('Filter by cluster', only('kube-bravo:bravo'));
    expect(messages()).toEqual(['Cluster B ready']);

    await filter('Filter by cluster', only('Global'));
    expect(messages()).toEqual(['Settings loaded']);
  });

  it('keeps case-distinct cluster scopes apart while lines arrive', async () => {
    const clusterIds = ['config:Production', 'config:production'];
    backendLines(
      [
        ...clusterIds.map((clusterId, index) => logLine(index + 1, clusterId, { clusterId })),
        logLine(3, 'Global message'),
      ],
      [logLine(4, 'Another global message')]
    );
    await openPanel();

    await filter('Filter by cluster', only('config:Production'));
    expect(messages()).toEqual(['config:Production']);

    await filter('Filter by cluster', only(...clusterIds));
    expect(messages()).toEqual(clusterIds);
    // A new global line stays out of the explicit cluster selection.
    await announce(4);
    expect(messages()).toEqual(clusterIds);
  });

  it('stops applying new lines while auto-refresh is off and catches up when R restarts it', async () => {
    backendLines([logLine(1, 'Ready')], [logLine(2, 'Missed while stopped')]);
    await openPanel();

    await click(autoRefresh());
    expect(autoRefreshOn()).toBe(false);
    await announce(2);
    expect(app.backend.calls('GetAppLogsSince')).toEqual([]);
    expect(messages()).toEqual(['Ready']);

    // R toggles it, as in container logs.
    await act(async () => {
      document.body.dispatchEvent(keydown('r'));
    });
    await app.settle();

    expect(autoRefreshOn()).toBe(true);
    expect(app.backend.calls('GetAppLogsSince')).toEqual([[1]]);
    expect(messages()).toEqual(['Ready', 'Missed while stopped']);
  });

  it('drops a read already in flight when auto-refresh stops', async () => {
    backendLines([logLine(1, 'Ready')], [logLine(2, 'Late line')]);
    await openPanel();
    const finishRead = app.backend.hold('GetAppLogsSince');
    await announce(2);
    expect(app.backend.calls('GetAppLogsSince')).toHaveLength(1);

    await click(autoRefresh());
    await act(async () => finishRead());
    await app.settle();

    expect(messages()).toEqual(['Ready']);
  });

  // Troubleshooting the app can need more history than a Logs tab keeps, so the
  // panel keeps a fixed 10,000 lines whatever the Logs tabs' Buffer size is, and
  // draws only the rows in view.
  it('keeps the newest 10,000 lines regardless of the Logs tabs buffer size, drawing only rows in view', async () => {
    app.preferences({ objPanelLogsBufferMaxSize: 100 });
    backendLines(logLines(1, 9_990), logLines(9_991, 10_010));
    await openPanel();
    await flushFrames();
    expect(lineCount()).toBe('(9990)');
    expect(rows().length).toBeGreaterThan(0);
    expect(rows().length).toBeLessThan(200);

    await announce(10_010);
    await flushFrames();

    expect(lineCount()).toBe('(10000)');
    expect(messages()).not.toContain('line 10');
  });

  describe('while scrolled up', () => {
    const descriptors = {
      scrollHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight'),
      clientHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight'),
    };

    // jsdom has no layout: the log body is 400 px of content in a 100 px view.
    beforeEach(() => {
      for (const [name, height] of [
        ['scrollHeight', 400],
        ['clientHeight', 100],
      ] as const) {
        Object.defineProperty(HTMLElement.prototype, name, {
          configurable: true,
          get(this: HTMLElement) {
            return this.classList.contains('gridtable-wrapper') ? height : 0;
          },
        });
      }
    });

    afterEach(() => {
      for (const name of ['scrollHeight', 'clientHeight'] as const) {
        const original = descriptors[name];
        if (original) {
          Object.defineProperty(HTMLElement.prototype, name, original);
        } else {
          Reflect.deleteProperty(HTMLElement.prototype, name);
        }
      }
    });

    it('holds the shown lines and resumes from a bottom button', async () => {
      backendLines(logLines(1, 10_000), logLines(10_001, 10_010));
      await openPanel();
      const body = requireValue(
        panel().querySelector<HTMLElement>('.gridtable-wrapper'),
        'expected the log body'
      );
      expect(panel().querySelector('button[aria-label="Resume scrolling"]')).toBeNull();

      await act(async () => {
        body.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -100 }));
        body.scrollTop = 0;
        body.dispatchEvent(new Event('scroll'));
      });
      await flushFrames();
      const resume = control('Resume scrolling');

      // New lines arrive while scrolled up: the oldest shown line stays put.
      await announce(10_010);
      await flushFrames();
      expect(lineCount()).toBe('(10010)');
      expect(messages()).toContain('line 1');
      expect(body.scrollTop).toBe(0);

      await click(autoRefresh());
      expect(autoRefreshOn()).toBe(false);

      // Resuming follows the tail again, restarts auto-refresh, and applies the 10,000-line cap.
      await click(resume);
      await flushFrames();
      expect(panel().querySelector('button[aria-label="Resume scrolling"]')).toBeNull();
      expect(autoRefreshOn()).toBe(true);
      expect(lineCount()).toBe('(10000)');
      expect(messages()).not.toContain('line 1');
      expect(body.scrollTop).toBe(400);
    });
  });

  // The Download menu is the log viewers' menu: Copy to Clipboard through the
  // native clipboard, or Save to File with the same text in a .log file.
  it('copies or saves the shown lines from the Download menu', async () => {
    backendLines([logLine(1, 'Ready')]);
    app.backend.answer('SaveLogFile', () => ({ path: '/tmp/app.log', bytes: 1 }));
    await openPanel();
    const download = async (choice: 'Copy to Clipboard' | 'Save to File') => {
      await click(control('Download logs'));
      await click(
        requireValue(
          Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
            (item) => item.textContent === choice
          ),
          `expected the ${choice} choice`
        )
      );
    };

    await download('Copy to Clipboard');
    const copied = vi.mocked(Clipboard.SetText).mock.calls.map(([text]) => text);
    expect(copied).toEqual([expect.stringContaining('[core] [Global] Ready')]);

    await download('Save to File');
    expect(app.backend.calls('SaveLogFile')).toEqual([
      [expect.stringMatching(/^luxury-yacht-app-logs-\d{14}\.log$/), copied[0]],
    ]);
  });

  it('clears the lines on demand', async () => {
    backendLines([logLine(1, 'Ready')]);
    await openPanel();

    await click(control('Clear logs'));

    expect(app.backend.calls('ClearAppLogs')).toHaveLength(1);
    expect(rows()).toEqual([]);
  });

  it('tabs into and back out of the log body', async () => {
    backendLines([logLine(1, 'Ready')]);
    await openPanel();
    const logs = requireValue(
      panel().querySelector<HTMLElement>('.app-logs-table .gridtable--body'),
      'log body'
    );
    const previous = requireValue(
      panel().querySelector<HTMLElement>('[aria-label="Resize Cluster column"]'),
      'preceding column resizer'
    );
    await act(async () => previous.focus());
    expect(logs.tabIndex).toBe(0);

    await act(async () => {
      previous.dispatchEvent(keydown('Tab'));
    });
    expect(document.activeElement).toBe(logs);
    await act(async () => {
      logs.dispatchEvent(keydown('Tab', { shiftKey: true }));
    });
    expect(document.activeElement).toBe(previous);
  });
});
