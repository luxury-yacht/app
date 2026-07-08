/**
 * frontend/src/ui/modals/OpenClusterModal.test.tsx
 *
 * Tests for the OpenClusterModal: the search-path → file → context tree
 * (render, open/switch, invalid handling, collapse) plus Add Directory / remove.
 */
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { types } from '@wailsjs/go/models';
import OpenClusterModal from './OpenClusterModal';

type KubeconfigInfo = types.KubeconfigInfo;

const mockKube = {
  kubeconfigs: [] as KubeconfigInfo[],
  selectedKubeconfigs: [] as string[],
  openKubeconfig: vi.fn().mockResolvedValue(undefined),
  setActiveKubeconfig: vi.fn(),
  loadKubeconfigs: vi.fn().mockResolvedValue(undefined),
};

let mockSearchPaths: string[] = [];
const openDialogMock = vi.fn().mockResolvedValue('');
const setSearchPathsMock = vi.fn().mockResolvedValue(undefined);

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => mockKube,
}));

vi.mock('@/core/app-state-access', () => ({
  requestAppState: (opts: { read: () => Promise<unknown> }) => opts.read(),
  readKubeconfigSearchPaths: () => Promise.resolve(mockSearchPaths),
}));

vi.mock('@wailsjs/go/backend/App', () => ({
  OpenKubeconfigSearchPathDialog: () => openDialogMock(),
  SetKubeconfigSearchPaths: (paths: string[]) => setSearchPathsMock(paths),
}));

const kc = (overrides: Partial<KubeconfigInfo>): KubeconfigInfo =>
  ({
    name: 'config',
    path: '/home/u/.kube/config',
    context: 'ctx',
    isDefault: false,
    isCurrentContext: false,
    invalid: false,
    invalidReason: '',
    sourcePath: '/home/u/.kube',
    ...overrides,
  }) as KubeconfigInfo;

describe('OpenClusterModal', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    mockKube.kubeconfigs = [];
    mockKube.selectedKubeconfigs = [];
    mockKube.openKubeconfig = vi.fn().mockResolvedValue(undefined);
    mockKube.setActiveKubeconfig = vi.fn();
    mockKube.loadKubeconfigs = vi.fn().mockResolvedValue(undefined);
    mockSearchPaths = ['/home/u/.kube'];
    openDialogMock.mockReset().mockResolvedValue('');
    setSearchPathsMock.mockReset().mockResolvedValue(undefined);
    window.localStorage.clear();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const flush = async () => {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  const renderModal = async () => {
    await act(async () => {
      root.render(<OpenClusterModal isOpen onClose={vi.fn()} />);
      await Promise.resolve();
    });
    await flush();
  };

  const contextRow = (context: string) =>
    Array.from(document.querySelectorAll<HTMLElement>('.open-cluster-context')).find((el) =>
      el.textContent?.includes(context)
    );

  it('renders the search-path, file, and context hierarchy', async () => {
    mockSearchPaths = ['/home/u/.kube', '/opt/kube'];
    mockKube.kubeconfigs = [
      kc({ name: 'config', path: '/home/u/.kube/config', context: 'dev', sourcePath: '/home/u/.kube' }),
      kc({ name: 'config', path: '/home/u/.kube/config', context: 'prod', sourcePath: '/home/u/.kube' }),
      kc({ name: 'work', path: '/opt/kube/work', context: 'staging', sourcePath: '/opt/kube' }),
    ];

    await renderModal();

    expect(document.body.textContent).toContain('/home/u/.kube');
    expect(document.body.textContent).toContain('/opt/kube');
    expect(contextRow('dev')).toBeTruthy();
    expect(contextRow('staging')).toBeTruthy();
  });

  it('shows a configured search path even when it has no kubeconfig files', async () => {
    mockSearchPaths = ['/empty/dir'];
    mockKube.kubeconfigs = [];

    await renderModal();

    expect(document.body.textContent).toContain('/empty/dir');
  });

  it('opens an unopened context on click (modal stays open)', async () => {
    mockKube.kubeconfigs = [kc({ path: '/home/u/.kube/config', context: 'dev' })];

    await renderModal();

    act(() => {
      contextRow('dev')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(mockKube.openKubeconfig).toHaveBeenCalledWith('/home/u/.kube/config:dev');
    expect(mockKube.setActiveKubeconfig).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('switches to an already-open context instead of reopening it', async () => {
    mockKube.kubeconfigs = [kc({ path: '/home/u/.kube/config', context: 'dev' })];
    mockKube.selectedKubeconfigs = ['/home/u/.kube/config:dev'];

    await renderModal();

    const row = contextRow('dev')!;
    expect(row.className).toContain('is-open');

    act(() => {
      row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(mockKube.setActiveKubeconfig).toHaveBeenCalledWith('/home/u/.kube/config:dev');
    expect(mockKube.openKubeconfig).not.toHaveBeenCalled();
  });

  it('disables invalid contexts and does not open them', async () => {
    mockKube.kubeconfigs = [
      kc({ path: '/home/u/.kube/config', context: 'broken', invalid: true, invalidReason: 'no cluster' }),
    ];

    await renderModal();

    const row = contextRow('broken')!;
    expect(row.className).toContain('is-invalid');

    act(() => {
      row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(mockKube.openKubeconfig).not.toHaveBeenCalled();
    expect(mockKube.setActiveKubeconfig).not.toHaveBeenCalled();
  });

  it('collapses a directory to hide its contexts, and remembers it', async () => {
    mockKube.kubeconfigs = [kc({ path: '/home/u/.kube/config', context: 'dev' })];

    await renderModal();
    expect(contextRow('dev')).toBeTruthy();

    const dirToggle = Array.from(
      document.querySelectorAll<HTMLElement>('.open-cluster-dir__toggle')
    ).find((el) => el.textContent?.includes('/home/u/.kube'));
    expect(dirToggle).toBeTruthy();

    act(() => {
      dirToggle!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(contextRow('dev')).toBeFalsy();
    expect(window.localStorage.getItem('openCluster.collapsed')).toContain('/home/u/.kube');
  });

  it('adds a picked directory as a new search path', async () => {
    mockSearchPaths = ['/home/u/.kube'];
    openDialogMock.mockResolvedValue('/new/dir');

    await renderModal();

    const addButton = Array.from(document.querySelectorAll<HTMLElement>('button')).find(
      (b) => b.textContent?.trim() === 'Add Directory'
    );
    expect(addButton).toBeTruthy();

    await act(async () => {
      addButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    await flush();

    expect(setSearchPathsMock).toHaveBeenCalledWith(['/home/u/.kube', '/new/dir']);
  });

  it('removes a search path via its remove button', async () => {
    mockSearchPaths = ['/home/u/.kube', '/opt/kube'];
    mockKube.kubeconfigs = [kc({ path: '/home/u/.kube/config', context: 'dev' })];

    await renderModal();

    const removeButton = document.querySelector<HTMLElement>(
      '[aria-label="Remove /opt/kube"]'
    );
    expect(removeButton).toBeTruthy();

    await act(async () => {
      removeButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    await flush();

    expect(setSearchPathsMock).toHaveBeenCalledWith(['/home/u/.kube']);
  });

  it('renders nothing when closed', async () => {
    await act(async () => {
      root.render(<OpenClusterModal isOpen={false} onClose={vi.fn()} />);
      await Promise.resolve();
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
