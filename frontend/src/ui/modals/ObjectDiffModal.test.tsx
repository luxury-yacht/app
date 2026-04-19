/**
 * frontend/src/components/modals/ObjectDiffModal.test.tsx
 *
 * Test suite for ObjectDiffModal.
 * Covers basic modal behavior and shortcut handling.
 */

import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import ObjectDiffModal from './ObjectDiffModal';
import { KeyboardProvider } from '@ui/shortcuts';

const refreshMocks = vi.hoisted(() => ({
  useRefreshScopedDomain: vi.fn(),
  refreshOrchestrator: {
    setScopedDomainEnabled: vi.fn(),
    resetScopedDomain: vi.fn(),
    fetchScopedDomain: vi.fn(),
  },
}));

const kubeconfigMocks = vi.hoisted(() => ({
  selectedClusterId: 'cluster-a',
  selectedKubeconfigs: ['cluster-a', 'cluster-b'],
  getClusterMeta: (selection: string) => ({
    id: selection,
    name: selection === 'cluster-b' ? 'Cluster B' : 'Cluster A',
  }),
}));

const runtimeMocks = vi.hoisted(() => ({
  eventsOn: vi.fn(),
  eventsOff: vi.fn(),
}));

const appMocks = vi.hoisted(() => ({
  FindCatalogObjectMatch: vi.fn(),
}));

vi.mock('@wailsjs/runtime/runtime', () => ({
  EventsOn: runtimeMocks.eventsOn,
  EventsOff: runtimeMocks.eventsOff,
}));

vi.mock('@wailsjs/go/backend/App', () => ({
  FindCatalogObjectMatch: (...args: unknown[]) => appMocks.FindCatalogObjectMatch(...args),
}));

vi.mock('@core/refresh', () => ({
  useRefreshScopedDomain: (...args: unknown[]) => refreshMocks.useRefreshScopedDomain(...args),
  refreshOrchestrator: refreshMocks.refreshOrchestrator,
}));

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => kubeconfigMocks,
}));

vi.mock('@shared/components/diff/diffBudgets', () => ({
  OBJECT_DIFF_BUDGETS: {
    maxLinesPerSide: 10_000,
    maxComputeWork: 3_000_000,
    maxRenderableRows: 2,
  },
}));

vi.mock('@/hooks/useShortNames', () => ({
  useShortNames: () => false,
}));

vi.mock('@shared/components/dropdowns/Dropdown/Dropdown', () => ({
  default: ({
    id,
    options,
    value,
    onChange,
    searchable,
    searchValue,
    searchPlaceholder,
    onSearchChange,
    disabled,
    ariaLabel,
  }: {
    id?: string;
    options: Array<{ value: string; label: string; group?: string }>;
    value: string | string[];
    onChange: (value: string) => void;
    searchable?: boolean;
    searchValue?: string;
    searchPlaceholder?: string;
    onSearchChange?: (value: string) => void;
    disabled?: boolean;
    ariaLabel?: string;
  }) => (
    <div>
      <select
        id={id}
        aria-label={ariaLabel}
        disabled={disabled}
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Select</option>
        {options
          .filter((option) => option.group !== 'header')
          .map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
      </select>
      {searchable && (
        <input
          aria-label={`${ariaLabel} search`}
          placeholder={searchPlaceholder}
          value={searchValue ?? ''}
          onChange={(event) => onSearchChange?.(event.target.value)}
        />
      )}
    </div>
  ),
}));

const makeState = (overrides: Partial<Record<string, unknown>> = {}) => ({
  status: 'ready',
  data: null,
  stats: null,
  error: null,
  droppedAutoRefreshes: 0,
  scope: undefined,
  checksum: null,
  ...overrides,
});

const catalogItems = [
  {
    uid: 'alpha-uid',
    name: 'alpha',
    namespace: 'apps',
    kind: 'Deployment',
    group: 'apps',
    version: 'v1',
    clusterId: 'cluster-a',
    clusterName: 'Cluster A',
  },
  {
    uid: 'delta-uid',
    name: 'delta',
    namespace: 'apps',
    kind: 'Deployment',
    group: 'apps',
    version: 'v1',
    clusterId: 'cluster-a',
    clusterName: 'Cluster A',
  },
];

const clusterBCatalogItems = [
  {
    uid: 'gamma-uid',
    name: 'gamma',
    namespace: 'apps',
    kind: 'Deployment',
    group: 'apps',
    version: 'v1',
    clusterId: 'cluster-b',
    clusterName: 'Cluster B',
  },
];

const getRefreshState = (domain: string, scope: string) => {
  const isClusterB = scope.startsWith('cluster-b|');

  if (scope === '__inactive__') {
    return makeState({ status: 'idle' });
  }

  if (domain === 'catalog-diff') {
    if (isClusterB && scope.includes('namespace=apps') && scope.includes('kind=Deployment')) {
      return makeState({
        data: {
          items: clusterBCatalogItems,
          namespaces: ['apps'],
          kinds: [{ kind: 'Deployment' }],
        },
      });
    }
    if (isClusterB && scope.includes('namespace=apps')) {
      return makeState({
        data: {
          items: [],
          namespaces: ['apps'],
          kinds: [{ kind: 'Deployment' }],
        },
      });
    }
    if (isClusterB) {
      return makeState({
        data: {
          items: [],
          namespaces: ['apps'],
          kinds: [],
        },
      });
    }

    if (scope.includes('search=beta')) {
      return makeState({
        data: {
          items: [
            {
              uid: 'beta-uid',
              name: 'beta',
              namespace: 'apps',
              kind: 'Deployment',
              group: 'apps',
              version: 'v1',
              clusterId: 'cluster-a',
              clusterName: 'Cluster A',
            },
          ],
          namespaces: ['apps'],
          kinds: [{ kind: 'Deployment' }],
        },
      });
    }
    if (scope.includes('namespace=apps') && scope.includes('kind=Deployment')) {
      return makeState({
        data: {
          items: catalogItems,
          namespaces: ['apps'],
          kinds: [{ kind: 'Deployment' }],
        },
      });
    }
    if (scope.includes('namespace=apps')) {
      return makeState({
        data: {
          items: [],
          namespaces: ['apps'],
          kinds: [{ kind: 'Deployment' }],
        },
      });
    }
    return makeState({
      data: {
        items: [],
        namespaces: ['apps'],
        kinds: [],
      },
    });
  }

  if (domain === 'object-yaml') {
    if (scope.endsWith(':alpha')) {
      return makeState({
        data: {
          yaml: ['apiVersion: apps/v1', 'kind: Deployment', 'metadata:', '  name: alpha'].join(
            '\n'
          ),
        },
      });
    }
    if (scope.endsWith(':beta')) {
      return makeState({
        data: {
          yaml: ['apiVersion: apps/v1', 'kind: Deployment', 'metadata:', '  name: beta'].join('\n'),
        },
      });
    }
    if (scope.endsWith(':delta')) {
      return makeState({
        data: {
          yaml: ['apiVersion: apps/v1', 'kind: Deployment', 'metadata:', '  name: delta'].join(
            '\n'
          ),
        },
      });
    }
  }

  return makeState();
};

describe('ObjectDiffModal', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(async () => {
    runtimeMocks.eventsOn.mockReset();
    runtimeMocks.eventsOff.mockReset();
    appMocks.FindCatalogObjectMatch.mockReset();
    appMocks.FindCatalogObjectMatch.mockResolvedValue(null);
    refreshMocks.useRefreshScopedDomain.mockImplementation((domain: string, scope: string) =>
      getRefreshState(domain, scope)
    );

    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);

    await act(async () => {
      root.render(
        <KeyboardProvider>
          <ObjectDiffModal isOpen onClose={vi.fn()} />
        </KeyboardProvider>
      );
      await Promise.resolve();
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('closes via overlay click but ignores clicks inside modal', () => {
    const onClose = vi.fn();
    act(() => {
      root.render(
        <KeyboardProvider>
          <ObjectDiffModal isOpen onClose={onClose} />
        </KeyboardProvider>
      );
    });

    const overlay = document.querySelector('.object-diff-modal-overlay') as HTMLDivElement | null;
    expect(overlay).toBeTruthy();
    const modal = document.querySelector('.object-diff-modal') as HTMLDivElement | null;
    expect(modal).toBeTruthy();

    act(() => {
      modal?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();

    act(() => {
      overlay?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on Escape through the shared modal surface', () => {
    const onClose = vi.fn();
    act(() => {
      root.render(
        <KeyboardProvider>
          <ObjectDiffModal isOpen onClose={onClose} />
        </KeyboardProvider>
      );
    });

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(onClose).toHaveBeenCalled();
  });

  it('shows the general too-large warning for full view and clears it after switching to diffs only', async () => {
    const onClose = vi.fn();
    act(() => {
      root.render(
        <KeyboardProvider>
          <ObjectDiffModal isOpen onClose={onClose} />
        </KeyboardProvider>
      );
    });

    const changeSelect = async (label: string, nextValue: string) => {
      const select = document.querySelector(
        `select[aria-label="${label}"]`
      ) as HTMLSelectElement | null;
      expect(select).toBeTruthy();
      await act(async () => {
        select!.value = nextValue;
        select!.dispatchEvent(new Event('change', { bubbles: true }));
        await Promise.resolve();
      });
    };

    await changeSelect('Left cluster', 'cluster-a');
    await changeSelect('Right cluster', 'cluster-a');
    await changeSelect('Left namespace', 'apps');
    await changeSelect('Right namespace', 'apps');
    await changeSelect('Left kind', 'Deployment');
    await changeSelect('Right kind', 'Deployment');
    await changeSelect('Left object', 'alpha-uid');
    await changeSelect('Right object', 'delta-uid');

    expect(document.body.textContent).toContain(
      'The diff is too large to display in the current view (5 lines exceed the limit of 2).'
    );

    const toggle = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent === 'Show Diffs'
    ) as HTMLButtonElement | undefined;
    expect(toggle).toBeTruthy();

    await act(async () => {
      toggle!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(document.body.textContent).not.toContain(
      'The diff is too large to display in the current view (5 lines exceed the limit of 2).'
    );
    expect(document.body.textContent).toContain('Show All');
  });

  it('includes the object search query in the catalog scope for searchable object dropdowns', async () => {
    act(() => {
      root.render(
        <KeyboardProvider>
          <ObjectDiffModal isOpen onClose={vi.fn()} />
        </KeyboardProvider>
      );
    });

    const changeSelect = async (label: string, nextValue: string) => {
      const select = document.querySelector(
        `select[aria-label="${label}"]`
      ) as HTMLSelectElement | null;
      expect(select).toBeTruthy();
      await act(async () => {
        select!.value = nextValue;
        select!.dispatchEvent(new Event('change', { bubbles: true }));
        await Promise.resolve();
      });
    };

    await changeSelect('Left cluster', 'cluster-a');
    await changeSelect('Left namespace', 'apps');
    await changeSelect('Left kind', 'Deployment');

    const searchInput = document.querySelector(
      'input[aria-label="Left object search"]'
    ) as HTMLInputElement | null;
    expect(searchInput).toBeTruthy();

    await setTextInputValue(searchInput, 'beta');

    const hasSearchScopedCall = refreshMocks.useRefreshScopedDomain.mock.calls.some(
      (call) =>
        call[0] === 'catalog-diff' && typeof call[1] === 'string' && call[1].includes('search=beta')
    );
    expect(hasSearchScopedCall).toBe(true);
  });

  it('keeps a searched object selected after the search query is cleared', async () => {
    act(() => {
      root.render(
        <KeyboardProvider>
          <ObjectDiffModal isOpen onClose={vi.fn()} />
        </KeyboardProvider>
      );
    });

    const changeSelect = async (label: string, nextValue: string) => {
      const select = document.querySelector(
        `select[aria-label="${label}"]`
      ) as HTMLSelectElement | null;
      expect(select).toBeTruthy();
      await act(async () => {
        select!.value = nextValue;
        select!.dispatchEvent(new Event('change', { bubbles: true }));
        await Promise.resolve();
      });
    };

    await changeSelect('Left cluster', 'cluster-a');
    await changeSelect('Left namespace', 'apps');
    await changeSelect('Left kind', 'Deployment');

    const searchInput = document.querySelector(
      'input[aria-label="Left object search"]'
    ) as HTMLInputElement | null;
    await setTextInputValue(searchInput, 'beta');
    await changeSelect('Left object', 'beta-uid');
    await setTextInputValue(searchInput, '');

    const leftObjectSelect = document.querySelector(
      'select[aria-label="Left object"]'
    ) as HTMLSelectElement | null;
    expect(leftObjectSelect?.value).toBe('beta-uid');
  });

  it('matches against the other cluster even when the matched object is outside the current dropdown page', async () => {
    appMocks.FindCatalogObjectMatch.mockResolvedValue({
      uid: 'alpha-cluster-b-uid',
      name: 'alpha',
      namespace: 'apps',
      kind: 'Deployment',
      group: 'apps',
      version: 'v1',
      clusterId: 'cluster-b',
      clusterName: 'Cluster B',
    });

    act(() => {
      root.render(
        <KeyboardProvider>
          <ObjectDiffModal isOpen onClose={vi.fn()} />
        </KeyboardProvider>
      );
    });

    const changeSelect = async (label: string, nextValue: string) => {
      const select = document.querySelector(
        `select[aria-label="${label}"]`
      ) as HTMLSelectElement | null;
      expect(select).toBeTruthy();
      await act(async () => {
        select!.value = nextValue;
        select!.dispatchEvent(new Event('change', { bubbles: true }));
        await Promise.resolve();
      });
    };

    await changeSelect('Left cluster', 'cluster-a');
    await changeSelect('Right cluster', 'cluster-b');
    await changeSelect('Left namespace', 'apps');
    await changeSelect('Right namespace', 'apps');
    await changeSelect('Left kind', 'Deployment');
    await changeSelect('Right kind', 'Deployment');
    await changeSelect('Left object', 'alpha-uid');

    const matchButton = Array.from(document.querySelectorAll('button')).find(
      (button) =>
        button.textContent === 'Match' &&
        button.closest('.object-diff-selector')?.textContent?.includes('Left')
    ) as HTMLButtonElement | undefined;
    expect(matchButton).toBeTruthy();

    await act(async () => {
      matchButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(appMocks.FindCatalogObjectMatch).toHaveBeenCalledWith(
      'cluster-b',
      'apps',
      'apps',
      'v1',
      'Deployment',
      'alpha'
    );

    const rightObjectSelect = document.querySelector(
      'select[aria-label="Right object"]'
    ) as HTMLSelectElement | null;
    expect(rightObjectSelect?.value).toBe('alpha-cluster-b-uid');

    const rightNamespaceSelect = document.querySelector(
      'select[aria-label="Right namespace"]'
    ) as HTMLSelectElement | null;
    expect(rightNamespaceSelect?.value).toBe('apps');

    const rightKindSelect = document.querySelector(
      'select[aria-label="Right kind"]'
    ) as HTMLSelectElement | null;
    expect(rightKindSelect?.value).toBe('Deployment');
  });

  it('pre-populates the left side from an initial diff request', async () => {
    appMocks.FindCatalogObjectMatch.mockResolvedValue({
      uid: 'alpha-uid',
      name: 'alpha',
      namespace: 'apps',
      kind: 'Deployment',
      group: 'apps',
      version: 'v1',
      clusterId: 'cluster-a',
      clusterName: 'Cluster A',
    });

    await act(async () => {
      root.render(
        <KeyboardProvider>
          <ObjectDiffModal
            isOpen
            initialRequest={{
              requestId: 7,
              left: {
                clusterId: 'cluster-a',
                namespace: 'apps',
                group: 'apps',
                version: 'v1',
                kind: 'Deployment',
                name: 'alpha',
              },
            }}
            onClose={vi.fn()}
          />
        </KeyboardProvider>
      );
      await Promise.resolve();
    });

    expect(appMocks.FindCatalogObjectMatch).toHaveBeenCalledWith(
      'cluster-a',
      'apps',
      'apps',
      'v1',
      'Deployment',
      'alpha'
    );

    const leftClusterSelect = document.querySelector(
      'select[aria-label="Left cluster"]'
    ) as HTMLSelectElement | null;
    const leftNamespaceSelect = document.querySelector(
      'select[aria-label="Left namespace"]'
    ) as HTMLSelectElement | null;
    const leftKindSelect = document.querySelector(
      'select[aria-label="Left kind"]'
    ) as HTMLSelectElement | null;
    const leftObjectSelect = document.querySelector(
      'select[aria-label="Left object"]'
    ) as HTMLSelectElement | null;

    expect(leftClusterSelect?.value).toBe('cluster-a');
    expect(leftNamespaceSelect?.value).toBe('apps');
    expect(leftKindSelect?.value).toBe('Deployment');
    expect(leftObjectSelect?.value).toBe('alpha-uid');
  });

  it('uses catalog-backed identity from the initial request without re-matching', async () => {
    await act(async () => {
      root.render(
        <KeyboardProvider>
          <ObjectDiffModal
            isOpen
            initialRequest={{
              requestId: 8,
              left: {
                clusterId: 'cluster-a',
                clusterName: 'Cluster A',
                namespace: 'apps',
                group: 'apps',
                version: 'v1',
                kind: 'Deployment',
                name: 'alpha',
                resource: 'deployments',
                uid: 'alpha-uid',
              },
            }}
            onClose={vi.fn()}
          />
        </KeyboardProvider>
      );
      await Promise.resolve();
    });

    expect(appMocks.FindCatalogObjectMatch).not.toHaveBeenCalled();

    const leftClusterSelect = document.querySelector(
      'select[aria-label="Left cluster"]'
    ) as HTMLSelectElement | null;
    const leftNamespaceSelect = document.querySelector(
      'select[aria-label="Left namespace"]'
    ) as HTMLSelectElement | null;
    const leftKindSelect = document.querySelector(
      'select[aria-label="Left kind"]'
    ) as HTMLSelectElement | null;
    const leftObjectSelect = document.querySelector(
      'select[aria-label="Left object"]'
    ) as HTMLSelectElement | null;

    expect(leftClusterSelect?.value).toBe('cluster-a');
    expect(leftNamespaceSelect?.value).toBe('apps');
    expect(leftKindSelect?.value).toBe('Deployment');
    expect(leftObjectSelect?.value).toBe('alpha-uid');
  });
});

const setTextInputValue = async (input: HTMLInputElement | null, nextValue: string) => {
  expect(input).toBeTruthy();
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  descriptor?.set?.call(input, nextValue);
  await act(async () => {
    input!.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
  });
};
