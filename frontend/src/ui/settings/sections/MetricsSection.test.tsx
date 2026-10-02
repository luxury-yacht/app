import type { backend } from '@core/backend-api/models';
import { ZoomProvider } from '@core/contexts/ZoomContext';
import { KeyboardProvider } from '@ui/shortcuts';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireValue } from '@/test-utils/requireValue';
import MetricsSection from './MetricsSection';

const sourceMocks = vi.hoisted(() => ({
  loadMetricSourceSettings: vi.fn(),
  saveMetricSource: vi.fn(),
  deleteMetricSource: vi.fn(),
  setClusterMetricAssignment: vi.fn(),
  loadMetricServiceCandidates: vi.fn(),
  loadServicePorts: vi.fn(),
  testMetricSource: vi.fn(),
}));

vi.mock('@/core/settings/metricSources', () => sourceMocks);

const kubeconfigState = vi.hoisted(() => ({
  kubeconfigs: [] as Array<{ name: string; context: string; path: string }>,
  managedClusterIds: [] as string[],
}));

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => kubeconfigState,
}));

const devSource: backend.MetricSource = {
  id: 'src-dev',
  name: 'dev prometheus',
  mode: 'in-cluster' as backend.MetricSourceMode,
  inCluster: {
    clusterId: 'dev:dev-cluster',
    namespace: 'monitoring',
    service: 'prometheus-operated',
    port: 'web',
    scheme: 'http',
    pathPrefix: '',
  },
};

const settings = (
  sources: backend.MetricSource[] = [],
  assignments: Record<string, backend.MetricClusterAssignment> = {}
): backend.MetricSourceSettings => ({ sources, assignments });

const setInputValue = (input: HTMLInputElement, value: string): void => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

const click = async (element: Element | null, label: string) => {
  await act(async () => {
    requireValue(element, `missing ${label}`).dispatchEvent(
      new MouseEvent('click', { bubbles: true })
    );
    await Promise.resolve();
  });
  await flush();
};

const optionNamed = (text: string) =>
  Array.from(document.body.querySelectorAll<HTMLElement>('.dropdown-option')).find(
    (node) => node.textContent?.trim() === text
  ) ?? null;

const choose = async (dropdownLabel: string, optionText: string) => {
  await click(
    document.querySelector(`[aria-label="${dropdownLabel}"]`),
    `dropdown ${dropdownLabel}`
  );
  await click(optionNamed(optionText), `option ${optionText}`);
};

const buttonNamed = (text: string) =>
  Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find(
    (node) => node.textContent?.trim() === text
  ) ?? null;

describe('MetricsSection', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  // jsdom has no scrollIntoView; the shared Dropdown scrolls the selected option into view.
  const nativeScrollIntoView = Element.prototype.scrollIntoView;

  const render = async () => {
    await act(async () => {
      root.render(
        <ZoomProvider>
          <KeyboardProvider>
            <MetricsSection />
          </KeyboardProvider>
        </ZoomProvider>
      );
    });
    await flush();
  };

  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    for (const mock of Object.values(sourceMocks)) {
      mock.mockReset();
    }
    kubeconfigState.kubeconfigs = [
      { name: 'dev', context: 'dev-cluster', path: '/kube/dev' },
      { name: 'stg', context: 'stg-cluster', path: '/kube/stg' },
    ];
    kubeconfigState.managedClusterIds = ['dev:dev-cluster'];
    sourceMocks.loadMetricServiceCandidates.mockResolvedValue([
      { namespace: 'kube-prometheus-stack', name: 'kube-prometheus-stack-prometheus' },
      { namespace: 'monitoring', name: 'prometheus-operated' },
    ]);
    sourceMocks.loadServicePorts.mockResolvedValue([
      { port: 9090, name: 'http-web', protocol: 'TCP' },
      { port: 8080, name: 'reloader-web', protocol: 'TCP' },
    ]);
    sourceMocks.setClusterMetricAssignment.mockResolvedValue(undefined);
    sourceMocks.deleteMetricSource.mockResolvedValue(undefined);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    Element.prototype.scrollIntoView = nativeScrollIntoView;
  });

  it('creates an in-cluster source from the Service and port the user picks', async () => {
    sourceMocks.loadMetricSourceSettings.mockResolvedValue(settings());
    sourceMocks.saveMetricSource.mockImplementation(async (source: backend.MetricSource) => ({
      ...source,
      id: 'src-new',
    }));
    await render();

    const save = buttonNamed('Save');
    expect(save?.disabled).toBe(true);
    await act(async () => {
      setInputValue(
        requireValue(document.querySelector<HTMLInputElement>('input[aria-label="Name"]'), 'name'),
        'dev prometheus'
      );
    });
    await choose('Cluster', 'dev-cluster');
    expect(sourceMocks.loadMetricServiceCandidates).toHaveBeenCalledWith('dev:dev-cluster');
    await choose('Namespace', 'kube-prometheus-stack');
    await choose('Service', 'kube-prometheus-stack-prometheus');
    expect(sourceMocks.loadServicePorts).toHaveBeenCalledWith(
      'dev:dev-cluster',
      'kube-prometheus-stack',
      'kube-prometheus-stack-prometheus'
    );
    // Nothing is pre-selected: the source cannot be saved until a port is chosen.
    expect(buttonNamed('Save')?.disabled).toBe(true);
    await choose('Port', 'http-web (9090)');
    await click(buttonNamed('Save'), 'Save');

    expect(sourceMocks.saveMetricSource).toHaveBeenCalledWith({
      id: '',
      name: 'dev prometheus',
      mode: 'in-cluster',
      inCluster: {
        clusterId: 'dev:dev-cluster',
        namespace: 'kube-prometheus-stack',
        service: 'kube-prometheus-stack-prometheus',
        port: 'http-web',
        scheme: 'http',
        pathPrefix: '',
      },
    });
  });

  it('rejects a duplicate source name locally without calling the backend', async () => {
    const other = { ...devSource, id: 'src-other', name: 'other prometheus' };
    sourceMocks.loadMetricSourceSettings.mockResolvedValue(settings([devSource, other]));
    await render();

    const name = requireValue(
      document.querySelector<HTMLInputElement>('input[aria-label="Name"]'),
      'name'
    );
    await act(async () => setInputValue(name, 'Other Prometheus'));

    expect(container.textContent).toContain('already exists');
    expect(buttonNamed('Save')?.disabled).toBe(true);
    expect(sourceMocks.saveMetricSource).not.toHaveBeenCalled();
  });

  it('keeps the edits when saving fails', async () => {
    sourceMocks.loadMetricSourceSettings.mockResolvedValue(settings([devSource]));
    sourceMocks.saveMetricSource.mockRejectedValue(new Error('settings file is read-only'));
    await render();

    const name = requireValue(
      document.querySelector<HTMLInputElement>('input[aria-label="Name"]'),
      'name'
    );
    await act(async () => setInputValue(name, 'renamed'));
    await click(buttonNamed('Save'), 'Save');

    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(name.value).toBe('renamed');
    expect(sourceMocks.loadMetricSourceSettings).toHaveBeenCalledTimes(1);
  });

  it('tests the connection being edited without saving it', async () => {
    sourceMocks.loadMetricSourceSettings.mockResolvedValue(settings([devSource]));
    sourceMocks.testMetricSource.mockResolvedValueOnce({ ok: true, version: '3.15.0' });
    await render();

    await act(async () =>
      setInputValue(
        requireValue(
          document.querySelector<HTMLInputElement>('input[aria-label="Path prefix"]'),
          'path prefix'
        ),
        '/prometheus'
      )
    );
    await click(buttonNamed('Test connection'), 'Test connection');

    expect(sourceMocks.testMetricSource).toHaveBeenCalledWith({
      ...devSource,
      inCluster: { ...devSource.inCluster, pathPrefix: '/prometheus' },
    });
    expect(container.querySelector('[data-connection-test="ok"]')?.textContent).toContain('3.15.0');
    expect(sourceMocks.saveMetricSource).not.toHaveBeenCalled();

    sourceMocks.testMetricSource.mockResolvedValueOnce({
      ok: false,
      error: 'permission denied for services/proxy prometheus-operated',
    });
    await click(buttonNamed('Test connection'), 'Test connection');
    expect(container.querySelector('[data-connection-test="ok"]')).toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('permission denied');
  });

  it('assigns sources per cluster and offers an in-cluster source only to its own cluster', async () => {
    sourceMocks.loadMetricSourceSettings.mockResolvedValue(settings([devSource]));
    await render();

    await click(
      document.querySelector('[aria-label="Metrics source for stg-cluster"]'),
      'stg dropdown'
    );
    expect(optionNamed('dev prometheus')?.hasAttribute('disabled')).toBe(true);
    await click(
      document.querySelector('[aria-label="Metrics source for stg-cluster"]'),
      'close stg dropdown'
    );

    await choose('Metrics source for dev-cluster', 'dev prometheus');
    expect(sourceMocks.setClusterMetricAssignment).toHaveBeenCalledWith('dev:dev-cluster', {
      kind: 'source',
      sourceId: 'src-dev',
    });
  });

  it('returns a cluster to live metrics by clearing its explicit choice', async () => {
    sourceMocks.loadMetricSourceSettings.mockResolvedValue(
      settings([devSource], {
        'dev:dev-cluster': { kind: 'source' as backend.MetricAssignmentKind, sourceId: 'src-dev' },
      })
    );
    await render();

    await choose('Metrics source for dev-cluster', 'Live metrics only');
    expect(sourceMocks.setClusterMetricAssignment).toHaveBeenCalledWith('dev:dev-cluster', {
      kind: 'default',
    });
  });

  it('lists assignments whose cluster no longer exists and can remove them', async () => {
    sourceMocks.loadMetricSourceSettings.mockResolvedValue(
      settings([devSource], { 'old:prod-east': { kind: 'none' as backend.MetricAssignmentKind } })
    );
    await render();

    const orphan = Array.from(container.querySelectorAll('[data-cluster-id]')).find(
      (row) => row.getAttribute('data-cluster-id') === 'old:prod-east'
    );
    expect(orphan?.textContent).toContain('cluster not found');
    await click(
      orphan?.querySelector('button[aria-label="Remove assignment for old:prod-east"]') ?? null,
      'Remove'
    );
    expect(sourceMocks.setClusterMetricAssignment).toHaveBeenCalledWith('old:prod-east', {
      kind: 'default',
    });
  });

  it('does not read the catalog of a disconnected cluster when editing its source', async () => {
    kubeconfigState.managedClusterIds = [];
    sourceMocks.loadMetricSourceSettings.mockResolvedValue(settings([devSource]));
    await render();

    expect(
      document
        .querySelector('[aria-label="Service"]')
        ?.closest('.dropdown')
        ?.classList.contains('disabled')
    ).toBe(true);
    expect(container.textContent).toContain('Open dev-cluster');
    expect(sourceMocks.loadMetricServiceCandidates).not.toHaveBeenCalled();
  });

  it('filters the assignment rows by cluster name', async () => {
    sourceMocks.loadMetricSourceSettings.mockResolvedValue(settings());
    await render();

    const filter = requireValue(
      document.querySelector<HTMLInputElement>('input[aria-label="Filter clusters"]'),
      'filter'
    );
    await act(async () => setInputValue(filter, 'stg'));
    const rows = Array.from(container.querySelectorAll('[data-cluster-id]')).map((row) =>
      row.getAttribute('data-cluster-id')
    );
    expect(rows).toEqual(['stg:stg-cluster']);
  });

  it('deletes a source only after the user confirms', async () => {
    sourceMocks.loadMetricSourceSettings.mockResolvedValue(settings([devSource]));
    await render();

    await click(buttonNamed('Delete'), 'Delete');
    expect(sourceMocks.deleteMetricSource).not.toHaveBeenCalled();
    await click(buttonNamed('Confirm delete'), 'Confirm delete');
    expect(sourceMocks.deleteMetricSource).toHaveBeenCalledWith('src-dev');
  });
});
