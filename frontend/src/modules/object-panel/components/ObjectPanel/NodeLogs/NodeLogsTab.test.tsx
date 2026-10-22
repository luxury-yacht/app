/**
 * frontend/src/modules/object-panel/components/ObjectPanel/NodeLogs/NodeLogsTab.test.tsx
 *
 * The Node Logs tab: source selection, reads and incremental refreshes of the
 * node's logs, filtering and formats, the log buffer, copy/save, and keyboard
 * shortcuts. Runs inside the real app shell (keyboard, zoom, preferences,
 * data-access broker) over a faked backend (test-utils/appState); node logs
 * reach it only through the FetchNodeLogs RPC.
 */

import { AppRegionNavigation } from '@ui/layout/AppRegionNavigation';
import { useKeyboardSurface } from '@ui/shortcuts';
import { KeyboardScopePriority } from '@ui/shortcuts/priorities';
import { Clipboard } from '@wailsio/runtime';
import { act, type ReactNode, useRef } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OBJ_PANEL_LOGS_BUFFER_DEFAULT_SIZE,
  setAutoRefreshEnabled,
  setObjPanelLogsBufferMaxSize,
} from '@/core/settings/appPreferences';
import { objectPanelId } from '@/modules/object-panel/objectPanelRef';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import type { BackendArgs, BackendResult } from '@/test-utils/appState/transport';
import { requireValue } from '@/test-utils/requireValue';
import { useKeyboardContext } from '@/ui/shortcuts/context';
import NodeLogsTab from './NodeLogsTab';
import type { NodeLogSource } from './nodeLogsApi';

type NodeLogResponse = BackendResult<'FetchNodeLogs'>;
type NodeLogRequest = BackendArgs<'FetchNodeLogs'>[1];

const app = installAppStateHarness();

/** The last item, or undefined for an empty list. */
const last = <T,>(items: readonly T[]): T | undefined => items[items.length - 1];

describe('NodeLogsTab', () => {
  let dev: TestCluster;
  let view: MountedApp;

  const sources: NodeLogSource[] = [
    {
      id: 'journal/kubelet',
      label: 'journal / kubelet',
      kind: 'journal',
      path: 'journal/kubelet',
    },
    {
      id: 'journal/containerd',
      label: 'journal / containerd',
      kind: 'journal',
      path: 'journal/containerd',
    },
  ];
  const nodeIdentity = { group: '', version: 'v1', kind: 'Node', namespace: '', name: 'node-a' };
  const nodeRef = () => ({ clusterId: dev.clusterId, ...nodeIdentity });

  beforeAll(() => {
    if (!Element.prototype.scrollIntoView) {
      Element.prototype.scrollIntoView = vi.fn();
    }
  });

  beforeEach(() => {
    dev = app.cluster({ name: 'dev', context: 'alpha' });
    app.namespaces(dev, ['default']);
    vi.mocked(Clipboard.SetText).mockReset().mockResolvedValue(undefined);
    // Mirrors backend/preferences_settings.go UpdateAppPreferences.
    app.backend.answer('UpdateAppPreferences', (request) => ({
      settings: null,
      changedKeys: (request.changes ?? []).map((change) => change.key),
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const container = () => view.container;

  const sourceFor = (path: string) =>
    sources.find((source) => source.path === path) ?? (sources[0] as NodeLogSource);

  /**
   * Mirrors backend/node_logs.go FetchNodeLogs: the requested source's content.
   * Successive reads take successive answers; the last one repeats. An Error
   * answer fails that read.
   */
  const answerNodeLogs = (
    ...answers: Array<string | Error | ((request: NodeLogRequest) => Partial<NodeLogResponse>)>
  ) => {
    let read = 0;
    app.backend.answer('FetchNodeLogs', (_target, request) => {
      const answer = answers[Math.min(read, answers.length - 1)];
      read += 1;
      if (answer instanceof Error) {
        throw answer;
      }
      const response = typeof answer === 'function' ? answer(request) : { content: answer };
      return {
        source: sourceFor(request.sourcePath),
        sourcePath: request.sourcePath,
        ...response,
      };
    });
  };

  const nodeLogReads = () => app.backend.calls('FetchNodeLogs');

  const tab = (props: Partial<React.ComponentProps<typeof NodeLogsTab>> = {}) => (
    <NodeLogsTab
      panelId={objectPanelId(app.object(dev, nodeIdentity).ref)}
      nodeName="node-a"
      clusterId={dev.clusterId}
      isActive
      availability={{ allowed: true, pending: false }}
      sources={sources}
      {...props}
    />
  );

  // The tab sits in the object panel, inside the app's content region.
  const showInApp = async (ui: ReactNode) => {
    view = await app.render(null);
    await view.show(
      <>
        <AppRegionNavigation />
        <main data-app-region="content">{ui}</main>
      </>
    );
  };

  const renderTab = async (props?: Partial<React.ComponentProps<typeof NodeLogsTab>>) => {
    await showInApp(tab(props));
  };

  const advance = async (ms: number) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
    await app.settle();
  };

  // Opens the search row (filter box and search options) unless it is already open.
  const openSearch = async (): Promise<void> => {
    const button = requireValue(
      container().querySelector<HTMLButtonElement>('button[aria-label="Search logs"]'),
      'expected the search button'
    );
    if (button.getAttribute('aria-expanded') === 'true') {
      return;
    }
    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
  };

  const setFilterValue = async (value: string): Promise<void> => {
    await openSearch();
    const filterInput = requireValue(
      container().querySelector<HTMLInputElement>('input[aria-label="Filter node logs"]'),
      'expected the filter box'
    );
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setValue?.call(filterInput, value);
      filterInput.dispatchEvent(new Event('change', { bubbles: true }));
      filterInput.dispatchEvent(new Event('input', { bubbles: true }));
      await Promise.resolve();
    });
  };

  // Clicks the filter mode button until it shows the given mode.
  const chooseFilterMode = async (label: 'All' | 'Filtered' | 'Invert'): Promise<void> => {
    for (let step = 0; step < 3; step += 1) {
      const button = requireValue(
        container().querySelector<HTMLButtonElement>('button[aria-label^="Filter mode:"]'),
        'expected the filter mode button'
      );
      if (button.getAttribute('aria-label') === `Filter mode: ${label}`) {
        return;
      }
      await act(async () => {
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await Promise.resolve();
      });
    }
    throw new Error(`filter mode ${label} was not reached`);
  };

  // Shows only the lines that match; the default mode, All, only highlights them.
  const filterLogsBy = async (value: string): Promise<void> => {
    await setFilterValue(value);
    await chooseFilterMode('Filtered');
  };

  // Clicks the format button until the logs show the given format.
  const showLogFormat = async (label: 'Pretty' | 'Table'): Promise<void> => {
    for (let step = 0; step < 3; step += 1) {
      const button = requireValue(
        container().querySelector<HTMLButtonElement>('button[aria-label^="Log format:"]'),
        'expected the format button'
      );
      if (button.getAttribute('aria-label') === `Log format: ${label}`) {
        return;
      }
      await act(async () => {
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await Promise.resolve();
        await Promise.resolve();
      });
    }
    throw new Error(`format ${label} was not reached`);
  };

  const openSourcePicker = async (): Promise<void> => {
    await act(async () => {
      requireValue(
        container().querySelector('button[aria-label="Node log source"]'),
        'expected the source picker'
      ).dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
  };

  const selectSource = async (label: string): Promise<void> => {
    await openSourcePicker();
    const option = Array.from(document.body.querySelectorAll<HTMLElement>('.dropdown-option')).find(
      (node) => node.textContent?.includes(label)
    );
    await act(async () => {
      requireValue(option, `expected the ${label} source`).dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      );
      await Promise.resolve();
    });
    await app.settle();
  };

  const logText = () => container().querySelector('.logs-viewer-text')?.textContent;
  const logLines = () =>
    Array.from(container().querySelectorAll('.log-viewer-line'), (element) => element.textContent);

  const waitForAnimationFrames = async (count: number): Promise<void> => {
    await act(async () => {
      for (let index = 0; index < count; index += 1) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
    });
  };

  /** Lays every element out as 500px of content in a 100px viewport. */
  const withTallContent = async (run: () => Promise<void>) => {
    const originals = ['scrollHeight', 'clientHeight'].map(
      (property) =>
        [property, Object.getOwnPropertyDescriptor(HTMLElement.prototype, property)] as const
    );
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get: () => 500,
    });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get: () => 100,
    });
    try {
      await run();
    } finally {
      for (const [property, original] of originals) {
        if (original) {
          Object.defineProperty(HTMLElement.prototype, property, original);
        } else {
          Reflect.deleteProperty(HTMLElement.prototype, property);
        }
      }
    }
  };

  it('shows a selection prompt instead of auto-loading the first source', async () => {
    answerNodeLogs('line one\nline two');

    await renderTab();

    expect(nodeLogReads()).toEqual([]);
    expect(container().textContent).toContain('Select a log source to view logs.');
    expect(
      container().querySelector('button[aria-label="Node log source"] .dropdown-value')?.textContent
    ).toBe('Select source');
  });

  // Arrow and page keys stay native on the focused output; Home and End are the
  // shared log shortcuts, which scroll the output to the top and bottom.
  it('tabs into raw output and keeps its scrolling keys working', async () => {
    answerNodeLogs('first\nsecond');
    await renderTab();
    await selectSource('kubelet');
    const output = requireValue(
      container().querySelector<HTMLElement>('.logs-viewer-content'),
      'node log output'
    );
    const controls = Array.from(
      container().querySelectorAll<HTMLButtonElement>('.icon-bar button')
    );
    const previous = requireValue(controls[controls.length - 1], 'last log toolbar control');
    await act(async () => previous.focus());
    await act(async () =>
      previous.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
      )
    );
    expect(document.activeElement).toBe(output);
    for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown']) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      await act(async () => output.dispatchEvent(event));
      expect(event.defaultPrevented, key).toBe(false);
    }
    const scrollTo = vi.fn();
    output.scrollTo = scrollTo;
    Object.defineProperty(output, 'scrollHeight', { configurable: true, value: 480 });
    for (const key of ['Home', 'End']) {
      await act(async () =>
        output.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
      );
    }
    expect(scrollTo.mock.calls).toEqual([
      [{ top: 0, behavior: 'auto' }],
      [{ top: 480, behavior: 'auto' }],
    ]);
    await act(async () =>
      output.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Tab',
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        })
      )
    );
    expect(document.activeElement).toBe(previous);
  });

  it('reads the selected source for the complete node, again when the source changes', async () => {
    answerNodeLogs((request) => ({ content: `content for ${request.sourcePath}` }));

    await renderTab();
    await selectSource('kubelet');
    await selectSource('containerd');

    expect(last(nodeLogReads())).toEqual([
      nodeRef(),
      { sourcePath: 'journal/containerd', tailBytes: 262144 },
    ]);
    expect(logText()).toContain('content for journal/containerd');
  });

  it('renders node log sources as grouped tree-like dropdown options', async () => {
    await renderTab({
      sources: [
        {
          id: 'aws-routed-eni/ipamd.log',
          label: 'aws-routed-eni / ipamd.log',
          kind: 'path',
          path: 'aws-routed-eni/ipamd.log',
        },
        {
          id: 'aws-routed-eni/plugin.log',
          label: 'aws-routed-eni / plugin.log',
          kind: 'path',
          path: 'aws-routed-eni/plugin.log',
        },
        {
          id: 'private',
          label: 'private',
          kind: 'path',
          path: 'private',
        },
      ],
    });

    expect(
      container().querySelector('button[aria-label="Node log source"] .dropdown-value')?.textContent
    ).toBe('Select source');

    await openSourcePicker();

    const groupHeader = document.body.querySelector('.dropdown-group-header');
    expect(groupHeader?.textContent).toBe('aws-routed-eni');

    const optionLabels = Array.from(document.body.querySelectorAll('.dropdown-option')).map(
      (node) => node.textContent?.replace(/\s+/g, ' ').trim()
    );
    expect(optionLabels).toContain('ipamd.log');
    expect(optionLabels).toContain('plugin.log');
    expect(optionLabels).toContain('private');
  });

  it('filters rendered log lines client-side', async () => {
    answerNodeLogs('info boot complete\nerror failed to reconcile');

    await renderTab();
    await selectSource('kubelet');
    await filterLogsBy('error');

    expect(logText()).toBe('error failed to reconcile');
    expect(nodeLogReads()).toHaveLength(1);
  });

  // As in Container Logs, the shown/total count shows only while a filter narrows the logs.
  it('shows the log count only while a text filter is applied', async () => {
    answerNodeLogs('info boot complete\nerror failed to reconcile');
    const strip = () => container().querySelector('[aria-label="Active log filters"]');

    await renderTab();
    expect(strip()).toBeNull();
    await selectSource('kubelet');
    expect(strip()).toBeNull();

    await filterLogsBy('error');
    expect(strip()?.querySelector('.logs-viewer-count')?.textContent).toBe('1/2 logs');

    await filterLogsBy('  ');
    expect(strip()?.querySelector('.logs-viewer-count') ?? null).toBeNull();
  });

  // The search chips are Container Logs' chips: the text filter and each search
  // option that differs from its default. Clear all resets them all.
  it('shows the search chips and clears them all', async () => {
    answerNodeLogs('info boot complete\nerror failed to reconcile');
    const chipLabels = () =>
      Array.from(
        container().querySelectorAll('[aria-label="Active log filters"] .active-filter-chip__label')
      ).map((label) => label.textContent);

    await renderTab();
    await selectSource('kubelet');
    await filterLogsBy('error');
    await act(async () => {
      requireValue(
        container().querySelector<HTMLButtonElement>('button[aria-label^="Case-sensitive search"]'),
        'expected the Match case button'
      ).click();
      await Promise.resolve();
    });
    expect(chipLabels()).toEqual(['Text: error', 'Filtered', 'Match case']);

    await act(async () => {
      requireValue(
        container().querySelector<HTMLButtonElement>('button[aria-label="Clear all filters"]'),
        'expected Clear all'
      ).click();
      await Promise.resolve();
    });
    expect(container().querySelector('[aria-label="Active log filters"]')).toBeNull();
    expect(
      container().querySelector('button[aria-label^="Filter mode:"]')?.getAttribute('aria-label')
    ).toBe('Filter mode: All');
    expect(container().textContent).toContain('info boot complete');
  });

  it('clears the text filter from the filter box and shows every line again', async () => {
    answerNodeLogs('info boot complete\nerror failed to reconcile');

    await renderTab();
    await selectSource('kubelet');
    await setFilterValue('error');
    const clearButton = requireValue(
      container().querySelector<HTMLButtonElement>('button[aria-label="Clear filter"]'),
      'clear filter button'
    );
    await act(async () => clearButton.click());

    expect(
      container().querySelector<HTMLInputElement>('input[aria-label="Filter node logs"]')?.value
    ).toBe('');
    expect(logText()).toBe('info boot completeerror failed to reconcile');
    expect(container().querySelector('button[aria-label="Clear filter"]')).toBeNull();
  });

  it('can invert the filter from the filter mode button', async () => {
    answerNodeLogs('info boot complete\nerror failed to reconcile');

    await renderTab();
    await selectSource('kubelet');
    await setFilterValue('error');

    await chooseFilterMode('Invert');

    expect(logText()).toBe('info boot complete');
  });

  it('highlights matches without hiding other lines by default', async () => {
    answerNodeLogs('info boot complete\nerror failed to reconcile');

    await renderTab();
    await selectSource('kubelet');
    await setFilterValue('error');

    // All, the default, keeps every line and highlights the match.
    const highlightedMatch = container().querySelector('mark.log-viewer-highlight');
    expect(highlightedMatch?.textContent).toBe('error');
    expect(container().textContent).toContain('info boot complete');
  });

  it('highlights ANSI-colored node log text in the DOM renderer', async () => {
    answerNodeLogs('\u001b[31merror\u001b[0m failed to reconcile');

    await renderTab();
    await selectSource('kubelet');
    await setFilterValue('error');

    const highlightedMatch = container().querySelector(
      '.log-viewer-line mark.log-viewer-highlight'
    );
    expect(highlightedMatch?.textContent).toBe('error');
    expect(highlightedMatch?.closest('span[style*="color"]')).toBeTruthy();
    expect(container().querySelector('.read-only-terminal-surface')).toBeNull();
  });

  it('supports no-wrap for ANSI-colored node logs in the DOM renderer', async () => {
    answerNodeLogs('\u001b[31merror\u001b[0m failed to reconcile');

    await renderTab();
    await selectSource('kubelet');

    const wrapButton = requireValue(
      container().querySelector<HTMLButtonElement>('button[aria-label="Wrap text"]'),
      'expected the Wrap text button'
    );
    await act(async () => {
      wrapButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(container().querySelector('.logs-viewer-text.no-wrap')).toBeTruthy();
    expect(container().querySelector('.log-viewer-line span[style*="color"]')).toBeTruthy();
    expect(container().querySelector('.read-only-terminal-surface')).toBeNull();
  });

  it('shows an invalid regex error only when the filter would hide lines', async () => {
    answerNodeLogs('info boot complete\nerror failed to reconcile');

    await renderTab();
    await selectSource('kubelet');
    await openSearch();

    const regexButton = requireValue(
      container().querySelector<HTMLButtonElement>(
        'button[aria-label="Enable regular expression support for the text filter"]'
      ),
      'expected the regex button'
    );
    await act(async () => {
      regexButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    await setFilterValue('[');

    // All only highlights matches, so the lines stay readable and the chip says
    // the expression is invalid.
    expect(container().textContent).not.toContain('Enter a valid regular expression.');
    expect(container().textContent).toContain('error failed to reconcile');
    expect(
      container().querySelector('[aria-label="Active log filters"] .active-filter-chip__label')
        ?.textContent
    ).toBe('Regex: [ (invalid expression)');

    await chooseFilterMode('Filtered');
    expect(container().textContent).toContain('Enter a valid regular expression.');
    expect(container().textContent).not.toContain('error failed to reconcile');
  });

  it('can pretty-print JSON logs from the icon bar', async () => {
    answerNodeLogs('{"level":"info","message":"boot complete"}');

    await renderTab();
    await selectSource('kubelet');

    await showLogFormat('Pretty');

    expect(logLines()).toContain('{');
    expect(logLines()).toContain('  "message": "boot complete"');
    expect(logLines()).toContain('}');
  });

  it('can render parseable JSON logs as a table from the icon bar', async () => {
    answerNodeLogs('{"level":"info","message":"boot complete"}');

    await renderTab();
    await selectSource('kubelet');

    await showLogFormat('Table');

    expect(container().querySelector('.parsed-logs-table')).toBeTruthy();
    expect(container().textContent).toContain('level');
    expect(container().textContent).toContain('message');
    expect(container().textContent).toContain('boot complete');
  });

  it('exports parsed node columns as data, including metadata-like keys and nested values', async () => {
    answerNodeLogs(
      JSON.stringify({
        _pod: 'literal',
        level: 'info',
        count: 0,
        enabled: false,
        extra: { value: 'x' },
        message: 'boot, complete',
      })
    );
    await renderTab();
    await selectSource('kubelet');
    await showLogFormat('Table');
    await act(async () => {
      requireValue(
        container().querySelector('button[aria-label="Download logs"]'),
        'download control'
      ).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {
      requireValue(
        Array.from(document.body.querySelectorAll('[role="menuitem"]')).find(
          (item) => item.textContent === 'Copy to Clipboard'
        ),
        'copy choice'
      ).dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    expect(Clipboard.SetText).toHaveBeenCalledWith(
      'level,_pod,count,enabled,extra,message\ninfo,literal,0,false,"{""value"":""x""}","boot, complete"'
    );
  });

  it('supports parsed-table row expansion and collapse like container logs', async () => {
    answerNodeLogs('{"level":"info","message":"boot complete"}');

    await renderTab();
    await selectSource('kubelet');

    await showLogFormat('Table');

    const row = requireValue(
      container().querySelector<HTMLElement>('.parsed-logs-table .gridtable-row'),
      'expected a parsed row'
    );
    expect(row.classList.contains('parsed-row-expanded')).toBe(false);

    await act(async () => {
      row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(row.classList.contains('parsed-row-expanded')).toBe(true);

    await act(async () => {
      row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(row.classList.contains('parsed-row-expanded')).toBe(false);
  });

  /** The buffer-full indicator's tooltip, or null when it is not shown. */
  const bufferFullMessage = async (): Promise<string | null | undefined> => {
    const indicator = container().querySelector<HTMLElement>(
      '.logs-viewer-controls [aria-label="Log buffer is full"]'
    );
    if (!indicator) {
      return null;
    }
    const wasFake = vi.isFakeTimers();
    if (!wasFake) {
      vi.useFakeTimers();
    }
    try {
      await act(async () => {
        indicator.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      });
      await act(async () => {
        vi.advanceTimersByTime(250);
      });
      const message = document.body.querySelector('.tooltip')?.textContent;
      await act(async () => {
        indicator.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
        vi.advanceTimersByTime(250);
      });
      return message;
    } finally {
      if (!wasFake) {
        vi.useRealTimers();
      }
    }
  };

  // Same indicator as Container Logs: a warning icon beside the toolbar whose
  // tooltip says what is shown, instead of a bar above the lines.
  it('shows a truncated response as the buffer-full indicator beside the toolbar', async () => {
    answerNodeLogs(() => ({ content: 'recent log line', truncated: true }));

    await renderTab();
    await selectSource('kubelet');

    expect(container().querySelector('.logs-viewer-warning-bar')).toBeNull();
    expect(await bufferFullMessage()).toBe(
      'Log buffer is full. Only showing the most recent 1 log.'
    );
  });

  it('reports a node-log failure displayed inline', async () => {
    answerNodeLogs(new Error('node log access denied'));

    await renderTab();
    await selectSource('kubelet');

    expect(container().textContent).toContain('Error: node log access denied');
    // Another source must stay selectable when this one cannot be read.
    expect(container().querySelector('button[aria-label="Node log source"]')).not.toBeNull();
    const reports = app.errors.take((record) => record.kinds.includes('inline'));
    expect(reports.map((record) => record.context)).toEqual([
      { action: 'loadNodeLogs', source: 'NodeLogsTab', clusterId: dev.clusterId },
    ]);
  });

  it('shows a pending availability message before sources are known', async () => {
    await renderTab({
      availability: { allowed: false, pending: true },
      sources: [],
    });

    expect(container().textContent).toContain('Checking if logs are available for this node...');
  });

  it('shows the unavailable message and omits the error line when no reason is provided', async () => {
    await renderTab({
      availability: { allowed: false, pending: false },
      sources: [],
    });

    expect(container().textContent).toContain('Logs are not available on this node');
    expect(container().textContent).not.toContain('Error:');
  });

  it('shows the unavailable message and error line when a reason is provided', async () => {
    await renderTab({
      availability: {
        allowed: false,
        pending: false,
        reason: 'the server does not allow this method on the requested resource',
      },
      sources: [],
    });

    expect(container().textContent).toContain('Logs are not available on this node');
    expect(container().textContent).toContain(
      'Error: the server does not allow this method on the requested resource'
    );
  });

  it('defaults raw node logs to the newest visible content', async () => {
    answerNodeLogs('line one\nline two\nline three');

    await withTallContent(async () => {
      await renderTab();
      await selectSource('kubelet');
      await waitForAnimationFrames(2);

      const content = requireValue(
        container().querySelector<HTMLElement>('.logs-viewer-content'),
        'node log output'
      );
      expect(content.scrollTop).toBe(500);
    });
  });

  it('resets to the newest content when switching to a different node log source', async () => {
    answerNodeLogs((request) => ({ content: `content for ${request.sourcePath}` }));

    await withTallContent(async () => {
      await renderTab();
      await selectSource('kubelet');

      const content = requireValue(
        container().querySelector<HTMLElement>('.logs-viewer-content'),
        'node log output'
      );
      await act(async () => {
        content.scrollTop = 40;
        content.dispatchEvent(new Event('scroll', { bubbles: true }));
        await Promise.resolve();
      });

      await selectSource('containerd');
      await waitForAnimationFrames(6);

      expect(content.scrollTop).toBe(500);
    });
  });

  it('clears the previous source logs and shows loading while a new source is fetching', async () => {
    answerNodeLogs((request) => ({ content: `content for ${request.sourcePath}` }));

    await renderTab();
    await selectSource('kubelet');
    expect(logText()).toContain('content for journal/kubelet');

    const release = app.backend.hold('FetchNodeLogs');
    await selectSource('containerd');

    expect(container().textContent).toContain('Loading logs...');
    expect(container().textContent).not.toContain('content for journal/kubelet');

    release();
    await app.settle();

    expect(logText()).toContain('content for journal/containerd');
  });

  it('keeps existing log content mounted during refresh', async () => {
    vi.useFakeTimers();
    let nodeLog = 'line one\nline two';
    answerNodeLogs(() => ({ content: nodeLog }));

    await renderTab();
    await selectSource('kubelet');

    const release = app.backend.hold('FetchNodeLogs');
    await advance(5000);

    expect(nodeLogReads()).toHaveLength(2);
    expect(logText()).toContain('line one');
    expect(container().textContent).not.toContain('Loading logs...');

    nodeLog = 'line one\nline two\nline three';
    release();
    await app.settle();
    expect(logText()).toContain('line three');
  });

  it('appends incremental refresh results using sinceTime with overlap dedupe', async () => {
    vi.useFakeTimers();
    answerNodeLogs('line one\nline two', 'line two\nline three');

    await renderTab();
    await selectSource('kubelet');
    await advance(5000);

    expect(last(nodeLogReads())).toEqual([
      nodeRef(),
      expect.objectContaining({
        sourcePath: 'journal/kubelet',
        tailBytes: 262144,
        sinceTime: expect.any(String),
      }),
    ]);
    expect(logLines()).toEqual(['line one', 'line two', 'line three']);
  });

  // A failed incremental read may be a since-time the node rejects; a full
  // read is the fallback, and only its failure is shown.
  it('falls back to a full read when an incremental refresh fails', async () => {
    vi.useFakeTimers();
    answerNodeLogs('line one', new Error('invalid sinceTime'), 'line one\nline two');

    await renderTab();
    await selectSource('kubelet');
    await advance(5000);

    const reads = nodeLogReads();
    expect(reads).toHaveLength(3);
    expect(reads[1]?.[1]).toHaveProperty('sinceTime', expect.any(String));
    expect(reads[2]?.[1]).not.toHaveProperty('sinceTime', expect.any(String));
    expect(logLines()).toEqual(['line one', 'line two']);
    expect(container().textContent).not.toContain('invalid sinceTime');
  });

  it('keeps current node logs when cluster data is paused before a background refresh', async () => {
    vi.useFakeTimers();
    answerNodeLogs('line one\nline two');

    await renderTab();
    await selectSource('kubelet');
    await act(async () => {
      setAutoRefreshEnabled(false);
    });
    await advance(5000);

    // The broker blocks the background read, so the backend is not asked.
    expect(nodeLogReads()).toHaveLength(1);
    expect(logText()).toContain('line two');
    expect(container().textContent).not.toContain('Loading logs...');
  });

  it('disables search and wrap until the source returns a log line', async () => {
    answerNodeLogs('');
    await renderTab();
    await selectSource('kubelet');

    for (const label of ['Search logs', 'Wrap text']) {
      expect(
        container().querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)?.disabled,
        label
      ).toBe(true);
    }
  });

  // Node Logs keep as many lines as the Object Panel Logs buffer setting allows
  // and say so the same way Container Logs do.
  describe('log buffer', () => {
    const numberedLines = (from: number, to: number) =>
      Array.from({ length: to - from + 1 }, (_, index) => `line ${from + index}`).join('\n');
    const countLabel = () =>
      container().querySelector('[aria-label="Active log filters"] .logs-viewer-count')
        ?.textContent;

    it('keeps only as many lines as the buffer setting allows', async () => {
      const bufferSize = OBJ_PANEL_LOGS_BUFFER_DEFAULT_SIZE;
      answerNodeLogs(numberedLines(1, bufferSize + 200));

      await renderTab();
      await selectSource('kubelet');
      await filterLogsBy('line');

      expect(countLabel()).toBe(`${bufferSize}/${bufferSize} logs`);
      expect(await bufferFullMessage()).toBe(
        `Log buffer is full. Only showing the most recent ${bufferSize} logs.`
      );
    });

    it('trims to the newest lines at once when the buffer setting shrinks', async () => {
      answerNodeLogs(numberedLines(1, 150));

      await renderTab();
      await selectSource('kubelet');
      expect(await bufferFullMessage()).toBeNull();

      await act(async () => {
        setObjPanelLogsBufferMaxSize(100);
      });
      await app.settle();

      const rows = logLines();
      expect(rows[0]).toBe('line 51');
      expect(rows[rows.length - 1]).toBe('line 150');
      expect(await bufferFullMessage()).toBe(
        'Log buffer is full. Only showing the most recent 100 logs.'
      );
    });

    it('still says the buffer is full after a refresh appends lines', async () => {
      vi.useFakeTimers();
      answerNodeLogs(() => ({ content: 'line 1\nline 2', truncated: true }), 'line 3');

      await renderTab();
      await selectSource('kubelet');
      await advance(5000);
      vi.useRealTimers();
      await filterLogsBy('line');

      expect(countLabel()).toBe('3/3 logs');
      expect(await bufferFullMessage()).toBe(
        'Log buffer is full. Only showing the most recent 3 logs.'
      );
    });
  });

  it('keeps the lines and reports a failed background refresh above them', async () => {
    vi.useFakeTimers();
    answerNodeLogs('line one\nline two', new Error('kubelet unreachable'));

    await renderTab();
    await selectSource('kubelet');
    await advance(5000);

    expect(logText()).toContain('line two');
    expect(container().querySelector('[aria-label="Log warnings"]')?.textContent).toContain(
      'kubelet unreachable'
    );
    // The incremental read and its full-read fallback both failed; the tab
    // reports the fallback's failure once.
    expect(
      app.errors
        .take((record) => record.kinds.includes('inline'))
        .map((record) => (record.error as Error).message)
    ).toEqual(['kubelet unreachable']);
  });

  it('says so when a source returns no logs', async () => {
    answerNodeLogs('');

    await renderTab();
    await selectSource('kubelet');

    expect(logText()).toBe('No logs returned for this source.');
  });

  describe('keyboard shortcuts', () => {
    const shortcutHelp: {
      current: ReturnType<typeof useKeyboardContext>['getAvailableShortcuts'] | null;
    } = { current: null };
    const ShortcutHelpProbe = () => {
      shortcutHelp.current = useKeyboardContext().getAvailableShortcuts;
      return null;
    };

    const renderWithProbe = async (isActive = true) => {
      await showInApp(
        <>
          <ShortcutHelpProbe />
          {tab({ isActive })}
        </>
      );
    };

    const press = async (key: string, shiftKey = false) => {
      await act(async () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true }));
        await Promise.resolve();
      });
    };

    // The application menu's Edit items reach the app as runtime events.
    const menu = async (action: 'menu:selectAll' | 'menu:copy') => {
      await act(async () => {
        app.events.emit(action);
        await Promise.resolve();
      });
    };

    const pressed = (label: string) =>
      container().querySelector(`button[aria-label="${label}"]`)?.getAttribute('aria-pressed');

    beforeEach(() => {
      answerNodeLogs('info boot complete\nerror failed to reconcile');
    });

    it('toggles search and display options and copies the shown logs', async () => {
      await renderWithProbe();
      await selectSource('kubelet');
      await setFilterValue('error');
      // Opening search puts the cursor in the filter box, where keys type text.
      act(() => (document.activeElement as HTMLElement | null)?.blur());

      await press('i');
      expect(logText()).toBe('info boot complete');
      expect(pressed('Wrap text')).toBe('true');
      await press('w');
      expect(pressed('Wrap text')).toBe('false');

      await press('c', true);
      expect(Clipboard.SetText).toHaveBeenCalledWith('info boot complete');
    });

    it('offers no timestamp or previous-log shortcuts', async () => {
      await renderWithProbe();
      await selectSource('kubelet');

      const logs = shortcutHelp.current?.().find(({ category }) => category === 'Logs');
      const keys = logs?.shortcuts.map(({ key }) => key) ?? [];
      expect(keys).toEqual(expect.arrayContaining(['r', 'i', 'x', 'w', 'Home', 'End']));
      expect(keys).not.toContain('t');
      expect(keys).not.toContain('v');
    });

    it('ignores shortcuts while the tab is inactive', async () => {
      await renderWithProbe(false);

      await press('w');

      expect(pressed('Wrap text')).toBe('true');
      expect(shortcutHelp.current?.().some(({ category }) => category === 'Logs')).toBe(false);
    });

    it('selects and copies only log text, and reports a failed selection copy', async () => {
      await renderWithProbe();
      await selectSource('kubelet');
      const output = requireValue(
        container().querySelector<HTMLElement>('.logs-viewer-content'),
        'node log output'
      );
      await act(async () => output.focus());
      window.getSelection()?.removeAllRanges();

      await menu('menu:selectAll');
      const selected = window.getSelection();
      expect(selected?.rangeCount).toBe(1);
      expect(output.contains(selected?.getRangeAt(0).commonAncestorContainer ?? null)).toBe(true);

      await menu('menu:copy');
      expect(Clipboard.SetText).toHaveBeenLastCalledWith(
        expect.stringContaining('info boot complete')
      );
      expect(Clipboard.SetText).not.toHaveBeenCalledWith(expect.stringContaining('Download'));

      const failure = new Error('clipboard denied');
      vi.mocked(Clipboard.SetText).mockRejectedValue(failure);
      await menu('menu:copy');
      await app.settle();
      const reports = app.errors.take((record) => record.error === failure);
      expect(reports.map((record) => [record.kinds, record.context?.action])).toEqual([
        [['operational'], 'copySelectedLogText'],
      ]);
    });

    it('reports a copy that fails instead of hiding it', async () => {
      const failure = new Error('clipboard denied');
      vi.mocked(Clipboard.SetText).mockRejectedValue(failure);
      await renderWithProbe();
      await selectSource('kubelet');

      await press('c', true);
      await app.settle();

      const reports = app.errors.take((record) => record.error === failure);
      expect(reports.map((record) => record.context?.action)).toEqual(['copyLogs']);
    });

    describe('Escape while the search row is open', () => {
      const closeTab = vi.fn(() => true);
      // Stands in for the object panel, which closes its tab on Escape.
      const ObjectPanelEscape = ({ children }: { children: ReactNode }) => {
        const panelRef = useRef<HTMLDivElement>(null);
        useKeyboardSurface({
          kind: 'panel',
          rootRef: panelRef,
          priority: KeyboardScopePriority.OBJECT_PANEL,
          captureWhenActive: true,
          onEscape: closeTab,
        });
        return <div ref={panelRef}>{children}</div>;
      };

      const renderInPanel = async () => {
        await showInApp(<ObjectPanelEscape>{tab()}</ObjectPanelEscape>);
        await selectSource('kubelet');
        await openSearch();
      };

      const pressEscape = async () => {
        await act(async () => {
          (document.activeElement ?? document.body).dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
          );
          await Promise.resolve();
        });
      };

      const searchButton = () =>
        requireValue(
          container().querySelector<HTMLButtonElement>('button[aria-label="Search logs"]'),
          'expected the search button'
        );
      const filterInput = () =>
        container().querySelector<HTMLInputElement>('input[aria-label="Filter node logs"]');

      beforeEach(() => closeTab.mockClear());

      it('closes the search row instead of the tab, then the next Escape closes the tab', async () => {
        await renderInPanel();
        expect(document.activeElement).toBe(filterInput());

        await pressEscape();
        expect(filterInput()).toBeNull();
        expect(searchButton().getAttribute('aria-expanded')).toBe('false');
        expect(closeTab).not.toHaveBeenCalled();
        // The focused box is gone, so focus returns to the button that opens it.
        expect(document.activeElement).toBe(searchButton());

        await pressEscape();
        expect(closeTab).toHaveBeenCalledOnce();
      });

      it('closes the search row from the log output and leaves focus there', async () => {
        await renderInPanel();
        const output = requireValue(
          container().querySelector<HTMLElement>('.logs-viewer-content'),
          'node log output'
        );
        await act(async () => output.focus());

        await pressEscape();
        expect(filterInput()).toBeNull();
        expect(closeTab).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(output);
      });
    });
  });
});
