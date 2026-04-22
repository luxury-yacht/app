import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { KeyboardProvider } from '@ui/shortcuts';

import NodeLogsTab from './NodeLogsTab';
import { resetLogViewerPrefsCacheForTesting } from '../Logs/logViewerPrefsCache';

const mockFetchNodeLogs = vi.fn();

vi.mock('./nodeLogsApi', () => ({
  fetchNodeLogs: (...args: unknown[]) => mockFetchNodeLogs(...args),
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
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    if (!Element.prototype.scrollIntoView) {
      Element.prototype.scrollIntoView = vi.fn();
    }
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    mockFetchNodeLogs.mockReset();
    resetLogViewerPrefsCacheForTesting();
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
        <KeyboardProvider>
          <NodeLogsTab
            panelId="panel-1"
            nodeName="node-a"
            clusterId="alpha:ctx"
            isActive
            availability={{ allowed: true, pending: false }}
            sources={sources}
            {...props}
          />
        </KeyboardProvider>
      );
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  const setFilterValue = async (value: string): Promise<void> => {
    const filterInput = container.querySelector<HTMLInputElement>(
      'input[aria-label="Filter node logs"]'
    );
    expect(filterInput).toBeTruthy();

    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setValue?.call(filterInput, value);
      filterInput!.dispatchEvent(new Event('change', { bubbles: true }));
      filterInput!.dispatchEvent(new Event('input', { bubbles: true }));
      await Promise.resolve();
    });
  };

  const selectSource = async (label: string): Promise<void> => {
    const trigger = container.querySelector('.pod-logs-selector-dropdown .dropdown-trigger');
    expect(trigger).toBeTruthy();

    await act(async () => {
      trigger!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    const option = Array.from(container.querySelectorAll<HTMLElement>('.dropdown-option')).find(
      (node) => node.textContent?.includes(label)
    );
    expect(option).toBeTruthy();

    await act(async () => {
      option!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
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
      source: sources[0],
      sourcePath: sources[0].path,
      content: 'line one\nline two',
    });

    await renderTab();

    expect(mockFetchNodeLogs).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Select a log source to view logs.');
    expect(
      container.querySelector('.pod-logs-selector-dropdown .dropdown-value')?.textContent
    ).toBe('Select log source');
  });

  it('refetches when the selected source changes', async () => {
    mockFetchNodeLogs.mockImplementation(
      async (_clusterId: string, _nodeName: string, request: { sourcePath: string }) => ({
        source: sources.find((source) => source.path === request.sourcePath) ?? sources[0],
        sourcePath: request.sourcePath,
        content: `content for ${request.sourcePath}`,
      })
    );

    await renderTab();
    await selectSource('kubelet');
    await selectSource('containerd');

    expect(mockFetchNodeLogs).toHaveBeenLastCalledWith('alpha:ctx', 'node-a', {
      sourcePath: 'journal/containerd',
      tailBytes: 262144,
    });
    expect(container.querySelector('.pod-logs-text')?.textContent).toContain(
      'content for journal/containerd'
    );
  });

  it('renders node log sources as grouped tree-like dropdown options', async () => {
    mockFetchNodeLogs.mockResolvedValue({
      source: sources[0],
      sourcePath: sources[0].path,
      content: 'line one',
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

    const trigger = container.querySelector('.pod-logs-selector-dropdown .dropdown-trigger');
    expect(trigger).toBeTruthy();
    expect(
      container.querySelector('.pod-logs-selector-dropdown .dropdown-value')?.textContent
    ).toBe('Select log source');

    await act(async () => {
      trigger!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    const groupHeader = container.querySelector('.dropdown-group-header');
    expect(groupHeader?.textContent).toBe('aws-routed-eni');

    const optionLabels = Array.from(container.querySelectorAll('.dropdown-option')).map((node) =>
      node.textContent?.replace(/\s+/g, ' ').trim()
    );
    expect(optionLabels).toContain('ipamd.log');
    expect(optionLabels).toContain('plugin.log');
    expect(optionLabels).toContain('private');
  });

  it('filters rendered log lines client-side', async () => {
    mockFetchNodeLogs.mockResolvedValue({
      source: sources[0],
      sourcePath: sources[0].path,
      content: 'info boot complete\nerror failed to reconcile',
    });

    await renderTab();
    await selectSource('kubelet');
    await setFilterValue('error');

    expect(container.querySelector('.pod-logs-text')?.textContent).toBe(
      'error failed to reconcile'
    );
  });

  it('can invert the filter from the icon bar', async () => {
    mockFetchNodeLogs.mockResolvedValue({
      source: sources[0],
      sourcePath: sources[0].path,
      content: 'info boot complete\nerror failed to reconcile',
    });

    await renderTab();
    await selectSource('kubelet');
    await setFilterValue('error');

    const inverseButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Invert the text filter to show only non-matching logs"]'
    );
    expect(inverseButton).toBeTruthy();

    await act(async () => {
      inverseButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(container.querySelector('.pod-logs-text')?.textContent).toBe('info boot complete');
  });

  it('can highlight matches from the icon bar', async () => {
    mockFetchNodeLogs.mockResolvedValue({
      source: sources[0],
      sourcePath: sources[0].path,
      content: 'info boot complete\nerror failed to reconcile',
    });

    await renderTab();
    await selectSource('kubelet');
    await setFilterValue('error');

    const highlightButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Highlight matching text - disabled when Invert is enabled"]'
    );
    expect(highlightButton).toBeTruthy();

    await act(async () => {
      highlightButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    const highlightedMatch = container.querySelector('mark.pod-log-highlight');
    expect(highlightedMatch?.textContent).toBe('error');
  });

  it('highlights ANSI-colored node log text in the DOM renderer', async () => {
    mockFetchNodeLogs.mockResolvedValue({
      source: sources[0],
      sourcePath: sources[0].path,
      content: '\u001b[31merror\u001b[0m failed to reconcile',
    });

    await renderTab();
    await selectSource('kubelet');
    await setFilterValue('error');

    const highlightButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Highlight matching text - disabled when Invert is enabled"]'
    );
    expect(highlightButton).toBeTruthy();

    await act(async () => {
      highlightButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    const highlightedMatch = container.querySelector('.pod-log-line mark.pod-log-highlight');
    expect(highlightedMatch?.textContent).toBe('error');
    expect(highlightedMatch?.closest('span[style*="color"]')).toBeTruthy();
    expect(container.querySelector('.read-only-terminal-surface')).toBeNull();
  });

  it('supports no-wrap for ANSI-colored node logs in the DOM renderer', async () => {
    mockFetchNodeLogs.mockResolvedValue({
      source: sources[0],
      sourcePath: sources[0].path,
      content: '\u001b[31merror\u001b[0m failed to reconcile',
    });

    await renderTab();
    await selectSource('kubelet');

    const wrapButton = container.querySelector<HTMLButtonElement>('button[aria-label="Wrap text"]');
    expect(wrapButton).toBeTruthy();

    await act(async () => {
      wrapButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(container.querySelector('.pod-logs-text.no-wrap')).toBeTruthy();
    expect(container.querySelector('.pod-log-line span[style*="color"]')).toBeTruthy();
    expect(container.querySelector('.read-only-terminal-surface')).toBeNull();
  });

  it('shows an error for invalid regex filters when regex mode is enabled', async () => {
    mockFetchNodeLogs.mockResolvedValue({
      source: sources[0],
      sourcePath: sources[0].path,
      content: 'info boot complete\nerror failed to reconcile',
    });

    await renderTab();
    await selectSource('kubelet');

    const regexButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Enable regular expression support for the text filter"]'
    );
    expect(regexButton).toBeTruthy();

    await act(async () => {
      regexButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    await setFilterValue('[');

    expect(container.textContent).toContain('Enter a valid regular expression.');
  });

  it('can pretty-print JSON logs from the icon bar', async () => {
    mockFetchNodeLogs.mockResolvedValue({
      source: sources[0],
      sourcePath: sources[0].path,
      content: '{"level":"info","message":"boot complete"}',
    });

    await renderTab();
    await selectSource('kubelet');

    const prettyButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Show pretty JSON"]'
    );
    expect(prettyButton).toBeTruthy();

    await act(async () => {
      prettyButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    const logLines = Array.from(container.querySelectorAll('.pod-log-line')).map(
      (element) => element.textContent
    );
    expect(logLines).toContain('{');
    expect(logLines).toContain('  "message": "boot complete"');
    expect(logLines).toContain('}');
  });

  it('can render parseable JSON logs as a table from the icon bar', async () => {
    mockFetchNodeLogs.mockResolvedValue({
      source: sources[0],
      sourcePath: sources[0].path,
      content: '{"level":"info","message":"boot complete"}',
    });

    await renderTab();
    await selectSource('kubelet');

    const parsedButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Parse the JSON into a table"]'
    );
    expect(parsedButton).toBeTruthy();

    await act(async () => {
      parsedButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('.parsed-logs-table')).toBeTruthy();
    expect(container.textContent).toContain('level');
    expect(container.textContent).toContain('message');
    expect(container.textContent).toContain('boot complete');
  });

  it('supports parsed-table row expansion and collapse like pod logs', async () => {
    mockFetchNodeLogs.mockResolvedValue({
      source: sources[0],
      sourcePath: sources[0].path,
      content: '{"level":"info","message":"boot complete"}',
    });

    await renderTab();
    await selectSource('kubelet');

    const parsedButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Parse the JSON into a table"]'
    );
    expect(parsedButton).toBeTruthy();

    await act(async () => {
      parsedButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const row = container.querySelector<HTMLElement>('.parsed-logs-table .gridtable-row');
    expect(row).toBeTruthy();
    expect(row?.classList.contains('parsed-row-expanded')).toBe(false);

    await act(async () => {
      row!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(row?.classList.contains('parsed-row-expanded')).toBe(true);

    await act(async () => {
      row!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(row?.classList.contains('parsed-row-expanded')).toBe(false);
  });

  it('shows a truncation notice when the backend returns a truncated response', async () => {
    mockFetchNodeLogs.mockResolvedValue({
      source: sources[0],
      sourcePath: sources[0].path,
      content: 'recent log line',
      truncated: true,
    });

    await renderTab();
    await selectSource('kubelet');

    expect(container.textContent).toContain('Showing only the most recent 256 KB');
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
      source: sources[0],
      sourcePath: sources[0].path,
      content: 'line one\nline two\nline three',
    });

    await renderTab();
    await selectSource('kubelet');

    await waitForAnimationFrames(2);

    const content = container.querySelector<HTMLElement>('.pod-logs-content');
    expect(content).toBeTruthy();
    expect(content!.scrollTop).toBe(500);

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
        source: sources.find((source) => source.path === request.sourcePath) ?? sources[0],
        sourcePath: request.sourcePath,
        content: `content for ${request.sourcePath}`,
      })
    );

    await renderTab();
    await selectSource('kubelet');

    const content = container.querySelector<HTMLElement>('.pod-logs-content');
    expect(content).toBeTruthy();

    await act(async () => {
      content!.scrollTop = 40;
      content!.dispatchEvent(new Event('scroll', { bubbles: true }));
      await Promise.resolve();
    });

    const trigger = container.querySelector('.pod-logs-selector-dropdown .dropdown-trigger');
    expect(trigger).toBeTruthy();
    await selectSource('containerd');
    await waitForAnimationFrames(6);

    expect(content!.scrollTop).toBe(500);

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
    let secondSourceResolve: ((value: unknown) => void) | null = null;
    mockFetchNodeLogs
      .mockResolvedValueOnce({
        source: sources[0],
        sourcePath: sources[0].path,
        content: 'content for journal/kubelet',
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            secondSourceResolve = resolve;
          })
      );

    await renderTab();
    await selectSource('kubelet');

    expect(container.querySelector('.pod-logs-text')?.textContent).toContain(
      'content for journal/kubelet'
    );

    await act(async () => {
      const trigger = container.querySelector('.pod-logs-selector-dropdown .dropdown-trigger');
      trigger!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    const secondOption = Array.from(
      container.querySelectorAll<HTMLElement>('.dropdown-option')
    ).find((node) => node.textContent?.includes('containerd'));
    expect(secondOption).toBeTruthy();

    await act(async () => {
      secondOption!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Loading logs…');
    expect(container.textContent).not.toContain('content for journal/kubelet');

    await act(async () => {
      secondSourceResolve?.({
        source: sources[1],
        sourcePath: sources[1].path,
        content: 'content for journal/containerd',
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('.pod-logs-text')?.textContent).toContain(
      'content for journal/containerd'
    );
  });

  it('keeps existing log content mounted during refresh', async () => {
    vi.useFakeTimers();
    let refreshResolve: ((value: unknown) => void) | null = null;
    mockFetchNodeLogs
      .mockResolvedValueOnce({
        source: sources[0],
        sourcePath: sources[0].path,
        content: 'line one\nline two',
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

      expect(container.querySelector('.pod-logs-text')?.textContent).toContain('line one');
      expect(container.textContent).not.toContain('Loading logs…');

      await act(async () => {
        refreshResolve?.({
          source: sources[0],
          sourcePath: sources[0].path,
          content: 'line one\nline two\nline three',
        });
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(container.querySelector('.pod-logs-text')?.textContent).toContain('line three');
    } finally {
      vi.useRealTimers();
    }
  });

  it('appends incremental refresh results using sinceTime with overlap dedupe', async () => {
    vi.useFakeTimers();
    mockFetchNodeLogs
      .mockResolvedValueOnce({
        source: sources[0],
        sourcePath: sources[0].path,
        content: 'line one\nline two',
      })
      .mockResolvedValueOnce({
        source: sources[0],
        sourcePath: sources[0].path,
        content: 'line two\nline three',
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
        })
      );
      const logLines = Array.from(container.querySelectorAll('.pod-log-line')).map(
        (element) => element.textContent
      );
      expect(logLines).toEqual(['line one', 'line two', 'line three']);
    } finally {
      vi.useRealTimers();
    }
  });
});
