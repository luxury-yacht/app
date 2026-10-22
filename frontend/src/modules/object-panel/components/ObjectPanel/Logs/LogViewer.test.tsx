/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Logs/LogViewer.test.tsx
 *
 * Verifies object-panel log viewing behavior: live stream state, previous logs,
 * filtering, parsing, container selection, lifecycle cleanup, keyboard
 * shortcuts, and per-panel viewer settings. Runs inside the real app shell
 * (keyboard, preferences, refresh orchestrator, container-logs stream manager,
 * store, data-access broker) over a faked backend (test-utils/appState): live
 * lines arrive as frames on the container-logs stream, and container lists,
 * previous logs, and saved files as RPC answers. The table, dropdown, and
 * tooltip are stubbed only to reach their cells, options, and text.
 */

import { IssueState } from '@bindings/github.com/luxury-yacht/app/backend/internal/containerlogs/models';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable';
import { withStableListKeys } from '@shared/utils/stableListKeys';
import { Clipboard } from '@wailsio/runtime';
import type React from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ContainerLogsStreamEventPayload,
  ContainerLogsTargetIssue,
  ContainerLogsWarning,
  ContainerLogsWireEntry,
} from '@/core/refresh/types';
import {
  OBJ_PANEL_LOGS_BUFFER_DEFAULT_SIZE,
  OBJ_PANEL_LOGS_BUFFER_MIN_SIZE,
  setObjPanelLogsBufferMaxSize,
} from '@/core/settings/appPreferences';
import { objectPanelId } from '@/modules/object-panel/objectPanelRef';
import {
  installAppStateHarness,
  type MountedApp,
  type ObjectIdentity,
  type TestCluster,
  type TestObject,
} from '@/test-utils/appState/harness';
import type { BackendResult } from '@/test-utils/appState/transport';
import { makeErrorStatus } from '@/test-utils/errorStatusFixtures';
import { requireValue } from '@/test-utils/requireValue';
import { useKeyboardContext } from '@/ui/shortcuts/context';
import { isMacPlatform } from '@/utils/platform';
import LogViewer from './LogViewer';
import type { ParsedLogEntry } from './logOptionsReducer';

vi.mock('@shared/components/dropdowns/Dropdown', () => ({
  Dropdown: ({
    value = '',
    onChange,
    options = [],
    multiple = false,
    renderValue,
    ariaLabel,
  }: {
    value?: string | string[];
    onChange?: (v: string | string[]) => void;
    options?: Array<{ label?: string; value: string; disabled?: boolean }>;
    multiple?: boolean;
    ariaLabel?: string;
    renderValue?: (
      value: string | string[],
      options: Array<{ label: string; value: string }>
    ) => React.ReactNode;
  }) => {
    const testId =
      multiple && ariaLabel
        ? `logs-${ariaLabel.toLowerCase()}-dropdown`
        : multiple ||
            options?.some((opt) => opt?.label === 'All') ||
            options?.some(
              (opt) => typeof opt?.label === 'string' && opt.label.startsWith('All ')
            ) ||
            options?.some(
              (opt) =>
                typeof opt?.label === 'string' &&
                opt.label.startsWith('Containers and Init Containers')
            )
          ? 'pod-container-dropdown'
          : options?.some((opt) => opt?.label === 'Auto-scroll')
            ? 'pod-options-dropdown'
            : 'pod-filter-dropdown';
    return (
      <>
        <span data-testid={`${testId}-value`}>
          {renderValue?.(
            value,
            options.map((opt) => ({ value: opt.value, label: opt.label ?? opt.value }))
          )}
        </span>
        <select
          data-testid={testId}
          multiple={multiple}
          value={value}
          onChange={(event) => {
            const target = event.target as HTMLSelectElement;
            onChange?.(
              multiple
                ? Array.from(target.selectedOptions).map((option) => option.value)
                : target.value
            );
          }}
        >
          {withStableListKeys(
            options ?? [],
            (opt) => `${opt?.value ?? ''}:${opt?.label ?? ''}`
          ).map(({ key, value: opt }) => (
            <option key={key} value={opt?.value} disabled={Boolean(opt?.disabled)}>
              {opt?.label ?? opt?.value}
            </option>
          ))}
        </select>
      </>
    );
  },
}));

const tableMockState = vi.hoisted(() => ({ renderRows: false }));

vi.mock('@shared/components/tables/GridTable', () => ({
  __esModule: true,
  default: ({
    children,
    tableClassName,
    data,
    columns,
  }: {
    children?: React.ReactNode;
    tableClassName?: string;
    data: ParsedLogEntry[];
    columns: GridColumnDefinition<ParsedLogEntry>[];
  }) => (
    <div data-testid={tableClassName}>
      {children}
      {tableMockState.renderRows
        ? data.map((row) => (
            <div key={row.timestamp}>
              {columns.map((column) => (
                <span key={column.key}>{column.render(row)}</span>
              ))}
            </div>
          ))
        : null}
    </div>
  ),
  GRIDTABLE_VIRTUALIZATION_DEFAULT: {},
}));

vi.mock('@shared/components/Tooltip', () => ({
  __esModule: true,
  default: ({
    children,
    content,
    triggerLabel,
  }: {
    children?: React.ReactNode;
    content?: React.ReactNode;
    triggerLabel?: string;
  }) => (
    <span
      data-trigger-label={triggerLabel}
      data-tooltip={typeof content === 'string' ? content : undefined}
    >
      {children ?? null}
    </span>
  ),
}));

const app = installAppStateHarness();

/** The last item, or undefined for an empty list. */
const last = <T,>(items: readonly T[]): T | undefined => items[items.length - 1];

const LOG_STREAM = 'refresh-container-logs';

/** The harness's fake of one named JSON stream socket. */
type LogSocket = {
  sent: Array<Record<string, unknown>>;
  deliver: (frame: Record<string, unknown>) => void;
  close: ReturnType<typeof vi.fn>;
  onclose: (() => void) | null;
};

type LogFrame = Omit<
  ContainerLogsStreamEventPayload,
  'domain' | 'scope' | 'sequence' | 'generatedAt'
>;

// A container in the list the backend returns for a log scope.
const scopeContainer = (name: string, kind: 'regular' | 'init' | 'debug' = 'regular') => ({
  name,
  isInit: kind === 'init',
  isEphemeral: kind === 'debug',
});

/** A wire log line from the `app` container unless overridden. */
const logLine = (
  pod: string,
  line: string,
  timestamp: string,
  overrides: Partial<ContainerLogsWireEntry> = {}
): ContainerLogsWireEntry => ({
  pod,
  container: 'app',
  line,
  timestamp,
  isInit: false,
  ...overrides,
});

/** An RFC 3339 timestamp `seconds` after 2024-05-01T10:00:00Z. */
const at = (seconds: number) =>
  new Date(Date.UTC(2024, 4, 1, 10, 0, seconds)).toISOString().replace('.000Z', 'Z');

const DEFAULT_LINES = [
  logLine('web-1', 'first', '2024-05-01T10:00:00Z'),
  logLine('web-2', 'second', '2024-05-01T10:00:01Z'),
];

describe('LogViewer active pod synchronisation', () => {
  let dev: TestCluster;
  let deployment: TestObject;
  let apiPod: TestObject;
  let mounted: MountedApp | null;
  let sockets: LogSocket[];
  let frameSequence = 0;
  const keyboard: { current: ReturnType<typeof useKeyboardContext> | null } = { current: null };
  const writeTextMock = vi.mocked(Clipboard.SetText);

  const KeyboardProbe = () => {
    keyboard.current = useKeyboardContext();
    return null;
  };

  beforeEach(() => {
    mounted = null;
    sockets = [];
    tableMockState.renderRows = false;
    writeTextMock.mockReset().mockResolvedValue(undefined);
    // Keep each container-logs socket the harness opens, to answer it.
    const globals = globalThis as typeof globalThis & {
      __wailsJSONStreamFactory?: (name: string) => unknown;
    };
    const harnessStreams = requireValue(
      globals.__wailsJSONStreamFactory,
      'expected the harness stream factory'
    );
    globals.__wailsJSONStreamFactory = (name: string) => {
      const socket = harnessStreams(name);
      if (name === LOG_STREAM) {
        sockets.push(socket as LogSocket);
      }
      return socket;
    };
    dev = app.cluster({ name: 'dev', context: 'alpha' });
    app.namespaces(dev, ['team-a', 'kube-system']);
    deployment = object({ group: 'apps', version: 'v1', kind: 'Deployment', name: 'api' });
    apiPod = object({ group: '', version: 'v1', kind: 'Pod', name: 'api' });
    answerContainers(scopeContainer('app'));
    // Mirrors backend/preferences_settings.go UpdateAppPreferences.
    app.backend.answer('UpdateAppPreferences', (request) => ({
      settings: null,
      changedKeys: (request.changes ?? []).map((change) => change.key),
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function object(identity: Omit<ObjectIdentity, 'namespace'> & { namespace?: string }) {
    return app.object(dev, { namespace: 'team-a', ...identity });
  }

  const scopeOf = (target: TestObject) =>
    requireValue(target.scopes.containerLogsScope, 'expected a container-logs scope');
  const defaultScope = () => scopeOf(deployment);
  const podScope = () => scopeOf(apiPod);

  function answerContainers(...containers: ReturnType<typeof scopeContainer>[]) {
    app.backend.answer('GetContainerLogsScopeContainers', () => containers);
  }
  const containerReads = () => app.backend.calls('GetContainerLogsScopeContainers');

  // ---------------------------------------------------------------------------
  // The container-logs stream

  /** Every stream request the viewer sent for `scope`, in order. */
  const streamRequests = (scope = defaultScope()) =>
    sockets.flatMap((socket) => socket.sent).filter((frame) => frame.scope === scope);

  const openSocket = (scope: string) =>
    [...sockets]
      .reverse()
      .find(
        (socket) =>
          socket.close.mock.calls.length === 0 && socket.sent.some((frame) => frame.scope === scope)
      );

  /** The backend sends a frame on the scope's open stream. */
  const sendFrame = async (frame: LogFrame, scope = defaultScope()) => {
    const socket = requireValue(openSocket(scope), `expected an open log stream for ${scope}`);
    frameSequence += 1;
    await act(async () => {
      socket.deliver({
        domain: 'container-logs',
        scope,
        sequence: frameSequence,
        generatedAt: Date.now(),
        ...frame,
      });
    });
    await app.settle();
  };

  /** The backend answers the stream request with a complete snapshot. */
  const sendSnapshot = (
    entries: ContainerLogsWireEntry[],
    scope = defaultScope(),
    extra: {
      warnings?: ContainerLogsWarning[];
      issues?: ContainerLogsTargetIssue[];
      trimmed?: number;
    } = {}
  ) => sendFrame({ reset: true, snapshotComplete: true, entries, ...extra }, scope);

  /** The backend streams new lines after the snapshot. */
  const sendLines = (entries: ContainerLogsWireEntry[], scope = defaultScope()) =>
    sendFrame({ entries }, scope);

  /** The backend ends the stream with a failure it will not retry. */
  const failStream = (message: string, reason: 'Forbidden' | 'NotFound', scope = defaultScope()) =>
    sendFrame({ error: message, errorDetails: makeErrorStatus(reason, message) }, scope);

  /**
   * How the failed stream was reported: once, as a toast, or as an expected
   * permission denial that shows only in the tab.
   */
  const streamFailureReports = () =>
    app.errors
      .take((record) => record.context?.source === 'refresh-log-stream')
      .map((record) => record.kinds);

  // ---------------------------------------------------------------------------
  // Mounting

  type ViewerProps = Partial<React.ComponentProps<typeof LogViewer>>;

  const view = () => requireValue(mounted, 'expected the workspace to be mounted');
  const container = () => view().container;

  const viewer = (props: ViewerProps = {}) => (
    <>
      <KeyboardProbe />
      <LogViewer
        resourceKind="deployment"
        containerLogsScope={defaultScope()}
        isActive
        activePodNames={null}
        clusterId={dev.clusterId}
        panelId={objectPanelId(deployment.ref)}
        objectName="api"
        {...props}
      />
    </>
  );

  /** Shows the viewer; a later call re-renders the same viewer with new props. */
  const renderViewer = async (props: ViewerProps = {}) => {
    mounted ??= await app.render(null);
    await view().show(viewer(props));
  };

  /** Unmounts the viewer, as switching tabs or clusters does, and mounts it again. */
  const remountViewer = async (props: ViewerProps = {}) => {
    view().clear();
    await app.settle();
    await renderViewer(props);
  };

  /** Opens the viewer and answers its stream with `entries`. */
  const openLogs = async (
    entries: ContainerLogsWireEntry[] = DEFAULT_LINES,
    props: ViewerProps = {}
  ) => {
    await renderViewer(props);
    await sendSnapshot(entries, props.containerLogsScope ?? defaultScope());
  };

  /** The props of the Logs tab of the `api` pod. */
  const podProps = (props: ViewerProps = {}): ViewerProps => ({
    resourceKind: 'Pod',
    containerLogsScope: podScope(),
    activePodNames: ['api'],
    panelId: objectPanelId(apiPod.ref),
    ...props,
  });

  // ---------------------------------------------------------------------------
  // Interaction

  const click = async (element: Element) => {
    await act(async () => {
      element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await app.settle();
  };

  const control = (label: string) =>
    container().querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  const requireControl = (label: string) => requireValue(control(label), `expected ${label}`);

  const press = async (key: string, modifiers: KeyboardEventInit = {}) => {
    await act(async () => {
      (document.activeElement ?? document).dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers })
      );
    });
    await app.settle();
  };

  /** The shortcut keys the Logs help group lists: those currently enabled. */
  const logShortcutKeys = () =>
    requireValue(keyboard.current, 'expected the keyboard context')
      .getAvailableShortcuts()
      .find(({ category }) => category === 'Logs')
      ?.shortcuts.map(({ key }) => key) ?? [];

  /** Leaves the filter box, where keys type text, for the rest of the app. */
  const blurFocus = () => {
    act(() => (document.activeElement as HTMLElement | null)?.blur());
  };

  // Opens the Download button and chooses where the shown logs go.
  const downloadLogs = async (choice: 'Copy to Clipboard' | 'Save to File') => {
    await click(requireControl('Download logs'));
    const item = Array.from(document.body.querySelectorAll('[role="menuitem"]')).find(
      (element) => element.textContent === choice
    );
    await click(requireValue(item, `expected ${choice}`));
  };

  // Clicks the format button until the logs show the given format.
  const showLogFormat = async (label: 'Raw' | 'Pretty' | 'Table') => {
    for (let step = 0; step < 3; step += 1) {
      const button = requireValue(
        container().querySelector<HTMLButtonElement>('button[aria-label^="Log format:"]'),
        'expected the format button'
      );
      if (button.getAttribute('aria-label') === `Log format: ${label}`) {
        return;
      }
      await click(button);
    }
    throw new Error(`format ${label} was not reached`);
  };

  const filterInput = () =>
    container().querySelector<HTMLInputElement>('input[placeholder="Filter"]');

  // Opens the search row (filter box and search options) unless it is already open.
  const openSearch = async () => {
    const button = requireControl('Search logs');
    if (button.getAttribute('aria-expanded') === 'true') {
      return;
    }
    await click(button);
  };

  const typeFilter = async (value: string) => {
    await openSearch();
    const input = requireValue(filterInput(), 'expected the filter box');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await app.settle();
  };

  // Clicks the filter mode button until it shows the given mode.
  const chooseFilterMode = async (label: 'All' | 'Filtered' | 'Invert') => {
    for (let step = 0; step < 3; step += 1) {
      const button = requireValue(
        container().querySelector<HTMLButtonElement>('button[aria-label^="Filter mode:"]'),
        'expected the filter mode button'
      );
      if (button.getAttribute('aria-label') === `Filter mode: ${label}`) {
        return;
      }
      await click(button);
    }
    throw new Error(`filter mode ${label} was not reached`);
  };

  const setMultiSelectValues = async (select: HTMLSelectElement, values: string[]) => {
    await act(async () => {
      Array.from(select.options).forEach((option) => {
        option.selected = values.includes(option.value);
      });
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await app.settle();
  };

  const dropdown = (name: 'pods' | 'containers') =>
    requireValue(
      container().querySelector<HTMLSelectElement>(`[data-testid="logs-${name}-dropdown"]`),
      `expected the ${name} dropdown`
    );
  const dropdownLabel = (name: 'pods' | 'containers') =>
    container().querySelector(`[data-testid="logs-${name}-dropdown-value"]`)?.textContent;

  const shownLines = () =>
    Array.from(container().querySelectorAll('.log-viewer-line')).map((element) =>
      element.textContent?.replace(/\s+/g, ' ').trim()
    );
  const metadata = () =>
    Array.from(container().querySelectorAll('.log-viewer-line .log-viewer-metadata')).map((span) =>
      span.textContent?.trim()
    );
  const warnings = () =>
    container().querySelector('[aria-label="Log warnings"]')?.textContent ?? '';
  const chipStrip = () => container().querySelector('[aria-label="Active log filters"]');

  /** Lays the log output out with `content`px of content in a 100px viewport. */
  const withLogLayout = async (content: () => number, run: () => Promise<void>) => {
    const originals = (['scrollHeight', 'clientHeight'] as const).map(
      (property) =>
        [property, Object.getOwnPropertyDescriptor(HTMLElement.prototype, property)] as const
    );
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains('logs-viewer-content') ? content() : 100;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains('logs-viewer-content') ? 100 : 0;
      },
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

  const logContent = () =>
    requireValue(
      container().querySelector<HTMLDivElement>('.logs-viewer-content'),
      'expected the log output'
    );

  /** Scrolls the log output up, away from the tail. */
  const scrollUp = async (to: number) => {
    const content = logContent();
    await act(async () => {
      content.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -100 }));
      content.scrollTop = to;
      content.dispatchEvent(new Event('scroll'));
    });
  };

  // ---------------------------------------------------------------------------
  // Active pods

  it('hides lines of pods the workload no longer has', async () => {
    await openLogs(DEFAULT_LINES, { activePodNames: ['web-1', 'web-2'] });
    await renderViewer({ activePodNames: ['web-2'] });

    expect(container().textContent).not.toContain('first');
    expect(container().textContent).toContain('second');
  });

  it('shows every line while the active pod list is unknown', async () => {
    await openLogs(DEFAULT_LINES, { activePodNames: ['web-1', 'web-2'] });
    await renderViewer({ activePodNames: null });

    expect(container().textContent).toContain('first');
    expect(container().textContent).toContain('second');
  });

  it('hides every line once the workload has no pods left', async () => {
    await openLogs(DEFAULT_LINES, { activePodNames: ['web-1', 'web-2'] });
    await renderViewer({ activePodNames: [] });

    expect(container().textContent).not.toContain('first');
    expect(container().textContent).not.toContain('second');
  });

  // Hiding a deleted pod's lines is a view filter, so later batches cannot
  // bring hidden lines back.
  it('keeps a deleted pod hidden when new lines arrive', async () => {
    await openLogs(DEFAULT_LINES, { activePodNames: ['web-1', 'web-2'] });
    await renderViewer({ activePodNames: ['web-2'] });
    await sendLines([logLine('web-2', 'third', '2024-05-01T10:00:02Z')]);

    expect(container().textContent).not.toContain('first');
    expect(container().textContent).toContain('third');
  });

  // A scaled-up workload streams a new pod's lines before its pod list,
  // refreshed every few seconds, names the pod.
  it("shows a new pod's lines until a pod list leaves it out", async () => {
    await openLogs(DEFAULT_LINES, { activePodNames: ['web-1', 'web-2'] });
    await sendLines([logLine('web-3', 'from the new pod', '2024-05-01T10:00:02Z')]);
    expect(container().textContent).toContain('from the new pod');

    await renderViewer({ activePodNames: ['web-1', 'web-2', 'web-3'] });
    expect(container().textContent).toContain('from the new pod');

    await renderViewer({ activePodNames: ['web-1', 'web-2'] });
    expect(container().textContent).not.toContain('from the new pod');
    expect(container().textContent).toContain('first');
  });

  // The pod list refreshes every few seconds; a pod that already streams must
  // be selectable before the list names it.
  it('lists a new pod in the Pods dropdown before its pod list names it', async () => {
    await openLogs(DEFAULT_LINES, { activePodNames: ['web-1', 'web-2'] });
    await sendLines([logLine('web-3', 'from the new pod', '2024-05-01T10:00:02Z')]);

    expect(Array.from(dropdown('pods').options).map((option) => option.text)).toEqual([
      'web-1',
      'web-2',
      'web-3',
    ]);
  });

  // ---------------------------------------------------------------------------
  // Keyboard shortcuts

  it('offers the log tab shortcuts that apply to the shown logs', async () => {
    await openLogs(DEFAULT_LINES, { activePodNames: ['web-1'] });

    // Plain workload lines: no JSON views and no previous logs.
    expect(logShortcutKeys()).toEqual(expect.arrayContaining(['r', 'i', 'x', 't', 'w']));
    for (const key of ['j', 'p', 'v']) {
      expect(logShortcutKeys(), key).not.toContain(key);
    }

    // R toggles the tab's auto-refresh.
    await press('r');
    expect(control('Start auto-refresh')).not.toBeNull();

    // A pod's tab offers its previous logs, even before a line arrives.
    await remountViewer(podProps());
    await sendSnapshot([], podScope());
    expect(logShortcutKeys()).toContain('v');
    expect(logShortcutKeys()).not.toContain('j');
  });

  it('toggles inverse filtering, regex, and previous logs from keyboard shortcuts', async () => {
    app.backend.answer('FetchContainerLogs', () => ({ entries: [] }));
    await openLogs(
      [logLine('api', '{"msg":"panic","nested":{"ok":true}}', '2024-05-01T10:05:00Z')],
      podProps()
    );
    await typeFilter('panic');
    blurFocus();

    await press('x');
    await press('i');
    await press('v');

    expect(control('Filter mode: Invert')).not.toBeNull();
    expect(
      requireControl('Enable regular expression support for the text filter').getAttribute(
        'aria-pressed'
      )
    ).toBe('true');
    expect(requireControl('Show previous logs (V)').getAttribute('aria-pressed')).toBe('true');
  });

  it('toggles pretty JSON from the keyboard shortcut', async () => {
    await openLogs(
      [logLine('api', '{"msg":"panic","nested":{"ok":true}}', '2024-05-01T10:05:00Z')],
      podProps()
    );

    await press('j');

    expect(control('Log format: Pretty')).not.toBeNull();
  });

  it('ignores its shortcuts while the tab is inactive', async () => {
    await openLogs([logLine('api', '{"msg":"hello"}', '2024-05-01T10:05:00Z')], podProps());
    await renderViewer(podProps({ isActive: false }));

    expect(logShortcutKeys()).toEqual([]);
    for (const key of ['r', 't', 'w', 'j', 'p', 'v']) {
      await press(key);
    }

    expect(control('Stop auto-refresh')).not.toBeNull();
    expect(
      requireControl('Show timestamps from the Kubernetes API').getAttribute('aria-pressed')
    ).toBe('true');
    expect(requireControl('Wrap text').getAttribute('aria-pressed')).toBe('true');
    expect(control('Log format: Raw')).not.toBeNull();
    expect(requireControl('Show previous logs (V)').getAttribute('aria-pressed')).toBe('false');
  });

  // ---------------------------------------------------------------------------
  // Stream lifecycle and failures

  // F1 / AC1: a fatal failure with no lines used to leave "Loading logs..." up
  // forever while auto-refresh was on.
  it('shows a failed stream instead of loading forever', async () => {
    const forbidden = 'pods is forbidden: User "viewer" cannot list resource "pods"';
    await renderViewer({ activePodNames: ['web-1'] });
    await failStream(forbidden, 'Forbidden');

    expect(container().textContent).toContain(forbidden);
    expect(container().textContent).not.toContain('Loading logs');
    expect(streamFailureReports()).toEqual([['expected-denial']]);
  });

  // A user who may read a pod and its logs but not list or watch pods: live
  // logs fail, yet previous logs still load and retrying stays one click away.
  it('keeps the log controls when live logs fail before any line arrives', async () => {
    await renderViewer(podProps());
    await failStream(
      'pods is forbidden: User "viewer" cannot list resource "pods"',
      'Forbidden',
      podScope()
    );

    expect(container().textContent).toContain('cannot list resource "pods"');
    expect(control('Show previous logs (V)')).not.toBeNull();
    // The failure turned auto-refresh off; its button offers to start it again.
    expect(control('Start auto-refresh')).not.toBeNull();
    expect(streamFailureReports()).toEqual([['expected-denial']]);
  });

  // AC13: a failure that cannot be retried stops the stream, keeps the lines,
  // explains itself, and turns auto-refresh off so one toggle retries.
  it('turns auto-refresh off after a permanent failure and retries on one toggle', async () => {
    await openLogs([logLine('web-1', 'kept line', '2024-05-01T10:00:00Z')], {
      activePodNames: ['web-1'],
    });
    await failStream('deployments.apps "api" not found', 'NotFound');

    expect(container().textContent).toContain('kept line');
    expect(warnings()).toContain('deployments.apps "api" not found');
    expect(control('Start auto-refresh')).not.toBeNull();
    expect(openSocket(defaultScope())).toBeUndefined();
    expect(streamFailureReports()).toEqual([['toast']]);

    await press('r');

    expect(control('Stop auto-refresh')).not.toBeNull();
    expect(openSocket(defaultScope())).toBeDefined();
    expect(streamRequests()).toHaveLength(2);
  });

  // The tab's auto-refresh toggle freezes the view: the stream stops without
  // clearing the buffer and starts again when the toggle is turned back on.
  it('freezes and resumes the stream with the tab auto-refresh toggle', async () => {
    await openLogs(DEFAULT_LINES, { activePodNames: ['web-1', 'web-2'] });

    await press('r');
    expect(openSocket(defaultScope())).toBeUndefined();
    expect(container().textContent).toContain('first');

    await press('r');
    expect(openSocket(defaultScope())).toBeDefined();
    expect(streamRequests()).toHaveLength(2);
    expect(container().textContent).toContain('first');
  });

  // A cluster switch unmounts and remounts the panel; the buffered lines stay.
  it('keeps the lines across a cluster-switch remount', async () => {
    await openLogs(DEFAULT_LINES, { activePodNames: ['web-1', 'web-2'] });

    view().clear();
    await app.settle();
    expect(openSocket(defaultScope())).toBeUndefined();

    await renderViewer({ activePodNames: ['web-1', 'web-2'] });

    expect(container().textContent).toContain('first');
    expect(container().textContent).toContain('second');
    expect(container().textContent).not.toContain('Loading logs');
  });

  // F10 / AC10: live logs come only from the stream.
  it('does not fetch logs when a live tab opens', async () => {
    await renderViewer({ activePodNames: ['web-1'] });

    expect(streamRequests()).toHaveLength(1);
    expect(app.backend.calls('FetchContainerLogs')).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // Notices and empty states

  // F12 / AC12: lost lines are reported in the warning bar; a full buffer is a
  // warning icon beside the toolbar so it takes no space above the lines.
  it('shows dropped-entry and buffer-full notices', async () => {
    await renderViewer({ activePodNames: ['web-1'] });
    // The backend trimmed 39 older lines of history to fit the buffer.
    await sendSnapshot([logLine('web-1', 'line 1', '2024-05-01T10:00:00Z')], defaultScope(), {
      warnings: [{ kind: 'dropped', count: 3 }],
      trimmed: 39,
    });

    expect(warnings()).toContain('Dropped 3 log entries');
    expect(warnings()).not.toContain('Log buffer is full');
    const bufferFull = container().querySelector(
      '.logs-viewer-controls [data-trigger-label="Log buffer is full"]'
    );
    expect(bufferFull?.getAttribute('data-tooltip')).toBe(
      'Log buffer is full. Only showing the most recent 1 log.'
    );
  });

  it('shows no buffer-full indicator while the buffer has room', async () => {
    await openLogs(DEFAULT_LINES, { activePodNames: ['web-1', 'web-2'] });

    expect(container().querySelector('[data-trigger-label="Log buffer is full"]')).toBeNull();
  });

  it('merges per-tab and global target-limit warnings into one message', async () => {
    await renderViewer({ activePodNames: ['web-1'] });
    await sendSnapshot([logLine('web-1', 'line 1', '2024-05-01T10:00:00Z')], defaultScope(), {
      warnings: [
        { kind: 'targetLimit', scope: 'perTab', hidden: 2, limit: 10 },
        { kind: 'targetLimit', scope: 'global', hidden: 1, limit: 15 },
      ],
    });

    expect(warnings()).toContain(
      'Logs are hidden for 3 containers because the per-tab limit of 10 and global limit of 15 were reached.'
    );
  });

  it('lists containers whose logs cannot be read', async () => {
    await renderViewer({ activePodNames: ['web-1'] });
    await sendSnapshot([logLine('web-1', 'line 1', '2024-05-01T10:00:00Z')], defaultScope(), {
      issues: [
        { pod: 'web-1', container: 'sidecar', state: 'failed', reason: 'connection refused' },
      ],
    });

    expect(warnings()).toContain('web-1/sidecar: connection refused');
  });

  it('says when no container has logs yet', async () => {
    await renderViewer({ activePodNames: ['web-1'] });
    await sendSnapshot([], defaultScope(), {
      issues: [
        { pod: 'web-1', container: 'app', state: 'unavailable', reason: 'waiting to start' },
      ],
    });

    expect(container().textContent).toContain(
      'Logs are not available yet for the selected pod or container'
    );
  });

  it('says there are no logs yet when a healthy stream is empty', async () => {
    await openLogs([], { activePodNames: ['web-1'] });

    expect(container().textContent).toContain('No logs yet');
  });

  it('displays the empty filtered state for workload logs', async () => {
    await openLogs(
      [
        logLine('web-1', 'processed request', '2024-05-01T10:00:00.123456Z'),
        logLine('web-2', '', '', { container: 'worker' }),
      ],
      { activePodNames: ['web-1', 'web-2'] }
    );
    await typeFilter('unmatched');
    await chooseFilterMode('Filtered');

    expect(chipStrip()?.textContent).toContain('Text: unmatched');
    expect(chipStrip()?.querySelector('.logs-viewer-count')?.textContent?.trim()).toBe('0/2 logs');
  });

  // ---------------------------------------------------------------------------
  // Scrolling and virtualization

  it('virtualizes large raw log buffers instead of rendering every row at once', async () => {
    await openLogs(
      Array.from({ length: 200 }, (_, index) =>
        logLine('web-1', `log line ${index + 1}`, at(index))
      ),
      { activePodNames: ['web-1'] }
    );

    const rowElements = Array.from(container().querySelectorAll('.log-viewer-line'));
    expect(rowElements.length).toBeGreaterThan(0);
    expect(rowElements.length).toBeLessThan(200);
    expect(container().textContent).toContain('log line 1');
    expect(container().textContent).not.toContain('log line 200');
  });

  it('returns a remounted Pretty view to the tail after virtualized layout measurement', async () => {
    let layoutMeasured = true;
    await withLogLayout(
      () => (layoutMeasured ? 1_200 : 100),
      async () => {
        await openLogs(
          Array.from({ length: 200 }, (_, index) =>
            logLine('web-1', JSON.stringify({ message: `pretty line ${index + 1}` }), at(index))
          ),
          { activePodNames: ['web-1'] }
        );
        await click(requireControl('Wrap text'));
        await showLogFormat('Pretty');

        let nextFrameId = 1;
        const frames = new Map<number, FrameRequestCallback>();
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
          const id = nextFrameId;
          nextFrameId += 1;
          frames.set(id, callback);
          return id;
        });
        vi.stubGlobal('cancelAnimationFrame', (id: number) => {
          frames.delete(id);
        });
        const flushFrames = () => {
          const pending = [...frames.values()];
          frames.clear();
          for (const callback of pending) {
            callback(0);
          }
        };
        try {
          act(flushFrames);
          act(flushFrames);
          act(flushFrames);

          // Another object-panel tab, then back to Logs.
          await view().show(<section>Another object-panel tab</section>);
          layoutMeasured = false;
          await view().show(viewer({ activePodNames: ['web-1'] }));
          const remountedContent = logContent();
          expect(remountedContent.scrollTop).toBe(0);

          layoutMeasured = true;
          act(flushFrames);

          expect(remountedContent.scrollTop).toBeGreaterThanOrEqual(1_100);
        } finally {
          vi.unstubAllGlobals();
        }
      }
    );
  });

  it('freezes visible log rows while paused and resumes from a bottom overlay', async () => {
    // A small buffer, so the next line evicts the oldest.
    const bufferSize = OBJ_PANEL_LOGS_BUFFER_MIN_SIZE;
    app.preferences({ objPanelLogsBufferMaxSize: bufferSize });
    const anchored = (index: number) => logLine('web-1', `anchored line ${index}`, at(index));
    const firstLine = '[2024-05-01T10:00:01Z] [web-1] anchored line 1';
    await withLogLayout(
      () => 400,
      async () => {
        try {
          await openLogs(
            Array.from({ length: bufferSize }, (_, index) => anchored(index + 1)),
            { activePodNames: ['web-1'] }
          );
          await scrollUp(100);

          await sendLines([anchored(bufferSize + 1)]);

          const content = logContent();
          expect(shownLines()).toContain(firstLine);
          expect(container().textContent).toContain(`anchored line ${bufferSize + 1}`);
          expect(content.scrollTop).toBe(100);
          expect(control('Resume scrolling')).not.toBeNull();

          await act(async () => {
            content.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 100 }));
            content.scrollTop = 300;
            content.dispatchEvent(new Event('scroll'));
          });
          expect(control('Resume scrolling')).toBeNull();
          expect(shownLines()).not.toContain(firstLine);

          await scrollUp(100);
          const resumeButton = requireControl('Resume scrolling');
          // The button is named for what a click does; like the other choice buttons it has no pressed state.
          const autoRefreshButton = requireControl('Stop auto-refresh');
          expect(autoRefreshButton.hasAttribute('aria-pressed')).toBe(false);
          await click(autoRefreshButton);
          expect(autoRefreshButton.getAttribute('aria-label')).toBe('Start auto-refresh');
          await click(resumeButton);

          expect(autoRefreshButton.getAttribute('aria-label')).toBe('Stop auto-refresh');
          expect(shownLines()).not.toContain(firstLine);
          expect(container().textContent).toContain(`anchored line ${bufferSize + 1}`);
          expect(content.scrollTop).toBe(400);
        } finally {
          // The stream manager keeps the buffer size across tests.
          setObjPanelLogsBufferMaxSize(OBJ_PANEL_LOGS_BUFFER_DEFAULT_SIZE);
          await app.settle();
        }
      }
    );
  });

  // Reading paused (scrolled up) during a rollout: the pod list drops a pod,
  // whose lines leave the view, and every other line stays shown once.
  it('hides a deleted pod while paused without repeating other lines', async () => {
    const entry = (sequence: number, pod: string) =>
      logLine(pod, `line ${sequence} from ${pod}`, at(sequence));
    await withLogLayout(
      () => 400,
      async () => {
        await openLogs(
          [entry(1, 'web-2'), entry(2, 'web-1'), entry(3, 'web-2'), entry(4, 'web-1')],
          {
            activePodNames: ['web-1', 'web-2'],
          }
        );
        await scrollUp(100);

        await renderViewer({ activePodNames: ['web-1'] });

        const shown = shownLines().map((line) => line ?? '');
        expect(shown.filter((line) => line.includes('web-2'))).toEqual([]);
        expect(shown.filter((line) => line.includes('line 2 from web-1'))).toHaveLength(1);
        expect(shown.filter((line) => line.includes('line 4 from web-1'))).toHaveLength(1);
      }
    );
  });

  // ---------------------------------------------------------------------------
  // Container lists and metadata

  it('colors API timestamps and container metadata only when showing all containers', async () => {
    answerContainers(scopeContainer('app'), scopeContainer('sidecar'));
    const pod = object({ group: '', version: 'v1', kind: 'Pod', name: 'api-pod-0' });
    await openLogs([logLine('api-pod-0', 'pod scoped log entry', '2024-05-01T10:00:00.123456Z')], {
      resourceKind: 'pod',
      containerLogsScope: scopeOf(pod),
    });

    expect(metadata()[0]).toBe('[2024-05-01T10:00:00.123Z]');
    expect(metadata()).toContain('[app]');

    await setMultiSelectValues(dropdown('containers'), ['container:app']);

    expect(metadata()[0]).toBe('[2024-05-01T10:00:00.123Z]');
    expect(metadata().some((span) => span?.includes('[app]'))).toBe(false);
  });

  // A container that starts after the tab opens (a debug container, or a sidecar
  // from a rollout) is read into the container list when its first line
  // arrives, so its lines name it and the Containers dropdown offers it.
  it('reads the container list again when a line comes from a container it lacks', async () => {
    const pod = object({ group: '', version: 'v1', kind: 'Pod', name: 'api-pod-0' });
    const scope = scopeOf(pod);
    const debugLine = (line: string, timestamp: string) =>
      logLine('api-pod-0', line, timestamp, { container: 'debugger', isEphemeral: true });
    await openLogs([logLine('api-pod-0', 'app line', '2024-05-01T10:00:00Z')], {
      resourceKind: 'pod',
      containerLogsScope: scope,
    });
    const readsOnOpen = containerReads().length;
    expect(last(containerReads())).toEqual([dev.clusterId, scope]);
    // One container, so lines don't name it.
    expect(metadata()).not.toContain('[app]');

    answerContainers(scopeContainer('app'), scopeContainer('debugger', 'debug'));
    await sendLines([debugLine('attached', '2024-05-01T10:00:01Z')], scope);

    expect(containerReads()).toHaveLength(readsOnOpen + 1);
    expect(metadata()).toContain('[app]');
    expect(metadata()).toContain('[debugger (debug)]');
    expect(Array.from(dropdown('containers').options).map((option) => option.value)).toContain(
      'debug:debugger'
    );

    // More lines from listed containers don't read it again.
    await sendLines([debugLine('more', '2024-05-01T10:00:02Z')], scope);
    expect(containerReads()).toHaveLength(readsOnOpen + 1);
  });

  // A container the list still lacks after a reread (its pod ended, or the read
  // failed) is not read for again.
  it('reads the container list at most once for each container it lacks', async () => {
    const pod = object({ group: '', version: 'v1', kind: 'Pod', name: 'api-pod-0' });
    const scope = scopeOf(pod);
    const line = (text: string, timestamp: string, name: string) =>
      logLine('api-pod-0', text, timestamp, { container: name });
    await openLogs([line('one', '2024-05-01T10:00:00Z', 'app')], {
      resourceKind: 'pod',
      containerLogsScope: scope,
    });
    const readsOnOpen = containerReads().length;

    await sendLines([line('two', '2024-05-01T10:00:01Z', 'gone')], scope);
    expect(containerReads()).toHaveLength(readsOnOpen + 1);

    await sendLines([line('three', '2024-05-01T10:00:02Z', 'gone')], scope);
    expect(containerReads()).toHaveLength(readsOnOpen + 1);
  });

  // ---------------------------------------------------------------------------
  // Formats

  // An empty log (reconnecting, or switching to previous logs) says nothing
  // about whether the lines are JSON, so the table view stays on until lines
  // arrive that are not.
  it('keeps the table view while the log is empty', async () => {
    await openLogs([logLine('web-1', '{"level":"info","msg":"starting"}', at(0))], {
      activePodNames: ['web-1'],
    });
    await showLogFormat('Table');

    // The stream reconnects to a pod whose log is empty, then lines arrive.
    await sendSnapshot([]);
    await sendLines([logLine('web-1', '{"level":"info","msg":"ready"}', at(1))]);

    expect(control('Log format: Table')).not.toBeNull();
    expect(container().querySelector('[data-testid="gridtable-parsed-logs"]')).not.toBeNull();
  });

  it('toggles parsed JSON view when structured logs are available', async () => {
    await openLogs(
      [
        logLine(
          'api-1',
          '{"level":"info","message":"hello","timestamp":"2024-05-01T11:00:00.000Z"}',
          '2024-05-01T11:00:00Z'
        ),
      ],
      { activePodNames: ['api-1'] }
    );
    expect(logShortcutKeys()).toContain('p');

    await press('p');
    expect(container().querySelector('[data-testid="gridtable-parsed-logs"]')).toBeTruthy();

    await press('p');
    expect(container().querySelector('[data-testid="gridtable-parsed-logs"]')).toBeFalsy();
  });

  it('cycles raw, pretty JSON, and table output from the format button and its menu', async () => {
    await openLogs([
      logLine(
        'web-1',
        '{"level":"info","message":"hello","nested":{"ok":true}}',
        '2024-05-01T11:00:00Z'
      ),
    ]);

    const formatButton = () =>
      requireValue(
        container().querySelector<HTMLButtonElement>('button[aria-label^="Log format:"]'),
        'expected the format button'
      );
    const parsedTable = () => container().querySelector('[data-testid="gridtable-parsed-logs"]');

    expect(formatButton().getAttribute('aria-label')).toBe('Log format: Raw');

    await click(formatButton());
    expect(formatButton().getAttribute('aria-label')).toBe('Log format: Pretty');
    expect(container().textContent).toContain('"nested": {');

    await click(formatButton());
    expect(formatButton().getAttribute('aria-label')).toBe('Log format: Table');
    expect(parsedTable()).toBeTruthy();

    await click(formatButton());
    expect(formatButton().getAttribute('aria-label')).toBe('Log format: Raw');
    expect(parsedTable()).toBeFalsy();
    expect(container().textContent).not.toContain('"nested": {');

    // The menu offers every format, marks the current one, and jumps straight to a pick.
    await click(requireControl('Choose log format'));
    const choices = Array.from(document.body.querySelectorAll('[role="menuitemradio"]'));
    expect(choices.map((item) => [item.textContent, item.getAttribute('aria-checked')])).toEqual([
      ['Raw', 'true'],
      ['Pretty', 'false'],
      ['Table', 'false'],
    ]);
    await click(requireValue(choices[2], 'expected the Table choice'));
    expect(formatButton().getAttribute('aria-label')).toBe('Log format: Table');
    expect(parsedTable()).toBeTruthy();
  });

  it('hides pretty JSON and parsed JSON buttons when logs are not parseable', async () => {
    await openLogs([logLine('web-1', 'plain text log line', '2024-05-01T11:00:00Z')]);

    expect(container().querySelector('button[aria-label^="Log format:"]')).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Copy and save

  it('copies parsed logs as CSV using the visible parsed columns', async () => {
    await openLogs([
      logLine(
        'web-1',
        '{"level":"info","message":"hello, world","count":2}',
        '2024-05-01T11:00:00Z'
      ),
    ]);
    await showLogFormat('Table');
    await downloadLogs('Copy to Clipboard');

    expect(writeTextMock).toHaveBeenCalledWith(
      [
        'API Timestamp,Pod,Container,level,count,message',
        '2024-05-01T11:00:00Z,web-1,app,info,2,"hello, world"',
      ].join('\n')
    );
  });

  it('saves the same logs Copy takes: a .log file, or a .csv file in Table view', async () => {
    // Mirrors backend/desktop_shell_csv_export.go: the chosen path and its size.
    app.backend.answer('SaveLogFile', () => ({ path: '/tmp/api.log', bytes: 1 }));
    app.backend.answer('SaveCsvFile', () => ({ path: '/tmp/api.csv', bytes: 1 }));
    await openLogs([
      logLine(
        'web-1',
        '{"level":"info","message":"hello, world","count":2}',
        '2024-05-01T11:00:00Z'
      ),
    ]);

    await downloadLogs('Copy to Clipboard');
    await downloadLogs('Save to File');
    expect(app.backend.calls('SaveLogFile')).toEqual([
      [
        expect.stringMatching(/^luxury-yacht-deployment-api-logs-\d{14}\.log$/),
        writeTextMock.mock.calls[0]?.[0],
      ],
    ]);
    expect(control('Download logs')?.classList.contains('feedback-success')).toBe(true);

    await showLogFormat('Table');
    await downloadLogs('Copy to Clipboard');
    await downloadLogs('Save to File');
    expect(app.backend.calls('SaveCsvFile')).toEqual([
      [
        expect.stringMatching(/^luxury-yacht-deployment-api-logs-\d{14}\.csv$/),
        writeTextMock.mock.calls[1]?.[0],
      ],
    ]);
    expect(writeTextMock.mock.calls[1]?.[0]).toContain('level,count,message');
  });

  // Dismissing the save dialog is not a failure, so the button shows no feedback.
  it('shows no feedback when the save dialog is dismissed', async () => {
    app.backend.answer('SaveLogFile', () => ({ path: '', bytes: 0, canceled: true }));
    await openLogs([logLine('web-1', 'ready', '2024-05-01T11:00:00Z')]);

    await downloadLogs('Save to File');
    expect(app.backend.calls('SaveLogFile')).toHaveLength(1);
    const download = control('Download logs');
    expect(download?.classList.contains('feedback-error')).toBe(false);
    expect(download?.classList.contains('feedback-success')).toBe(false);
  });

  it('keeps reserved metadata values in CSV when pod and timestamp columns are hidden', async () => {
    await openLogs(
      [
        logLine(
          'api',
          '{"_pod":"payload-pod","_timestamp":"payload-time"}',
          '2024-05-01T11:00:00Z'
        ),
      ],
      podProps({ resourceKind: 'pod' })
    );

    await click(requireControl('Show timestamps from the Kubernetes API'));
    await showLogFormat('Table');
    await downloadLogs('Copy to Clipboard');

    expect(writeTextMock).toHaveBeenCalledWith('Container,_pod,_timestamp\napp,-,');
  });

  it('copies selected log text through the app native-action path', async () => {
    await openLogs([logLine('web-1', 'selected log text', '2024-05-01T11:00:00Z')], {
      activePodNames: ['web-1'],
    });
    const line = requireValue(container().querySelector('.log-viewer-line'), 'expected a log line');
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    let message: Node | null = walker.nextNode();
    while (message && !message.textContent?.includes('selected log text')) {
      message = walker.nextNode();
    }
    const range = document.createRange();
    range.selectNodeContents(requireValue(message, 'expected the message text'));
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);

    // The application menu's Copy reaches the app as a runtime event.
    await act(async () => {
      app.events.emit('menu:copy');
    });
    await app.settle();

    expect(writeTextMock).toHaveBeenCalledWith('selected log text');
    window.getSelection()?.removeAllRanges();
  });

  // ---------------------------------------------------------------------------
  // Timestamps and metadata

  it('formats the API timestamp using the configured preference in the rendered log rows', async () => {
    app.preferences({ objPanelLogsApiTimestampFormat: 'HH:mm:ss.SSS' });
    await openLogs([logLine('web-1', 'hello', '2024-05-01T11:00:00.123456Z')], {
      activePodNames: ['web-1'],
    });

    expect(container().textContent).toContain('[11:00:00.123] [web-1] hello');
  });

  it('names the container on workload lines only when there is more than one container', async () => {
    app.preferences({ objPanelLogsApiTimestampFormat: 'HH:mm:ss.SSS' });

    // One container: the pod is enough.
    await openLogs(
      [
        logLine('web-1', 'hello', '2024-05-01T11:00:00.000Z'),
        logLine('web-2', 'world', '2024-05-01T11:00:01.000Z'),
      ],
      { activePodNames: ['web-1', 'web-2'] }
    );
    const readsOnOpen = containerReads().length;
    expect(shownLines()).toEqual(['[11:00:00.000] [web-1] hello', '[11:00:01.000] [web-2] world']);

    // A second container: lines name the container again.
    answerContainers(scopeContainer('app'), scopeContainer('sidecar'));
    await remountViewer({ activePodNames: ['web-1', 'web-2'] });
    expect(containerReads().length).toBeGreaterThan(readsOnOpen);
    expect(shownLines()).toEqual([
      '[11:00:00.000] [web-1/app] hello',
      '[11:00:01.000] [web-2/app] world',
    ]);
  });

  it('keeps the workload pod metadata when the log line is empty', async () => {
    app.preferences({ objPanelLogsApiTimestampFormat: 'HH:mm:ss.SSS' });
    await openLogs([logLine('web-1', '', '2024-05-01T11:00:00.123456Z')], {
      activePodNames: ['web-1'],
    });

    expect(shownLines()).toEqual(['[11:00:00.123] [web-1] [container emitted an empty log]']);
  });

  it('copies the configured API timestamp format in raw and parsed views', async () => {
    app.preferences({ objPanelLogsApiTimestampFormat: 'HH:mm:ss.SSS' });
    await openLogs(
      [logLine('web-1', '{"level":"info","message":"hello"}', '2024-05-01T11:00:00.123456Z')],
      {
        activePodNames: ['web-1'],
      }
    );

    await downloadLogs('Copy to Clipboard');
    expect(writeTextMock).toHaveBeenLastCalledWith(
      '[11:00:00.123] [web-1] {"level":"info","message":"hello"}'
    );

    await showLogFormat('Table');
    await downloadLogs('Copy to Clipboard');

    expect(writeTextMock).toHaveBeenLastCalledWith(
      ['API Timestamp,Pod,Container,level,message', '11:00:00.123,web-1,app,info,hello'].join('\n')
    );
  });

  it('formats API timestamps in the local timezone when enabled', async () => {
    const timestamp = '2024-05-01T11:00:00.123456Z';
    const localDate = new Date(timestamp);
    const pad = (value: number, size = 2) => String(value).padStart(size, '0');
    const offsetMinutes = -localDate.getTimezoneOffset();
    const offsetSign = offsetMinutes >= 0 ? '+' : '-';
    const absoluteOffsetMinutes = Math.abs(offsetMinutes);
    const offsetHours = Math.floor(absoluteOffsetMinutes / 60);
    const offsetRemainderMinutes = absoluteOffsetMinutes % 60;
    const expectedTimestamp = [
      `${localDate.getFullYear()}-${pad(localDate.getMonth() + 1)}-${pad(localDate.getDate())}`,
      `T${pad(localDate.getHours())}:${pad(localDate.getMinutes())}:${pad(localDate.getSeconds())}.${pad(localDate.getMilliseconds(), 3)}`,
      `${offsetSign}${pad(offsetHours)}:${pad(offsetRemainderMinutes)}`,
    ].join('');
    app.preferences({
      objPanelLogsApiTimestampUseLocalTimeZone: true,
      objPanelLogsApiTimestampFormat: 'YYYY-MM-DDTHH:mm:ss.SSS[Z]',
    });

    await openLogs([logLine('web-1', 'hello', timestamp)], { activePodNames: ['web-1'] });

    expect(container().textContent).toContain(`[${expectedTimestamp}] [web-1] hello`);
  });

  it('toggles API timestamps from the icon bar', async () => {
    await openLogs([logLine('web-1', 'hello world', '2024-05-01T11:00:00.123Z')]);

    const timestampButton = requireControl('Show timestamps from the Kubernetes API');
    expect(timestampButton.getAttribute('aria-pressed')).toBe('true');
    expect(container().textContent).toContain('2024-05-01T11:00:00.123Z');

    await click(timestampButton);
    expect(timestampButton.getAttribute('aria-pressed')).toBe('false');
    expect(container().textContent).not.toContain('2024-05-01T11:00:00.123Z');
    expect(container().textContent).toContain('hello world');

    await click(timestampButton);
    expect(timestampButton.getAttribute('aria-pressed')).toBe('true');
    expect(container().textContent).toContain('2024-05-01T11:00:00.123Z');
  });

  // ---------------------------------------------------------------------------
  // Search and filters

  it('shows the active-filters strip only while a chip or the log count has something to show', async () => {
    await openLogs([
      logLine('web-1', 'panic in worker', '2024-05-01T11:00:00Z'),
      logLine('web-1', 'steady state', '2024-05-01T11:00:01Z'),
    ]);
    expect(chipStrip()).toBeNull();

    await typeFilter('panic');
    await chooseFilterMode('Filtered');
    expect(chipStrip()?.querySelector('.logs-viewer-count')?.textContent).toBe('1/2 logs');

    await click(requireControl('Clear all filters'));
    expect(chipStrip()).toBeNull();
  });

  // The Table view has a row only for JSON lines, so its count is of table rows,
  // as in Node Logs.
  it('counts table rows, not filtered lines, in the Table view', async () => {
    await openLogs([
      logLine('web-1', '{"level":"error","message":"db down"}', '2024-05-01T11:00:00Z'),
      logLine('web-1', 'error: disk full', '2024-05-01T11:00:01Z'),
      logLine('web-1', '{"level":"info","message":"ok"}', '2024-05-01T11:00:02Z'),
    ]);
    await typeFilter('error');
    await chooseFilterMode('Filtered');
    const count = () => chipStrip()?.querySelector('.logs-viewer-count')?.textContent;
    expect(count()).toBe('2/3 logs');

    await showLogFormat('Table');
    expect(count()).toBe('1/3 logs');
  });

  const searchShortcut = () => press('f', isMacPlatform() ? { metaKey: true } : { ctrlKey: true });

  it('disables search, timestamps and wrap, and their shortcuts, until a log line arrives', async () => {
    const labels = ['Search logs', 'Show timestamps from the Kubernetes API', 'Wrap text'];
    const searchKeys = ['t', 'w', 'i', 'x', 'c'];
    await openLogs([]);
    for (const label of labels) {
      expect(control(label)?.disabled, label).toBe(true);
    }
    for (const key of searchKeys) {
      expect(logShortcutKeys(), key).not.toContain(key);
    }
    // The search shortcut opens nothing while there is nothing to search.
    await searchShortcut();
    expect(filterInput()).toBeNull();

    await sendLines([logLine('web-1', 'ready', '2024-05-01T11:00:00Z')]);
    for (const label of labels) {
      expect(control(label)?.disabled, label).toBe(false);
    }
    expect(logShortcutKeys()).toEqual(expect.arrayContaining(searchKeys));
  });

  it('keeps an open search row closable when the logs empty out', async () => {
    await openLogs();
    await openSearch();

    // The stream reconnects to an empty log.
    await sendSnapshot([]);
    expect(filterInput()).not.toBeNull();
    expect(requireControl('Search logs').disabled).toBe(false);
    expect(logShortcutKeys()).toContain('i');

    await click(requireControl('Search logs'));
    expect(filterInput()).toBeNull();
    expect(requireControl('Search logs').disabled).toBe(true);
    expect(logShortcutKeys()).not.toContain('i');
  });

  it('applies a time zone picked from the timestamp menu app-wide and shows timestamps', async () => {
    await openLogs([logLine('web-1', 'hello world', '2024-05-01T11:00:00.123Z')]);

    const timestampButton = requireControl('Show timestamps from the Kubernetes API');
    const pickZone = async (label: RegExp) => {
      await click(requireControl('Timestamp time zone'));
      const choice = Array.from(document.body.querySelectorAll('[role="menuitemradio"]')).find(
        (item) => label.test(item.textContent ?? '')
      );
      await click(requireValue(choice, `expected the ${label} choice`));
    };
    const savedZones = () =>
      app.backend
        .calls('UpdateAppPreferences')
        .flatMap(([request]) => request.changes ?? [])
        .filter((change) => change.key === 'objPanelLogsApiTimestampUseLocalTimeZone')
        .map((change) => change.value);

    // Picking a zone while timestamps are hidden shows them again.
    await click(timestampButton);
    expect(container().textContent).not.toContain('2024-05-01T11:00:00.123Z');

    await pickZone(/^Local/);
    // The zone is an app preference, saved for every log view.
    expect(savedZones()).toEqual([true]);
    expect(timestampButton.getAttribute('aria-pressed')).toBe('true');
    // The toggle names the zone in use.
    expect(timestampButton.textContent).toBe('LOCAL');
    expect(container().textContent).toMatch(/\d{4}-\d\d-\d\dT\d\d:\d\d:00\.123[+-]\d\d:\d\d/);

    await pickZone(/^UTC$/);
    expect(savedZones()).toEqual([true, false]);
    expect(timestampButton.textContent).toBe('UTC');
    expect(container().textContent).toContain('2024-05-01T11:00:00.123Z');
  });

  it('shows all, matching, or non-matching lines from the filter mode button', async () => {
    await openLogs([
      logLine('web-1', 'panic in worker', '2024-05-01T11:00:00Z'),
      logLine('web-1', 'steady state', '2024-05-01T11:00:01Z'),
    ]);
    await typeFilter('panic');

    const modeButton = () =>
      requireValue(
        container().querySelector<HTMLButtonElement>('button[aria-label^="Filter mode:"]'),
        'expected the filter mode button'
      );
    const highlighted = () =>
      Array.from(container().querySelectorAll('.log-viewer-line mark.log-viewer-highlight')).map(
        (mark) => mark.textContent
      );

    // All, the default: every line, with the match highlighted.
    expect(modeButton().getAttribute('aria-label')).toBe('Filter mode: All');
    expect(container().textContent).toContain('panic in worker');
    expect(container().textContent).toContain('steady state');
    expect(highlighted()).toEqual(['panic']);

    // Filtered: only matching lines, still highlighted.
    await click(modeButton());
    expect(modeButton().getAttribute('aria-label')).toBe('Filter mode: Filtered');
    expect(container().textContent).toContain('panic in worker');
    expect(container().textContent).not.toContain('steady state');
    expect(highlighted()).toEqual(['panic']);

    // Invert: only the lines that do not match, nothing highlighted.
    await click(modeButton());
    expect(modeButton().getAttribute('aria-label')).toBe('Filter mode: Invert');
    expect(container().textContent).not.toContain('panic in worker');
    expect(container().textContent).toContain('steady state');
    expect(highlighted()).toEqual([]);

    // The menu offers every mode, marks the current one, and jumps straight to a pick.
    await click(requireControl('Choose filter mode'));
    const choices = Array.from(document.body.querySelectorAll('[role="menuitemradio"]'));
    expect(choices.map((item) => [item.textContent, item.getAttribute('aria-checked')])).toEqual([
      ['All', 'false'],
      ['Filtered', 'false'],
      ['Invert', 'true'],
    ]);
    await click(requireValue(choices[0], 'expected the All choice'));
    expect(modeButton().getAttribute('aria-label')).toBe('Filter mode: All');
    expect(container().textContent).toContain('panic in worker');
    expect(container().textContent).toContain('steady state');
  });

  it('opens search from the search button and keeps filtering after the row closes', async () => {
    await openLogs([
      logLine('web-1', 'panic in worker', '2024-05-01T11:00:00Z'),
      logLine('web-1', 'steady state', '2024-05-01T11:00:01Z'),
    ]);

    const searchButton = requireControl('Search logs');
    expect(searchButton.getAttribute('aria-expanded')).toBe('false');
    expect(filterInput()).toBeNull();

    await click(searchButton);
    expect(searchButton.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(requireValue(filterInput(), 'expected the filter box'));

    await typeFilter('panic');
    await chooseFilterMode('Filtered');
    expect(container().textContent).toContain('panic in worker');
    expect(container().textContent).not.toContain('steady state');

    // Closing the row only hides it: the logs stay filtered.
    await click(searchButton);
    expect(searchButton.getAttribute('aria-expanded')).toBe('false');
    expect(filterInput()).toBeNull();
    expect(container().textContent).toContain('panic in worker');
    expect(container().textContent).not.toContain('steady state');
  });

  it('opens the search row from the search shortcut and focuses the filter', async () => {
    await openLogs();
    expect(filterInput()).toBeNull();

    await searchShortcut();

    const input = filterInput();
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);
  });

  it('closes the open search row on Escape from anywhere in the viewer', async () => {
    await openLogs();
    await openSearch();
    expect(document.activeElement).toBe(filterInput());

    // From the filter box: focus returns to the button that opens the row.
    await press('Escape');
    expect(requireControl('Search logs').getAttribute('aria-expanded')).toBe('false');
    expect(filterInput()).toBeNull();
    expect(document.activeElement).toBe(control('Search logs'));

    // From the log output: the row closes and focus stays there.
    await openSearch();
    await act(async () => logContent().focus());
    await press('Escape');
    expect(filterInput()).toBeNull();
    expect(document.activeElement).toBe(logContent());
  });

  it('remembers an open search row when the viewer remounts', async () => {
    await openLogs();
    await click(requireControl('Search logs'));

    await remountViewer();

    expect(requireControl('Search logs').getAttribute('aria-expanded')).toBe('true');
    expect(filterInput()).not.toBeNull();
  });

  it('does not duplicate the workload pod/container label when timestamps are hidden', async () => {
    await openLogs([logLine('web-1', 'matched log', '2024-05-01T10:00:00Z')], {
      activePodNames: ['web-1'],
    });

    await click(requireControl('Show timestamps from the Kubernetes API'));

    expect(shownLines()[0]).toBe('[web-1] matched log');
  });

  // ---------------------------------------------------------------------------
  // ANSI colors

  it('only shows the ANSI colors button when the current logs contain ANSI codes', async () => {
    await openLogs();

    expect(control('Show ANSI colors if present')).toBeNull();
  });

  it('renders ANSI-colored segments by default and strips them when disabled', async () => {
    await openLogs(
      [
        logLine(
          'api',
          '\u001b[2m2026-04-07T04:10:44.787377Z\u001b[0m \u001b[32mINFO\u001b[0m GuardDuty agent started',
          '2026-04-07T04:10:44.787377Z'
        ),
      ],
      podProps()
    );

    const ansiButton = requireControl('Show ANSI colors if present');
    expect(ansiButton.getAttribute('aria-pressed')).toBe('true');
    expect(container().textContent).toContain('INFO GuardDuty agent started');
    expect(container().textContent).not.toContain('\u001b[');
    expect(container().querySelector('.log-viewer-line span[style*="color"]')).toBeTruthy();

    await click(ansiButton);

    expect(ansiButton.getAttribute('aria-pressed')).toBe('false');
    expect(container().textContent).toContain('INFO GuardDuty agent started');
    expect(container().querySelector('.log-viewer-line span[style*="color"]')).toBeNull();
  });

  it('keeps workload metadata controls available for ANSI log rows', async () => {
    await openLogs(
      [
        logLine('web-1', '\u001b[32mmatched log\u001b[0m', '2024-05-01T10:00:00Z'),
        logLine('web-2', '\u001b[31mwrong pod\u001b[0m', '2024-05-01T10:00:01Z'),
      ],
      { activePodNames: ['web-1', 'web-2'] }
    );

    const podButton = requireControl('Show only logs from pod web-1');
    expect(logContent().tabIndex).toBe(0);
    expect(podButton.tabIndex).toBe(-1);
    expect(podButton.dataset.focusTrapIgnore).toBe('true');
    expect(container().querySelector('.log-viewer-line span[style*="color"]')).toBeTruthy();

    await click(podButton);

    expect(shownLines()).toEqual(['[2024-05-01T10:00:00Z] [web-1] matched log']);
  });

  it('supports highlighting ANSI-colored log text in the DOM renderer', async () => {
    await openLogs(
      [
        logLine(
          'api',
          '\u001b[32mINFO\u001b[0m GuardDuty agent started',
          '2026-04-07T04:10:44.787377Z'
        ),
      ],
      podProps()
    );
    await typeFilter('INFO');
    await chooseFilterMode('Filtered');
    await click(requireControl('Case-sensitive search - disabled when regex is enabled'));

    const highlight = container().querySelector('.log-viewer-line mark.log-viewer-highlight');
    expect(highlight?.textContent).toBe('INFO');
    expect(highlight?.closest('span[style*="color"]')).toBeTruthy();
    expect(container().querySelector('.read-only-terminal-surface')).toBeNull();
  });

  it('supports no-wrap for ANSI-colored log text in the DOM renderer', async () => {
    await openLogs(
      [logLine('api', '\u001b[31mlong ansi line\u001b[0m', '2024-05-01T10:00:00Z')],
      podProps()
    );

    await click(requireControl('Wrap text'));

    expect(container().querySelector('.logs-viewer-text.no-wrap')).toBeTruthy();
    expect(container().querySelector('.log-viewer-line span[style*="color"]')).toBeTruthy();
    expect(container().querySelector('.read-only-terminal-surface')).toBeNull();
  });

  it('copies ANSI-enabled raw logs without stripping escape sequences when colors are enabled', async () => {
    await openLogs(
      [logLine('api', '\u001b[31merror\u001b[0m happened', '2024-05-01T10:00:00Z')],
      podProps()
    );

    await downloadLogs('Copy to Clipboard');

    expect(writeTextMock).toHaveBeenLastCalledWith(
      '[2024-05-01T10:00:00Z] \u001b[31merror\u001b[0m happened'
    );
  });

  // ---------------------------------------------------------------------------
  // Pod and container selection

  it('auto-selects the only container for single container logs', async () => {
    await openLogs([logLine('api', 'only container line', '2024-05-01T12:30:00Z')], podProps());

    expect(shownLines()).toEqual(['[2024-05-01T12:30:00Z] only container line']);
  });

  it('filters single container logs by selected container', async () => {
    answerContainers(scopeContainer('app'), scopeContainer('sidecar', 'init'));
    await openLogs(
      [
        logLine('api', 'main log line', '2024-05-01T12:00:00Z'),
        logLine('api', 'init complete', '2024-05-01T12:00:01Z', {
          container: 'sidecar',
          isInit: true,
        }),
      ],
      podProps()
    );

    // The tab reads the pod's container list for its own cluster and scope.
    expect(new Set(containerReads().map((call) => JSON.stringify(call)))).toEqual(
      new Set([JSON.stringify([dev.clusterId, podScope()])])
    );
    // Every container streams until the user narrows the selection.
    expect(streamRequests(podScope())).toEqual([
      expect.objectContaining({ selectedFilters: [], matchNone: false }),
    ]);
    expect(shownLines()).toHaveLength(2);

    await setMultiSelectValues(dropdown('containers'), ['init:sidecar']);

    const filteredLines = shownLines();
    expect(filteredLines).toHaveLength(1);
    expect(filteredLines[0]).toContain('[2024-05-01T12:00:01Z]');
    expect(filteredLines[0]).not.toContain('[sidecar:init]');
    expect(filteredLines[0]).toContain('init complete');
    // The narrowed selection restarts the stream for just that container.
    expect(last(streamRequests(podScope()))).toEqual(
      expect.objectContaining({ selectedFilters: ['init:sidecar'], matchNone: false })
    );
    expect(openSocket(podScope())).toBe(last(sockets));
  });

  it('filters workload logs locally from the pod and container dropdowns', async () => {
    answerContainers(
      scopeContainer('app'),
      scopeContainer('init-db', 'init'),
      scopeContainer('sidecar')
    );
    await openLogs(
      [
        logLine('web-1', 'matched log', '2024-05-01T10:00:00Z'),
        logLine('web-2', 'wrong pod', '2024-05-01T10:00:01Z'),
        logLine('web-1', 'wrong container', '2024-05-01T10:00:02Z', { container: 'sidecar' }),
        logLine('web-2', 'init container log', '2024-05-01T10:00:03Z', {
          container: 'init-db',
          isInit: true,
        }),
      ],
      { activePodNames: ['web-1', 'web-2'] }
    );

    const optionLabels = (select: HTMLSelectElement) =>
      Array.from(select.options).map((option) => option.text);
    expect(optionLabels(dropdown('pods'))).toEqual(['web-1', 'web-2']);
    expect(optionLabels(dropdown('containers'))).toEqual([
      'Init Containers',
      'init-db',
      'Containers',
      'app',
      'sidecar',
    ]);
    expect(dropdownLabel('pods')).toBe('Pods');
    expect(dropdownLabel('containers')).toBe('Containers');

    await setMultiSelectValues(dropdown('pods'), ['pod:web-1']);
    await setMultiSelectValues(dropdown('containers'), ['container:app']);
    // Each dropdown changes only its own part of the selection.
    expect(dropdownLabel('pods')).toBe('Pods (1)');
    expect(dropdownLabel('containers')).toBe('Containers (1)');

    const filteredLines = shownLines();
    expect(filteredLines).toHaveLength(1);
    expect(filteredLines[0]).toContain('[web-1] matched log');
    expect(last(streamRequests())).toEqual(
      expect.objectContaining({ selectedFilters: ['pod:web-1', 'container:app'], matchNone: false })
    );

    await setMultiSelectValues(dropdown('pods'), []);

    expect(container().querySelector('.log-viewer-line')?.textContent).toContain(
      'No logs match the current filters'
    );
    // No pods reads nothing, and the container choice is kept for later.
    expect(last(streamRequests())).toEqual(
      expect.objectContaining({ selectedFilters: ['container:app'], matchNone: true })
    );
    expect(dropdownLabel('pods')).toBe('Pods (0)');
    expect(dropdownLabel('containers')).toBe('Containers (1)');
  });

  // Without a pod list, the Pods dropdown offers the pods with lines. Choosing
  // no pods empties the buffer and so the dropdown's options; the choice stays
  // instead of reverting to every pod and reading them all again.
  it('keeps no pods chosen once the buffer has no pods to offer', async () => {
    await openLogs([logLine('web-1', 'first', '2024-05-01T10:00:00Z')], { activePodNames: null });

    await setMultiSelectValues(dropdown('pods'), []);
    // The restarted stream reads no pods, so its snapshot is empty.
    await sendSnapshot([]);

    const requests = streamRequests();
    expect(last(requests)).toEqual(expect.objectContaining({ matchNone: true }));
    expect(requests.filter((request) => request.matchNone === true)).toHaveLength(1);
  });

  it('filters workload logs when pod and container metadata are clicked', async () => {
    // Two containers, so lines name (and link) the container.
    answerContainers(scopeContainer('app'), scopeContainer('sidecar'));
    await openLogs(
      [
        logLine('web-1', 'matched log', '2024-05-01T10:00:00Z'),
        logLine('web-2', 'wrong pod', '2024-05-01T10:00:01Z'),
        logLine('web-1', 'wrong container', '2024-05-01T10:00:02Z', { container: 'sidecar' }),
      ],
      { activePodNames: ['web-1', 'web-2'] }
    );

    await click(requireControl('Show only logs from pod web-1'));

    expect(dropdownLabel('pods')).toBe('Pods (1)');
    expect(last(streamRequests())).toEqual(
      expect.objectContaining({ selectedFilters: ['pod:web-1'] })
    );
    expect(container().textContent).toContain('matched log');
    expect(container().textContent).toContain('wrong container');
    expect(container().textContent).not.toContain('wrong pod');

    const containerButton = requireControl('Show only logs from container app');
    expect(containerButton.tabIndex).toBe(-1);
    expect(containerButton.dataset.focusTrapIgnore).toBe('true');

    await click(containerButton);

    expect(dropdownLabel('containers')).toBe('Containers (1)');
    expect(last(streamRequests())).toEqual(
      expect.objectContaining({ selectedFilters: ['pod:web-1', 'container:app'] })
    );
    expect(container().textContent).toContain('matched log');
    expect(container().textContent).not.toContain('wrong container');
  });

  it('filters single-container logs when container metadata is clicked', async () => {
    answerContainers(scopeContainer('app'), scopeContainer('sidecar'));
    await openLogs(
      [
        logLine('api', 'main log line', '2024-05-01T12:00:00Z'),
        logLine('api', 'sidecar log line', '2024-05-01T12:00:01Z', { container: 'sidecar' }),
      ],
      podProps()
    );

    const containerButton = requireControl('Show only logs from container sidecar');
    expect(containerButton.tabIndex).toBe(-1);
    expect(containerButton.dataset.focusTrapIgnore).toBe('true');

    await click(containerButton);

    expect(last(streamRequests(podScope()))).toEqual(
      expect.objectContaining({ selectedFilters: ['container:sidecar'] })
    );
    expect(container().textContent).toContain('sidecar log line');
    expect(container().textContent).not.toContain('main log line');
  });

  // A message that starts with brackets is message text, never the line's pod,
  // container or timestamp.
  it('keeps workload metadata links on the entry when a message starts with [a/b]', async () => {
    await openLogs([logLine('web-1', '[main/INFO] Server started', '2024-05-01T10:00:00Z')], {
      activePodNames: ['web-1'],
    });
    await click(requireControl('Show timestamps from the Kubernetes API'));

    const podButton = requireControl('Show only logs from pod web-1');
    expect(control('Show only logs from pod main')).toBeNull();
    expect(container().querySelector('.log-viewer-line')?.textContent).toBe(
      '[web-1] [main/INFO] Server started'
    );
    await click(podButton);
    expect(last(streamRequests())).toEqual(
      expect.objectContaining({ selectedFilters: ['pod:web-1'] })
    );
  });

  it('keeps pod container links on the entry when an untimestamped message starts with [x]', async () => {
    answerContainers(scopeContainer('app'), scopeContainer('sidecar'));
    await openLogs(
      [
        logLine('api', '[INFO] started', ''),
        logLine('api', 'sidecar ready', '2024-05-01T12:00:01Z', { container: 'sidecar' }),
      ],
      podProps()
    );

    expect(control('Show only logs from container INFO')).toBeNull();
    await click(requireControl('Show only logs from container app'));

    expect(last(streamRequests(podScope()))).toEqual(
      expect.objectContaining({ selectedFilters: ['container:app'] })
    );
    expect(container().textContent).toContain('[INFO] started');
    expect(container().textContent).not.toContain('sidecar ready');
  });

  it('shows metadata only on the first row of a pretty JSON entry and copies it once', async () => {
    await openLogs([logLine('web-1', '{"msg":"[a/b] ready"}', '2024-05-01T10:00:00Z')], {
      activePodNames: ['web-1'],
    });
    await click(requireControl('Show timestamps from the Kubernetes API'));
    await showLogFormat('Pretty');

    expect(
      Array.from(container().querySelectorAll('.log-viewer-line'), (row) => row.textContent)
    ).toEqual(['[web-1] {', '  "msg": "[a/b] ready"', '}']);
    expect(
      container().querySelectorAll('button[aria-label^="Show only logs from pod"]')
    ).toHaveLength(1);
    await downloadLogs('Copy to Clipboard');
    expect(writeTextMock).toHaveBeenCalledWith('[web-1] {\n  "msg": "[a/b] ready"\n}');
  });

  it('excludes parsed metadata from Tab while retaining its filter actions', async () => {
    tableMockState.renderRows = true;
    await openLogs([
      logLine('web-1', '{"message":"first"}', '2024-05-01T10:00:00Z'),
      logLine('web-2', '{"message":"second"}', '2024-05-01T10:00:01Z'),
    ]);

    await press('p');

    expect(logContent().tabIndex).toBe(-1);
    const pod = requireControl('Show only logs from pod web-1');
    const containerLink = requireControl('Show only logs from container app');
    for (const link of [pod, containerLink]) {
      expect(link.tabIndex).toBe(-1);
      expect(link.dataset.focusTrapIgnore).toBe('true');
    }
    await click(pod);
    expect(last(streamRequests())).toEqual(
      expect.objectContaining({ selectedFilters: ['pod:web-1'] })
    );
    await click(containerLink);
    expect(last(streamRequests())).toEqual(
      expect.objectContaining({ selectedFilters: ['pod:web-1', 'container:app'] })
    );
  });

  it('labels all-containers mode to indicate debug containers are included', async () => {
    answerContainers(scopeContainer('app'), scopeContainer('debug-abc', 'debug'));
    await openLogs(
      [
        logLine('api', 'main log line', '2024-05-01T12:00:00Z'),
        logLine('api', 'debug line', '2024-05-01T12:00:01Z', { container: 'debug-abc' }),
      ],
      podProps()
    );

    const optionLabels = Array.from(dropdown('containers').options).map((option) => option.text);
    expect(optionLabels).not.toContain('Init Containers');
    expect(optionLabels).toContain('debug-abc (debug)');
  });

  it('shows workload containers even when they have not produced log lines yet', async () => {
    answerContainers(
      scopeContainer('aws-node'),
      scopeContainer('aws-eks-nodeagent'),
      scopeContainer('aws-vpc-cni-init', 'init')
    );
    const daemonSet = object({
      group: 'apps',
      version: 'v1',
      kind: 'DaemonSet',
      namespace: 'kube-system',
      name: 'aws-node',
    });
    await openLogs(
      [
        logLine('aws-node-a', 'visible workload log', '2024-05-01T12:00:00Z', {
          container: 'aws-node',
        }),
      ],
      {
        resourceKind: 'daemonset',
        activePodNames: ['aws-node-a', 'aws-node-b'],
        containerLogsScope: scopeOf(daemonSet),
        panelId: objectPanelId(daemonSet.ref),
      }
    );

    const optionLabels = Array.from(dropdown('containers').options).map((option) => option.text);
    expect(optionLabels).toContain('Init Containers');
    expect(optionLabels).toContain('aws-vpc-cni-init');
    expect(optionLabels).toContain('Containers');
    expect(optionLabels).toContain('aws-node');
    expect(optionLabels).toContain('aws-eks-nodeagent');
  });

  // ---------------------------------------------------------------------------
  // Text matching

  it('highlights matching substrings in visible log text without changing backend params', async () => {
    await openLogs(
      [logLine('web-1', 'timeout while waiting for panic handler', '2024-05-01T12:00:00Z')],
      {
        activePodNames: ['web-1'],
      }
    );
    await typeFilter('panic');
    await chooseFilterMode('Filtered');

    // Text matching is local; the stream keeps its request.
    expect(streamRequests()).toHaveLength(1);
    const highlights = Array.from(container().querySelectorAll('.log-viewer-highlight')).map(
      (element) => element.textContent?.trim()
    );
    expect(highlights).toEqual(['panic']);
    expect(container().textContent).toContain('timeout while waiting for panic handler');
  });

  it('supports case-sensitive matching from the iconbar', async () => {
    await openLogs([
      logLine('web-1', 'Error connecting to cache', '2024-05-01T11:00:00Z'),
      logLine('web-1', 'error connecting to db', '2024-05-01T11:00:01Z'),
    ]);
    await openSearch();
    await chooseFilterMode('Filtered');
    const caseSensitiveButton = requireControl(
      'Case-sensitive search - disabled when regex is enabled'
    );

    await typeFilter('Error');
    expect(container().textContent).toContain('Error connecting to cache');
    expect(container().textContent).toContain('error connecting to db');

    await click(caseSensitiveButton);
    expect(caseSensitiveButton.getAttribute('aria-pressed')).toBe('true');
    expect(container().textContent).toContain('Error connecting to cache');
    expect(container().textContent).not.toContain('error connecting to db');

    const regexButton = requireControl('Enable regular expression support for the text filter');
    await click(regexButton);

    expect(regexButton.getAttribute('aria-pressed')).toBe('true');
    expect(caseSensitiveButton.getAttribute('aria-pressed')).toBe('false');
    expect(caseSensitiveButton.hasAttribute('disabled')).toBe(true);
  });

  it('highlights regex matches, and none once the filter is inverted', async () => {
    await openLogs([
      logLine('web-1', 'panic in worker', '2024-05-01T11:00:00Z'),
      logLine('web-1', 'timeout waiting on cache', '2024-05-01T11:00:01Z'),
      logLine('web-1', 'steady state', '2024-05-01T11:00:02Z'),
    ]);
    await openSearch();
    await chooseFilterMode('Filtered');
    await typeFilter('panic|timeout');

    await click(requireControl('Enable regular expression support for the text filter'));

    const highlights = Array.from(container().querySelectorAll('.log-viewer-highlight')).map(
      (element) => element.textContent?.trim()
    );
    expect(highlights).toEqual(['panic', 'timeout']);
    expect(container().textContent).not.toContain('steady state');

    await chooseFilterMode('Invert');

    expect(container().querySelectorAll('.log-viewer-highlight')).toHaveLength(0);
    expect(container().textContent).toContain('steady state');
    expect(container().textContent).not.toContain('panic in worker');
    expect(container().textContent).not.toContain('timeout waiting on cache');
  });

  // ---------------------------------------------------------------------------
  // Previous logs

  /** Mirrors backend/pod_logs.go FetchContainerLogs for previous containers. */
  const answerPreviousLogs = (
    entries: ContainerLogsWireEntry[],
    issues: NonNullable<BackendResult<'FetchContainerLogs'>['issues']> = []
  ) => {
    app.backend.answer('FetchContainerLogs', () => ({ entries, issues }));
  };

  it('shows previous logs without touching the live buffer', async () => {
    answerPreviousLogs([logLine('api', 'before the restart', '2024-05-01T09:00:00Z')]);
    await openLogs([logLine('api', 'live line', '2024-05-01T10:00:00Z')], podProps());

    await press('v');

    expect(container().textContent).toContain('before the restart');
    expect(container().textContent).not.toContain('live line');
    expect(app.backend.calls('FetchContainerLogs')).toEqual([
      [dev.clusterId, expect.objectContaining({ scope: podScope(), previous: true })],
    ]);

    // Back on live logs, the buffer shows as it was before any new frame.
    await press('v');
    expect(container().textContent).toContain('live line');
    expect(container().textContent).not.toContain('before the restart');
  });

  it('says when a container has no previous logs', async () => {
    answerPreviousLogs(
      [],
      [
        {
          pod: 'api',
          container: 'app',
          state: IssueState.IssueUnavailable,
          reason: 'previous terminated container "app" in pod "api" not found',
        },
      ]
    );
    await openLogs([], podProps());

    await press('v');

    expect(container().textContent).toContain(
      'No previous logs are available for the selected pod or container yet'
    );
  });

  // ---------------------------------------------------------------------------
  // Loading and failures

  it('renders loading state when resource metadata is missing', async () => {
    // What getObjectPanelScopes produces upstream while the panel is in its
    // empty state: a null containerLogsScope.
    await renderViewer({ resourceKind: '', activePodNames: null, containerLogsScope: null });

    expect(container().textContent).toContain('Loading logs');
    expect(sockets).toEqual([]);
  });

  it('shows the paused message instead of a loading spinner before logs have loaded', async () => {
    app.preferences({ autoRefreshEnabled: false });

    await renderViewer({ activePodNames: ['web-1'] });

    expect(container().textContent).toContain('Auto-refresh is disabled');
    expect(container().textContent).not.toContain('Loading logs');
  });

  it('renders a real backend error instead of an empty-log state', async () => {
    await renderViewer({ activePodNames: ['web-1'] });
    await failStream('forbidden', 'Forbidden');

    expect(container().textContent).toContain('Error: forbidden');
    expect(container().textContent).not.toContain('No logs yet');
    expect(streamFailureReports()).toEqual([['expected-denial']]);
  });

  // ---------------------------------------------------------------------------
  // Per-panel viewer settings

  // The Logs tab unmounts whenever another panel tab or cluster is shown; each
  // panel keeps its own settings and source selection.
  it("restores a panel's viewer settings when its logs tab remounts, separately for each panel", async () => {
    await openLogs(DEFAULT_LINES, { activePodNames: ['web-1', 'web-2'] });
    await typeFilter('panic');
    await chooseFilterMode('Filtered');
    await click(requireControl('Case-sensitive search - disabled when regex is enabled'));
    await click(requireControl('Wrap text'));
    await setMultiSelectValues(dropdown('pods'), ['pod:web-1']);

    await remountViewer({ activePodNames: ['web-1', 'web-2'] });

    expect(filterInput()?.value).toBe('panic');
    expect(control('Filter mode: Filtered')).not.toBeNull();
    expect(
      requireControl('Case-sensitive search - disabled when regex is enabled').getAttribute(
        'aria-pressed'
      )
    ).toBe('true');
    expect(requireControl('Wrap text').getAttribute('aria-pressed')).toBe('false');
    expect(dropdownLabel('pods')).toBe('Pods (1)');
    // The restored selection is what the remounted tab streams.
    expect(last(streamRequests())).toEqual(
      expect.objectContaining({ selectedFilters: ['pod:web-1'] })
    );

    // Another panel starts from the defaults.
    await remountViewer({
      activePodNames: ['web-1', 'web-2'],
      panelId: `${objectPanelId(deployment.ref)}-other`,
    });
    expect(filterInput()).toBeNull();
    expect(control('Filter mode: All')).toBeNull();
    expect(requireControl('Wrap text').getAttribute('aria-pressed')).toBe('true');
    expect(dropdownLabel('pods')).toBe('Pods');
  });

  it('assigns distinct workload pod colors while retaining all 24 palette slots', async () => {
    const firstPod = 'argocd-repo-server-7898d489bb-q26sj';
    const secondPod = 'argocd-repo-server-7898d489bb-nsqrr';
    app.preferences({
      objPanelLogsApiTimestampFormat: 'YYYY/MM/DD HH:mm:ss',
      objPanelLogsApiTimestampUseLocalTimeZone: false,
    });
    for (let index = 1; index <= 24; index += 1) {
      document.documentElement.style.setProperty(
        `--hash-color-${index}`,
        `rgb(${index}, ${index}, ${index})`
      );
    }
    document.documentElement.style.setProperty('--hash-color-fallback', 'rgb(99, 99, 99)');

    try {
      await openLogs(
        [
          logLine(firstPod, 'first', '2024-05-01T10:00:00Z'),
          logLine(secondPod, 'second', '2024-05-01T10:00:01Z'),
        ],
        { activePodNames: [firstPod, secondPod] }
      );

      const podColors = [firstPod, secondPod].map((pod) =>
        requireControl(`Show only logs from pod ${pod}`).style.getPropertyValue('--pod-color')
      );
      expect(podColors[0]).toBeTruthy();
      expect(podColors[1]).toBeTruthy();
      expect(podColors[0]).not.toBe(podColors[1]);
      expect(podColors).toContain('rgb(24, 24, 24)');
    } finally {
      for (let index = 1; index <= 24; index += 1) {
        document.documentElement.style.removeProperty(`--hash-color-${index}`);
      }
      document.documentElement.style.removeProperty('--hash-color-fallback');
    }
  });

  // ---------------------------------------------------------------------------
  // Filter chips

  it('clears the text filter from the filter box and shows every line again', async () => {
    await openLogs(
      [
        logLine('web-1', 'error one', '2024-05-01T10:00:00Z'),
        logLine('web-1', 'info two', '2024-05-01T10:00:01Z'),
      ],
      { activePodNames: ['web-1'] }
    );
    await typeFilter('error');
    await chooseFilterMode('Filtered');
    expect(container().textContent).not.toContain('info two');

    await click(requireControl('Clear filter'));

    expect(filterInput()?.value).toBe('');
    expect(container().textContent).toContain('error one');
    expect(container().textContent).toContain('info two');
    expect(control('Clear filter')).toBeNull();
  });

  it('shows active filter chips for the current filter state', async () => {
    answerContainers(scopeContainer('app'), scopeContainer('sidecar'));
    await openLogs();
    await setMultiSelectValues(dropdown('pods'), ['pod:web-1']);
    await setMultiSelectValues(dropdown('containers'), ['container:app']);
    await typeFilter('panic');
    await chooseFilterMode('Filtered');
    await click(requireControl('Enable regular expression support for the text filter'));

    const chips = chipStrip()?.textContent;
    expect(chips).toContain('Regex: panic');
    expect(chips).toContain('web-1');
    expect(chips).toContain('app');
    expect(chips).toContain('Filtered');
  });

  it('shows invalid regex validation in the regex chip', async () => {
    await openLogs();
    await openSearch();
    await click(requireControl('Enable regular expression support for the text filter'));
    await typeFilter('[');

    expect(chipStrip()?.textContent).toContain('Regex: [ (invalid expression)');
  });

  it('shows a previous-logs chip and returns to live logs when it is cleared', async () => {
    answerPreviousLogs([logLine('api', 'before the restart', '2024-05-01T09:00:00Z')]);
    await openLogs([logLine('api', 'live line', '2024-05-01T10:00:00Z')], podProps());
    await click(requireControl('Show previous logs (V)'));

    expect(chipStrip()?.textContent).toContain('Showing previous logs');

    await click(requireControl('Return to live logs'));

    expect(chipStrip()?.textContent ?? '').not.toContain('Showing previous logs');
    expect(requireControl('Show previous logs (V)').getAttribute('aria-pressed')).toBe('false');
    expect(container().textContent).toContain('live line');
  });

  it('clears filters and toggles when active filter chips are removed', async () => {
    answerPreviousLogs([logLine('api', 'panic before the restart', '2024-05-01T09:00:00Z')]);
    await openLogs([logLine('api', 'live line', '2024-05-01T10:00:00Z')], podProps());
    await typeFilter('panic');
    await chooseFilterMode('Filtered');
    await click(requireControl('Show previous logs (V)'));

    await click(requireControl('Clear text filter'));
    expect(filterInput()?.value).toBe('');

    await click(requireControl('Show all lines'));
    expect(control('Filter mode: All')).not.toBeNull();

    await click(requireControl('Clear all filters'));
    expect(requireControl('Show previous logs (V)').getAttribute('aria-pressed')).toBe('false');
    expect(chipStrip()?.textContent ?? '').not.toContain('Showing previous logs');
  });

  // ---------------------------------------------------------------------------
  // Reconnects: once the view has lines, a reconnect (or a cluster-switch
  // remount) must not bring the initial-load spinner back.

  it('keeps lines and says so while the stream reconnects', async () => {
    await openLogs(
      [
        logLine('web-1', 'cached entry 1', '2024-05-01T10:00:00Z'),
        logLine('web-1', 'cached entry 2', '2024-05-01T10:00:01Z'),
      ],
      { activePodNames: ['web-1'] }
    );

    // The connection to the backend drops.
    const socket = requireValue(openSocket(defaultScope()), 'expected the open stream');
    await act(async () => {
      socket.onclose?.();
    });
    await app.settle();

    expect(container().textContent).toContain('cached entry 1');
    expect(container().textContent).toContain('cached entry 2');
    expect(container().textContent).not.toContain('Loading logs');
    expect(warnings()).toContain('Reconnecting to live logs');
  });

  it('keeps unchanged Pretty rows mounted across a stream reconnect', async () => {
    const entries = Array.from({ length: 200 }, (_, index) =>
      logLine('web-1', JSON.stringify({ message: `unchanged entry ${index + 1}` }), at(index))
    );
    await openLogs(entries, { activePodNames: ['web-1'] });
    await click(requireControl('Wrap text'));
    await showLogFormat('Pretty');
    const rowsBeforeReconnect = Array.from(container().querySelectorAll('.log-viewer-row'));
    expect(rowsBeforeReconnect.length).toBeGreaterThan(0);
    expect(rowsBeforeReconnect.length).toBeLessThan(entries.length);

    await renderViewer({ activePodNames: ['web-1'], isActive: false });
    await renderViewer({ activePodNames: ['web-1'], isActive: true });
    // The reconnected stream's snapshot holds the same lines.
    await sendSnapshot(entries);

    const rowsAfterReconnect = Array.from(container().querySelectorAll('.log-viewer-row'));
    expect(rowsAfterReconnect).toHaveLength(rowsBeforeReconnect.length);
    rowsAfterReconnect.forEach((row, index) => {
      expect(row).toBe(rowsBeforeReconnect[index]);
    });
    expect(control('Resume scrolling')).toBeNull();
  });
});
