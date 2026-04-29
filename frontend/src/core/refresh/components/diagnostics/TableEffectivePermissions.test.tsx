import { act } from 'react';
import ReactDOM from 'react-dom/client';
import { describe, expect, it } from 'vitest';

import { EffectivePermissionsTable } from './TableEffectivePermissions';
import type { PermissionRow } from './diagnosticsPanelTypes';

const setSearchValue = (input: HTMLInputElement, value: string): void => {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  valueSetter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

const createPermissionRow = (index: number): PermissionRow => ({
  id: `permission-${index}`,
  clusterId: 'cluster-1',
  scope: `namespace-${index}`,
  descriptorLabel: `pods (list) ${index}`,
  resource: 'pods',
  verb: 'list',
  allowed: 'Yes',
  isDenied: false,
  descriptorNamespace: `namespace-${index}`,
  pendingCount: 0,
  inFlightCount: 0,
  runtimeDisplay: '—',
  lastDurationDisplay: '—',
  age: { display: '—', tooltip: '' },
  lastResult: 'Success',
  consecutiveFailureCount: 0,
  totalChecks: 1,
  lastError: null,
  descriptorKey: `cluster-1|/v1|pod|list|namespace-${index}|`,
});

describe('EffectivePermissionsTable', () => {
  it('renders large permission sets incrementally', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = ReactDOM.createRoot(host);
    const rows = Array.from({ length: 300 }, (_, index) => createPermissionRow(index));

    await act(async () => {
      root.render(<EffectivePermissionsTable rows={rows} />);
      await Promise.resolve();
    });

    expect(host.querySelectorAll('tbody tr')).toHaveLength(250);
    expect(host.textContent).toContain('300 CHECKS • Showing 250');
    const showMore = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Show 50 More')
    );
    expect(showMore).toBeInstanceOf(HTMLButtonElement);

    await act(async () => {
      showMore?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(host.querySelectorAll('tbody tr')).toHaveLength(300);

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });

  it('filters across rows that are not currently rendered', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = ReactDOM.createRoot(host);
    const rows = Array.from({ length: 300 }, (_, index) => createPermissionRow(index));

    await act(async () => {
      root.render(<EffectivePermissionsTable rows={rows} />);
      await Promise.resolve();
    });

    const search = host.querySelector<HTMLInputElement>('input[type="search"]');
    expect(search).toBeTruthy();

    await act(async () => {
      setSearchValue(search!, 'namespace-299');
      await Promise.resolve();
    });

    expect(host.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(host.textContent).toContain('1 OF 300 CHECKS');
    expect(host.textContent).toContain('namespace-299');

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });
});
