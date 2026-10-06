import { AppRegionNavigation } from '@ui/layout/AppRegionNavigation';
import { KeyboardProvider, useKeyboardSurface } from '@ui/shortcuts';
import { KeyboardScopePriority } from '@ui/shortcuts/priorities';
import { Clipboard } from '@wailsio/runtime';
import { act, useRef } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventBus } from '@/core/events';
import { OBJ_PANEL_LOGS_BUFFER_DEFAULT_SIZE } from '@/core/settings/appPreferences';
import { PanelLayoutTestProvider } from '@/test-utils/PanelLayoutTestProvider';
import { requireValue } from '@/test-utils/requireValue';
import { useKeyboardContext } from '@/ui/shortcuts/context';
import { resetLogViewerPrefsCacheForTesting } from '../Logs/logViewerPrefsCache';
import NodeLogsTab from './NodeLogsTab';
import type { fetchNodeLogs, NodeLogFetchResult } from './nodeLogsApi';

const mockFetchNodeLogs = vi.fn<typeof fetchNodeLogs>();
const handleInlineMock = vi.hoisted(() => vi.fn());

vi.mock('./nodeLogsApi', () => ({
  fetchNodeLogs: (...args: Parameters<typeof fetchNodeLogs>) => mockFetchNodeLogs(...args),
}));

const reportOperationalErrorMock = vi.hoisted(() => vi.fn());

vi.mock('@utils/errorHandler', () => ({
  errorHandler: {
    handleInline: (...args: unknown[]) => handleInlineMock(...args),
  },
  reportOperationalError: (...args: unknown[]) => reportOperationalErrorMock(...args),
}));

vi.mock('@core/contexts/ZoomContext', () => ({
  useZoom: () => ({ zoomLevel: 100 }),
}));

describe('NodeLogsTab', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  const sources = [
    {
      id: 'journal/kubelet',
      label: 'journal / kubelet',
      kind: 'journal' as const,
      path: 'journal/kubelet',
    },
    {
      id: 'journal/containerd',
      label: 'journal / containerd',
      kind: 'journal' as const,
      path: 'journal/containerd',
    },
  ];

  beforeAll(() => {
    if (!Element.prototype.scrollIntoView) {
      Element.prototype.scrollIntoView = vi.fn();
    }
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    mockFetchNodeLogs.mockReset();
    handleInlineMock.mockReset();
    handleInlineMock.mockImplementation((error: unknown) => ({
      message: error instanceof Error ? error.message : String(error),
    }));
    resetLogViewerPrefsCacheForTesting();
    vi.mocked(Clipboard.SetText).mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const renderTab = async (
    props?: Partial<React.ComponentProps<typeof NodeLogsTab>>
  ): Promise<void> => {
    await act(async () => {
      root.render(
        <PanelLayoutTestProvider>
          <KeyboardProvider>
            <AppRegionNavigation />
            <main data-app-region="content">
              <NodeLogsTab
                panelId="panel-1"
                nodeName="node-a"
                clusterId="alpha:ctx"
                isActive
                availability={{ allowed: true, pending: false }}
                sources={sources}
                {...props}
              />
            </main>
          </KeyboardProvider>
        </PanelLayoutTestProvider>
      );
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  // Opens the search row (filter box and search options) unless it is already open.
  const openSearch = async (): Promise<void> => {
    const button = requireValue(
      container.querySelector<HTMLButtonElement>('button[aria-label="Search logs"]'),
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
    const filterInput = container.querySelector<HTMLInputElement>(
      'input[aria-label="Filter node logs"]'
    );
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setValue?.call(filterInput, value);
      requireValue(filterInput, 'expected test value in NodeLogsTab.test.tsx').dispatchEvent(
        new Event('change', { bubbles: true })
      );
      requireValue(filterInput, 'expected test value in NodeLogsTab.test.tsx').dispatchEvent(
        new Event('input', { bubbles: true })
      );
      await Promise.resolve();
    });
  };

  // Clicks the filter mode button until it shows the given mode.
  const chooseFilterMode = async (label: 'All' | 'Filtered' | 'Invert'): Promise<void> => {
    for (let step = 0; step < 3; step += 1) {
      const button = requireValue(
        container.querySelector<HTMLButtonElement>('button[aria-label^="Filter mode:"]'),
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
        container.querySelector<HTMLButtonElement>('button[aria-label^="Log format:"]'),
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

  const selectSource = async (label: string): Promise<void> => {
    const trigger = container.querySelector('button[aria-label="Node log source"]');
    await act(async () => {
      requireValue(trigger, 'expected test value in NodeLogsTab.test.tsx').dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      );
      await Promise.resolve();
    });

    const option = Array.from(document.body.querySelectorAll<HTMLElement>('.dropdown-option')).find(
      (node) => node.textContent?.includes(label)
    );
    await act(async () => {
      requireValue(option, 'expected test value in NodeLogsTab.test.tsx').dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      );
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  const waitForAnimationFrames = async (count: number): Promise<void> => {
    await act(async () => {
      for (let index = 0; index < count; index += 1) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
    });
  };

  it('shows a selection prompt instead of auto-loading the first source', async () => {
    mockFetchNodeLogs.mockResolvedValue({
      status: 'executed',
      data: {
        source: sources[0],
        sourcePath: sources[0].path,
        content: 'line one\nline two',
      },
    });

    await renderTab();

    expect(mockFetchNodeLogs).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Select a log source to view logs.');
    expect(
      container.querySelector('button[aria-label="Node log source"] .dropdown-value')?.textContent
    ).toBe('Select source');
  });

  // Arrow and page keys stay native on the focused output; Home and End are the
  // shared log shortcuts, which scroll the output to the top and bottom.
  it('tabs into raw output and keeps its scrolling keys working', async () => {
    mockFetchNodeLogs.mockResolvedValue({
      status: 'executed',
      data: {
        source: sources[0],
        sourcePath: sources[0].path,
        content: 'first\nsecond',
      },
    });
    await renderTab();
    await selectSource('kubelet');
    const output = requireValue(
      container.querySelector<HTMLElement>('.logs-viewer-content'),
      'node log output'
    );
    const controls = Array.from(container.querySelectorAll<HTMLButtonElement>('.icon-bar button'));
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

  it('refetches when the selected source changes', async () => {
    mockFetchNodeLogs.mockImplementation(
      async (_clusterId: string, _nodeName: string, request: { sourcePath: string }) => ({
        status: 'executed',
        data: {
          source: sources.find((source) => source.path === request.sourcePath) ?? sources[0],
          sourcePath: request.sourcePath,
          content: `content for ${request.sourcePath}`,
        },
      })
    );

    await renderTab();
    await selectSource('kubelet');
    await selectSource('containerd');

    expect(mockFetchNodeLogs).toHaveBeenLastCalledWith('alpha:ctx', 'node-a', {
      sourcePath: 'journal/containerd',
      tailBytes: 262144,
    });
    expect(container.querySelector('.logs-viewer-text')?.textContent).toContain(
      'content for journal/containerd'
    );
  });

  it('renders node log sources as grouped tree-like dropdown options', async () => {
    mockFetchNodeLogs.mockResolvedValue({
      status: 'executed',
      data: {
        source: sources[0],
        sourcePath: sources[0].path,
        content: 'line one',
      },
    });

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

    const trigger = container.querySelector('button[aria-label="Node log source"]');
    expect(trigger).toBeTruthy();
    expect(
      container.querySelector('button[aria-label="Node log source"] .dropdown-value')?.textContent
    ).toBe('Select source');

    await act(async () => {
      requireValue(trigger, 'expected test value in NodeLogsTab.test.tsx').dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      );
      await Promise.resolve();
    });

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
    mockFetchNodeLogs.mockResolvedValue({
      status: 'executed',
      data: {
        source: sources[0],
        sourcePath: sources[0].path,
        content: 'info boot complete\nerror failed to reconcile',
      },
    });

    await renderTab();
    await selectSource('kubelet');
    await filterLogsBy('error');

    expect(container.querySelector('.logs-viewer-text')?.textContent).toBe(
      'error failed to reconcile'
    );
  });

  // As in Container Logs, the shown/total count shows only while a filter narrows the logs.
  it('shows the log count only while a text filter is applied', async () => {
    mockFetchNodeLogs.mockResolvedValue({
      status: 'executed',
      data: {
        source: sources[0],
        sourcePath: sources[0].path,
        content: 'info boot complete\nerror failed to reconcile',
      },
    });

    const strip = () => container.querySelector('[aria-label="Active log filters"]');
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
    mockFetchNodeLogs.mockResolvedValue({
      status: 'executed',
      data: {
        source: sources[0],
        sourcePath: sources[0].path,
        content: 'info boot complete\nerror failed to reconcile',
      },
    });
    const chipLabels = () =>
      Array.from(
        container.querySelectorAll('[aria-label="Active log filters"] .active-filter-chip__label')
      ).map((label) => label.textContent);

    await renderTab();
    await selectSource('kubelet');
    await filterLogsBy('error');
    await act(async () => {
      requireValue(
        container.querySelector<HTMLButtonElement>('button[aria-label^="Case-sensitive search"]'),
        'expected the Match case button'
      ).click();
      await Promise.resolve();
    });
    expect(chipLabels()).toEqual(['Text: error', 'Filtered', 'Match case']);

    await act(async () => {
      requireValue(
        container.querySelector<HTMLButtonElement>('button[aria-label="Clear all filters"]'),
        'expected Clear all'
      ).click();
      await Promise.resolve();
    });
    expect(container.querySelector('[aria-label="Active log filters"]')).toBeNull();
    expect(
      container.querySelector('button[aria-label^="Filter mode:"]')?.getAttribute('aria-label')
    ).toBe('Filter mode: All');
    expect(container.textContent).toContain('info boot complete');
  });

  it('clears the text filter from the filter box and shows every line again', async () => {
    mockFetchNodeLogs.mockResolvedValue({
      status: 'executed',
      data: {
        source: sources[0],
        sourcePath: sources[0].path,
        content: 'info boot complete\nerror failed to reconcile',
      },
    });

    await renderTab();
    await selectSource('kubelet');
    await setFilterValue('error');
    const clearButton = requireValue(
      container.querySelector<HTMLButtonElement>('button[aria-label="Clear filter"]'),
      'clear filter button'
    );
    await act(async () => clearButton.click());

    expect(
      container.querySelector<HTMLInputElement>('input[aria-label="Filter node logs"]')?.value
    ).toBe('');
    expect(container.querySelector('.logs-viewer-text')?.textContent).toBe(
      'info boot completeerror failed to reconcile'
    );
    expect(container.querySelector('button[aria-label="Clear filter"]')).toBeNull();
  });

  it('can invert the filter from the filter mode button', async () => {
    mockFetchNodeLogs.mockResolvedValue({
      status: 'executed',
      data: {
        source: sources[0],
        sourcePath: sources[0].path,
        content: 'info boot complete\nerror failed to reconcile',
      },
    });

    await renderTab();
    await selectSource('kubelet');
    await setFilterValue('error');

    await chooseFilterMode('Invert');

    expect(container.querySelector('.logs-viewer-text')?.textContent).toBe('info boot complete');
  });

  it('highlights matches without hiding other lines by default', async () => {
    mockFetchNodeLogs.mockResolvedValue({
      status: 'executed',
      data: {
        source: sources[0],
        sourcePath: sources[0].path,
        content: 'info boot complete\nerror failed to reconcile',
      },
    });

    await renderTab();
    await selectSource('kubelet');
    await setFilterValue('error');

    // All, the default, keeps every line and highlights the match.
    const highlightedMatch = container.querySelector('mark.log-viewer-highlight');
    expect(highlightedMatch?.textContent).toBe('error');
    expect(container.textContent).toContain('info boot complete');
  });

  it('highlights ANSI-colored node log text in the DOM renderer', async () => {
    mockFetchNodeLogs.mockResolvedValue({
      status: 'executed',
      data: {
        source: sources[0],
        sourcePath: sources[0].path,
        content: '\u001b[31merror\u001b[0m failed to reconcile',
      },
    });

    await renderTab();
    await selectSource('kubelet');
    await setFilterValue('error');

    const highlightedMatch = container.querySelector('.log-viewer-line mark.log-viewer-highlight');
    expect(highlightedMatch?.textContent).toBe('error');
    expect(highlightedMatch?.closest('span[style*="color"]')).toBeTruthy();
    expect(container.querySelector('.read-only-terminal-surface')).toBeNull();
  });

  it('supports no-wrap for ANSI-colored node logs in the DOM renderer', async () => {
    mockFetchNodeLogs.mockResolvedValue({
      status: 'executed',
      data: {
        source: sources[0],
        sourcePath: sources[0].path,
        content: '\u001b[31merror\u001b[0m failed to reconcile',
      },
    });

    await renderTab();
    await selectSource('kubelet');

    const wrapButton = container.querySelector<HTMLButtonElement>('button[aria-label="Wrap text"]');
    expect(wrapButton).toBeTruthy();

    await act(async () => {
      requireValue(wrapButton, 'expected test value in NodeLogsTab.test.tsx').dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      );
      await Promise.resolve();
    });

    expect(container.querySelector('.logs-viewer-text.no-wrap')).toBeTruthy();
    expect(container.querySelector('.log-viewer-line span[style*="color"]')).toBeTruthy();
    expect(container.querySelector('.read-only-terminal-surface')).toBeNull();
  });

  it('shows an invalid regex error only when the filter would hide lines', async () => {
    mockFetchNodeLogs.mockResolvedValue({
      status: 'executed',
      data: {
        source: sources[0],
        sourcePath: sources[0].path,
        content: 'info boot complete\nerror failed to reconcile',
      },
    });

    await renderTab();
    await selectSource('kubelet');
    await openSearch();

    const regexButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Enable regular expression support for the text filter"]'
    );
    expect(regexButton).toBeTruthy();

    await act(async () => {
      requireValue(regexButton, 'expected test value in NodeLogsTab.test.tsx').dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      );
      await Promise.resolve();
    });

    await setFilterValue('[');

    // All only highlights matches, so the lines stay readable and the chip says
    // the expression is invalid.
    expect(container.textContent).not.toContain('Enter a valid regular expression.');
    expect(container.textContent).toContain('error failed to reconcile');
    expect(
      container.querySelector('[aria-label="Active log filters"] .active-filter-chip__label')
        ?.textContent
    ).toBe('Regex: [ (invalid expression)');

    await chooseFilterMode('Filtered');
    expect(container.textContent).toContain('Enter a valid regular expression.');
    expect(container.textContent).not.toContain('error failed to reconcile');
  });

  it('can pretty-print JSON logs from the icon bar', async () => {
    mockFetchNodeLogs.mockResolvedValue({
      status: 'executed',
      data: {
        source: sources[0],
        sourcePath: sources[0].path,
        content: '{"level":"info","message":"boot complete"}',
      },
    });

    await renderTab();
    await selectSource('kubelet');

    await showLogFormat('Pretty');

    const logLines = Array.from(container.querySelectorAll('.log-viewer-line')).map(
      (element) => element.textContent
    );
    expect(logLines).toContain('{');
    expect(logLines).toContain('  "message": "boot complete"');
    expect(logLines).toContain('}');
  });

  it('can render parseable JSON logs as a table from the icon bar', async () => {
    mockFetchNodeLogs.mockResolvedValue({
      status: 'executed',
      data: {
        source: sources[0],
        sourcePath: sources[0].path,
        content: '{"level":"info","message":"boot complete"}',
      },
    });

    await renderTab();
    await selectSource('kubelet');

    await showLogFormat('Table');

    expect(container.querySelector('.parsed-logs-table')).toBeTruthy();
    expect(container.textContent).toContain('level');
    expect(container.textContent).toContain('message');
    expect(container.textContent).toContain('boot complete');
  });

  it('exports parsed node columns as data, including metadata-like keys and nested values', async () => {
    mockFetchNodeLogs.mockResolvedValue({
      status: 'executed',
      data: {
        source: sources[0],
        sourcePath: sources[0].path,
        content: JSON.stringify({
          _pod: 'literal',
          level: 'info',
          count: 0,
          enabled: false,
          extra: { value: 'x' },
          message: 'boot, complete',
        }),
      },
    });
    await renderTab();
    await selectSource('kubelet');
    await showLogFormat('Table');
    await act(async () => {
      requireValue(
        container.querySelector('button[aria-label="Download logs"]'),
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
    mockFetchNodeLogs.mockResolvedValue({
      status: 'executed',
      data: {
        source: sources[0],
        sourcePath: sources[0].path,
        content: '{"level":"info","message":"boot complete"}',
      },
    });

    await renderTab();
    await selectSource('kubelet');

    await showLogFormat('Table');

    const row = container.querySelector<HTMLElement>('.parsed-logs-table .gridtable-row');
    expect(row).toBeTruthy();
    expect(row?.classList.contains('parsed-row-expanded')).toBe(false);

    await act(async () => {
      requireValue(row, 'expected test value in NodeLogsTab.test.tsx').dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      );
      await Promise.resolve();
    });

    expect(row?.classList.contains('parsed-row-expanded')).toBe(true);

    await act(async () => {
      requireValue(row, 'expected test value in NodeLogsTab.test.tsx').dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      );
      await Promise.resolve();
    });

    expect(row?.classList.contains('parsed-row-expanded')).toBe(false);
  });

  // Same indicator as Container Logs: a warning icon beside the toolbar whose
  // tooltip says what is shown, instead of a bar above the lines.
  it('shows a truncated response as the buffer-full indicator beside the toolbar', async () => {
    mockFetchNodeLogs.mockResolvedValue({
      status: 'executed',
      data: {
        source: sources[0],
        sourcePath: sources[0].path,
        content: 'recent log line',
        truncated: true,
      },
    });

    await renderTab();
    await selectSource('kubelet');

    expect(container.querySelector('.logs-viewer-warning-bar')).toBeNull();
    const indicator = requireValue(
      container.querySelector<HTMLElement>(
        '.logs-viewer-controls [aria-label="Log buffer is full"]'
      ),
      'buffer-full indicator'
    );
    vi.useFakeTimers();
    try {
      await act(async () => {
        indicator.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      });
      await act(async () => {
        vi.advanceTimersByTime(250);
      });
      expect(document.body.querySelector('.tooltip')?.textContent).toBe(
        'Log buffer is full. Only showing the most recent 1 log.'
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports a node-log failure displayed inline', async () => {
    mockFetchNodeLogs.mockResolvedValue({
      status: 'executed',
      data: {
        source: sources[0],
        sourcePath: sources[0].path,
        error: 'node log access denied',
      },
    });

    await renderTab();
    await selectSource('kubelet');

    expect(container.textContent).toContain('Error: node log access denied');
    // Another source must stay selectable when this one cannot be read.
    expect(container.querySelector('button[aria-label="Node log source"]')).not.toBeNull();
    expect(handleInlineMock).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'node log access denied' }),
      {
        action: 'loadNodeLogs',
        source: 'NodeLogsTab',
        clusterId: 'alpha:ctx',
      }
    );
  });

  it('shows a pending availability message before sources are known', async () => {
    await renderTab({
      availability: { allowed: false, pending: true },
      sources: [],
    });

    expect(container.textContent).toContain('Checking if logs are available for this node...');
  });

  it('shows the unavailable message and omits the error line when no reason is provided', async () => {
    await renderTab({
      availability: { allowed: false, pending: false },
      sources: [],
    });

    expect(container.textContent).toContain('Logs are not available on this node');
    expect(container.textContent).not.toContain('Error:');
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

    expect(container.textContent).toContain('Logs are not available on this node');
    expect(container.textContent).toContain(
      'Error: the server does not allow this method on the requested resource'
    );
  });

  it('defaults raw node logs to the newest visible content', async () => {
    const originalScrollHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'scrollHeight'
    );
    const originalClientHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'clientHeight'
    );

    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get: () => 500,
    });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get: () => 100,
    });

    mockFetchNodeLogs.mockResolvedValue({
      status: 'executed',
      data: {
        source: sources[0],
        sourcePath: sources[0].path,
        content: 'line one\nline two\nline three',
      },
    });

    await renderTab();
    await selectSource('kubelet');

    await waitForAnimationFrames(2);

    const content = container.querySelector<HTMLElement>('.logs-viewer-content');
    expect(content).toBeTruthy();
    expect(requireValue(content, 'expected test value in NodeLogsTab.test.tsx').scrollTop).toBe(
      500
    );

    if (originalScrollHeight) {
      Object.defineProperty(HTMLElement.prototype, 'scrollHeight', originalScrollHeight);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, 'scrollHeight');
    }
    if (originalClientHeight) {
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', originalClientHeight);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
    }
  });

  it('resets to the newest content when switching to a different node log source', async () => {
    const originalScrollHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'scrollHeight'
    );
    const originalClientHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'clientHeight'
    );

    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get: () => 500,
    });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get: () => 100,
    });

    mockFetchNodeLogs.mockImplementation(
      async (_clusterId: string, _nodeName: string, request: { sourcePath: string }) => ({
        status: 'executed',
        data: {
          source: sources.find((source) => source.path === request.sourcePath) ?? sources[0],
          sourcePath: request.sourcePath,
          content: `content for ${request.sourcePath}`,
        },
      })
    );

    await renderTab();
    await selectSource('kubelet');

    const content = container.querySelector<HTMLElement>('.logs-viewer-content');
    expect(content).toBeTruthy();

    await act(async () => {
      requireValue(content, 'expected test value in NodeLogsTab.test.tsx').scrollTop = 40;
      requireValue(content, 'expected test value in NodeLogsTab.test.tsx').dispatchEvent(
        new Event('scroll', { bubbles: true })
      );
      await Promise.resolve();
    });

    const trigger = container.querySelector('button[aria-label="Node log source"]');
    expect(trigger).toBeTruthy();
    await selectSource('containerd');
    await waitForAnimationFrames(6);

    expect(requireValue(content, 'expected test value in NodeLogsTab.test.tsx').scrollTop).toBe(
      500
    );

    if (originalScrollHeight) {
      Object.defineProperty(HTMLElement.prototype, 'scrollHeight', originalScrollHeight);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, 'scrollHeight');
    }
    if (originalClientHeight) {
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', originalClientHeight);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
    }
  });

  it('clears the previous source logs and shows loading while a new source is fetching', async () => {
    let secondSourceResolve: ((value: NodeLogFetchResult) => void) | null = null;
    mockFetchNodeLogs
      .mockResolvedValueOnce({
        status: 'executed',
        data: {
          source: sources[0],
          sourcePath: sources[0].path,
          content: 'content for journal/kubelet',
        },
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            secondSourceResolve = resolve;
          })
      );

    await renderTab();
    await selectSource('kubelet');

    expect(container.querySelector('.logs-viewer-text')?.textContent).toContain(
      'content for journal/kubelet'
    );

    await act(async () => {
      const trigger = container.querySelector('button[aria-label="Node log source"]');
      requireValue(trigger, 'expected test value in NodeLogsTab.test.tsx').dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      );
      await Promise.resolve();
    });

    const secondOption = Array.from(
      document.body.querySelectorAll<HTMLElement>('.dropdown-option')
    ).find((node) => node.textContent?.includes('containerd'));
    expect(secondOption).toBeTruthy();

    await act(async () => {
      requireValue(secondOption, 'expected test value in NodeLogsTab.test.tsx').dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Loading logs...');
    expect(container.textContent).not.toContain('content for journal/kubelet');

    await act(async () => {
      secondSourceResolve?.({
        status: 'executed',
        data: {
          source: sources[1],
          sourcePath: sources[1].path,
          content: 'content for journal/containerd',
        },
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('.logs-viewer-text')?.textContent).toContain(
      'content for journal/containerd'
    );
  });

  it('keeps existing log content mounted during refresh', async () => {
    vi.useFakeTimers();
    let refreshResolve: ((value: NodeLogFetchResult) => void) | null = null;
    mockFetchNodeLogs
      .mockResolvedValueOnce({
        status: 'executed',
        data: {
          source: sources[0],
          sourcePath: sources[0].path,
          content: 'line one\nline two',
        },
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            refreshResolve = resolve;
          })
      );

    try {
      await renderTab();
      await selectSource('kubelet');

      await act(async () => {
        vi.advanceTimersByTime(5000);
        await Promise.resolve();
      });

      expect(container.querySelector('.logs-viewer-text')?.textContent).toContain('line one');
      expect(container.textContent).not.toContain('Loading logs...');

      await act(async () => {
        refreshResolve?.({
          status: 'executed',
          data: {
            source: sources[0],
            sourcePath: sources[0].path,
            content: 'line one\nline two\nline three',
          },
        });
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(container.querySelector('.logs-viewer-text')?.textContent).toContain('line three');
    } finally {
      vi.useRealTimers();
    }
  });

  it('appends incremental refresh results using sinceTime with overlap dedupe', async () => {
    vi.useFakeTimers();
    mockFetchNodeLogs
      .mockResolvedValueOnce({
        status: 'executed',
        data: {
          source: sources[0],
          sourcePath: sources[0].path,
          content: 'line one\nline two',
        },
      })
      .mockResolvedValueOnce({
        status: 'executed',
        data: {
          source: sources[0],
          sourcePath: sources[0].path,
          content: 'line two\nline three',
        },
      });

    try {
      await renderTab();
      await selectSource('kubelet');

      await act(async () => {
        vi.advanceTimersByTime(5000);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(mockFetchNodeLogs).toHaveBeenLastCalledWith(
        'alpha:ctx',
        'node-a',
        expect.objectContaining({
          sourcePath: 'journal/kubelet',
          tailBytes: 262144,
          sinceTime: expect.any(String),
        }),
        'background'
      );
      const logLines = Array.from(container.querySelectorAll('.log-viewer-line')).map(
        (element) => element.textContent
      );
      expect(logLines).toEqual(['line one', 'line two', 'line three']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps current node logs when a background refresh is blocked', async () => {
    vi.useFakeTimers();
    mockFetchNodeLogs.mockResolvedValueOnce({
      status: 'executed',
      data: {
        source: sources[0],
        sourcePath: sources[0].path,
        content: 'line one\nline two',
      },
    });
    mockFetchNodeLogs.mockResolvedValueOnce({
      status: 'blocked',
      blockedReason: 'auto-refresh-disabled',
    });

    try {
      await renderTab();
      await selectSource('kubelet');

      await act(async () => {
        vi.advanceTimersByTime(5000);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(container.querySelector('.logs-viewer-text')?.textContent).toContain('line two');
      expect(container.textContent).not.toContain('Loading logs...');
    } finally {
      vi.useRealTimers();
    }
  });

  it('disables search and wrap until the source returns a log line', async () => {
    mockFetchNodeLogs.mockResolvedValue({
      status: 'executed',
      data: { source: sources[0], sourcePath: sources[0].path, content: '' },
    });
    await renderTab();
    await selectSource('kubelet');

    for (const label of ['Search logs', 'Wrap text']) {
      expect(
        container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)?.disabled,
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
      container.querySelector('[aria-label="Active log filters"] .logs-viewer-count')?.textContent;
    const bufferFullMessage = async (): Promise<string | null | undefined> => {
      const indicator = container.querySelector<HTMLElement>(
        '.logs-viewer-controls [aria-label="Log buffer is full"]'
      );
      if (!indicator) {
        return null;
      }
      vi.useFakeTimers();
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
        vi.useRealTimers();
      }
    };

    it('keeps only as many lines as the buffer setting allows', async () => {
      const bufferSize = OBJ_PANEL_LOGS_BUFFER_DEFAULT_SIZE;
      mockFetchNodeLogs.mockResolvedValue({
        status: 'executed',
        data: {
          source: sources[0],
          sourcePath: sources[0].path,
          content: numberedLines(1, bufferSize + 200),
        },
      });

      await renderTab();
      await selectSource('kubelet');
      await filterLogsBy('line');

      expect(countLabel()).toBe(`${bufferSize}/${bufferSize} logs`);
      expect(await bufferFullMessage()).toBe(
        `Log buffer is full. Only showing the most recent ${bufferSize} logs.`
      );
    });

    it('trims to the newest lines at once when the buffer setting shrinks', async () => {
      mockFetchNodeLogs.mockResolvedValue({
        status: 'executed',
        data: { source: sources[0], sourcePath: sources[0].path, content: numberedLines(1, 150) },
      });

      await renderTab();
      await selectSource('kubelet');
      expect(await bufferFullMessage()).toBeNull();

      await act(async () => {
        eventBus.emit('settings:obj-panel-logs-buffer-size', 100);
      });

      const rows = Array.from(
        container.querySelectorAll('.log-viewer-line'),
        (row) => row.textContent
      );
      expect(rows[0]).toBe('line 51');
      expect(rows[rows.length - 1]).toBe('line 150');
      expect(await bufferFullMessage()).toBe(
        'Log buffer is full. Only showing the most recent 100 logs.'
      );
    });

    it('still says the buffer is full after a refresh appends lines', async () => {
      vi.useFakeTimers();
      mockFetchNodeLogs.mockResolvedValueOnce({
        status: 'executed',
        data: {
          source: sources[0],
          sourcePath: sources[0].path,
          content: 'line 1\nline 2',
          truncated: true,
        },
      });
      mockFetchNodeLogs.mockResolvedValue({
        status: 'executed',
        data: { source: sources[0], sourcePath: sources[0].path, content: 'line 3' },
      });
      try {
        await renderTab();
        await selectSource('kubelet');
        await act(async () => {
          vi.advanceTimersByTime(5000);
          await Promise.resolve();
          await Promise.resolve();
          await Promise.resolve();
        });
      } finally {
        vi.useRealTimers();
      }
      await filterLogsBy('line');

      expect(countLabel()).toBe('3/3 logs');
      expect(await bufferFullMessage()).toBe(
        'Log buffer is full. Only showing the most recent 3 logs.'
      );
    });
  });

  it('keeps the lines and reports a failed background refresh above them', async () => {
    vi.useFakeTimers();
    mockFetchNodeLogs.mockResolvedValueOnce({
      status: 'executed',
      data: { source: sources[0], sourcePath: sources[0].path, content: 'line one\nline two' },
    });
    mockFetchNodeLogs.mockResolvedValue({
      status: 'executed',
      data: { source: sources[0], sourcePath: sources[0].path, error: 'kubelet unreachable' },
    });

    try {
      await renderTab();
      await selectSource('kubelet');
      await act(async () => {
        vi.advanceTimersByTime(5000);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(container.querySelector('.logs-viewer-text')?.textContent).toContain('line two');
      expect(container.querySelector('[aria-label="Log warnings"]')?.textContent).toContain(
        'kubelet unreachable'
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('says so when a source returns no logs', async () => {
    mockFetchNodeLogs.mockResolvedValue({
      status: 'executed',
      data: { source: sources[0], sourcePath: sources[0].path, content: '' },
    });

    await renderTab();
    await selectSource('kubelet');

    expect(container.querySelector('.logs-viewer-text')?.textContent).toBe(
      'No logs returned for this source.'
    );
  });

  describe('keyboard shortcuts', () => {
    const shortcutHelp: {
      current: ReturnType<typeof useKeyboardContext>['getAvailableShortcuts'] | null;
    } = {
      current: null,
    };
    const nativeAction: {
      current: ReturnType<typeof useKeyboardContext>['dispatchNativeAction'] | null;
    } = { current: null };
    const ShortcutHelpProbe = () => {
      const keyboard = useKeyboardContext();
      shortcutHelp.current = keyboard.getAvailableShortcuts;
      nativeAction.current = keyboard.dispatchNativeAction;
      return null;
    };

    const renderWithProbe = async (isActive = true) => {
      await act(async () => {
        root.render(
          <PanelLayoutTestProvider>
            <KeyboardProvider>
              <ShortcutHelpProbe />
              <NodeLogsTab
                panelId="panel-1"
                nodeName="node-a"
                clusterId="alpha:ctx"
                isActive={isActive}
                availability={{ allowed: true, pending: false }}
                sources={sources}
              />
            </KeyboardProvider>
          </PanelLayoutTestProvider>
        );
        await Promise.resolve();
        await Promise.resolve();
      });
    };

    const press = async (key: string, shiftKey = false) => {
      await act(async () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true }));
        await Promise.resolve();
      });
    };

    const pressed = (label: string) =>
      container.querySelector(`button[aria-label="${label}"]`)?.getAttribute('aria-pressed');

    beforeEach(() => {
      reportOperationalErrorMock.mockReset();
      mockFetchNodeLogs.mockResolvedValue({
        status: 'executed',
        data: {
          source: sources[0],
          sourcePath: sources[0].path,
          content: 'info boot complete\nerror failed to reconcile',
        },
      });
    });

    it('toggles search and display options and copies the shown logs', async () => {
      await renderWithProbe();
      await selectSource('kubelet');
      await setFilterValue('error');
      // Opening search puts the cursor in the filter box, where keys type text.
      act(() => (document.activeElement as HTMLElement | null)?.blur());

      await press('i');
      expect(container.querySelector('.logs-viewer-text')?.textContent).toBe('info boot complete');
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
        container.querySelector<HTMLElement>('.logs-viewer-content'),
        'node log output'
      );
      await act(async () => output.focus());
      window.getSelection()?.removeAllRanges();

      expect(nativeAction.current?.('selectAll')).toBe(true);
      const selected = window.getSelection();
      expect(selected?.rangeCount).toBe(1);
      expect(output.contains(selected?.getRangeAt(0).commonAncestorContainer ?? null)).toBe(true);

      expect(nativeAction.current?.('copy')).toBe(true);
      expect(Clipboard.SetText).toHaveBeenCalledWith(expect.stringContaining('info boot complete'));

      const failure = new Error('clipboard denied');
      vi.mocked(Clipboard.SetText).mockRejectedValue(failure);
      await act(async () => {
        nativeAction.current?.('copy');
        await Promise.resolve();
      });
      expect(reportOperationalErrorMock).toHaveBeenCalledWith(
        failure,
        expect.objectContaining({ action: 'copySelectedLogText' })
      );
    });

    it('reports a copy that fails instead of hiding it', async () => {
      const failure = new Error('clipboard denied');
      vi.mocked(Clipboard.SetText).mockRejectedValue(failure);
      await renderWithProbe();
      await selectSource('kubelet');

      await press('c', true);

      expect(reportOperationalErrorMock).toHaveBeenCalledWith(
        failure,
        expect.objectContaining({ action: 'copyLogs' })
      );
    });

    describe('Escape while the search row is open', () => {
      const closeTab = vi.fn(() => true);
      // Stands in for the object panel, which closes its tab on Escape.
      const ObjectPanelEscape = ({ children }: { children: React.ReactNode }) => {
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
        await act(async () => {
          root.render(
            <PanelLayoutTestProvider>
              <KeyboardProvider>
                <ObjectPanelEscape>
                  <NodeLogsTab
                    panelId="panel-1"
                    nodeName="node-a"
                    clusterId="alpha:ctx"
                    isActive
                    availability={{ allowed: true, pending: false }}
                    sources={sources}
                  />
                </ObjectPanelEscape>
              </KeyboardProvider>
            </PanelLayoutTestProvider>
          );
          await Promise.resolve();
          await Promise.resolve();
        });
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
          container.querySelector<HTMLButtonElement>('button[aria-label="Search logs"]'),
          'expected the search button'
        );
      const filterInput = () =>
        container.querySelector<HTMLInputElement>('input[aria-label="Filter node logs"]');

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
          container.querySelector<HTMLElement>('.logs-viewer-content'),
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
