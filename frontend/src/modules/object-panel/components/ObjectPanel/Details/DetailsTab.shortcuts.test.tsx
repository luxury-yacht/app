import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import DetailsTab, { type DetailsTabProps } from './DetailsTab';

const shortcuts = vi.hoisted(() => ({
  useShortcut: vi.fn(),
}));

vi.mock('@ui/shortcuts', () => ({
  useShortcut: (...args: unknown[]) => shortcuts.useShortcut(...args),
  useSearchShortcutTarget: () => undefined,
}));

const baseProps = (): DetailsTabProps => ({
  objectData: {},
  isActive: true,
  podDetails: null,
  deploymentDetails: null,
  daemonSetDetails: null,
  statefulSetDetails: null,
  jobDetails: null,
  cronJobDetails: null,
  configMapDetails: null,
  secretDetails: null,
  helmReleaseDetails: null,
  serviceDetails: null,
  ingressDetails: null,
  networkPolicyDetails: null,
  endpointSliceDetails: null,
  pvcDetails: null,
  pvDetails: null,
  storageClassDetails: null,
  serviceAccountDetails: null,
  roleDetails: null,
  roleBindingDetails: null,
  clusterRoleDetails: null,
  clusterRoleBindingDetails: null,
  hpaDetails: null,
  pdbDetails: null,
  resourceQuotaDetails: null,
  limitRangeDetails: null,
  nodeDetails: null,
  namespaceDetails: null,
  ingressClassDetails: null,
  crdDetails: null,
  mutatingWebhookDetails: null,
  validatingWebhookDetails: null,
  detailsLoading: false,
  detailsError: null,
  resourceDeleted: false,
  deletedResourceName: undefined,
  canRestart: true,
  canScale: true,
  canDelete: true,
  restartDisabledReason: undefined,
  scaleDisabledReason: undefined,
  deleteDisabledReason: undefined,
  actionLoading: false,
  actionError: null,
  scaleReplicas: 1,
  showScaleInput: false,
  onRestartClick: vi.fn(),
  onDeleteClick: vi.fn(),
  onScaleClick: vi.fn(),
  onScaleCancel: vi.fn(),
  onScaleReplicasChange: vi.fn(),
  onShowScaleInput: vi.fn(),
});

const renderDetailsTab = async (props?: Partial<DetailsTabProps>) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);

  await act(async () => {
    root.render(<DetailsTab {...baseProps()} {...props} />);
    await Promise.resolve();
  });

  return {
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
};

const findShortcut = (key: string) => {
  for (let i = shortcuts.useShortcut.mock.calls.length - 1; i >= 0; i -= 1) {
    const config = shortcuts.useShortcut.mock.calls[i][0] as {
      key: string;
      handler: () => boolean;
    };
    if (config.key === key) {
      return config;
    }
  }
  throw new Error(`Shortcut "${key}" not registered`);
};

describe('DetailsTab shortcuts', () => {
  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    shortcuts.useShortcut.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers section toggle shortcuts', async () => {
    const { cleanup } = await renderDetailsTab();
    const keys = shortcuts.useShortcut.mock.calls.map(
      ([config]) => (config as { key: string }).key
    );
    expect(keys).toEqual(expect.arrayContaining(['o', 'r', 'c', 'd', 'p']));
    cleanup();
  });

  it('only toggles sections when the tab is active', async () => {
    let cleanupResult = await renderDetailsTab({ isActive: true });
    const activeKeys: Array<'o' | 'r' | 'c' | 'd' | 'p'> = ['o', 'r', 'c', 'd', 'p'];
    for (const key of activeKeys) {
      const shortcut = findShortcut(key) as { handler: () => boolean };
      let result = false;
      act(() => {
        result = shortcut.handler();
      });
      expect(result).toBe(true);
    }
    cleanupResult.cleanup();

    shortcuts.useShortcut.mockClear();
    cleanupResult = await renderDetailsTab({ isActive: false });
    const inactiveShortcut = findShortcut('o') as { handler: () => boolean };
    let result = true;
    act(() => {
      result = inactiveShortcut.handler();
    });
    expect(result).toBe(false);
    cleanupResult.cleanup();
  });
});
