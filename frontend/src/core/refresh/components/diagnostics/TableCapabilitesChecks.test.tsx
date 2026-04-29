import { act } from 'react';
import ReactDOM from 'react-dom/client';
import { describe, expect, it } from 'vitest';

import { CapabilityChecksTable } from './TableCapabilitesChecks';
import type { CapabilityBatchRow } from './diagnosticsPanelTypes';

const setSearchValue = (input: HTMLInputElement, value: string): void => {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  valueSetter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

const createBatchRow = (index: number): CapabilityBatchRow => ({
  key: `batch-${index}`,
  clusterId: 'cluster-1',
  scope: `namespace-${index}`,
  pendingCount: 0,
  inFlightCount: 0,
  runtimeDisplay: '—',
  runtimeMs: null,
  lastDurationDisplay: '—',
  age: { display: '—', tooltip: '' },
  lastResult: 'Success',
  lastError: null,
  totalChecks: 4,
  consecutiveFailureCount: 0,
  descriptorsByFeature: null,
  method: 'ssrr',
  ssrrIncomplete: false,
  ssrrRuleCount: 1,
  ssarFallbackCount: 0,
});

describe('CapabilityChecksTable', () => {
  it('renders large previous check sets incrementally', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = ReactDOM.createRoot(host);
    const previousRows = Array.from({ length: 300 }, (_, index) => createBatchRow(index));

    await act(async () => {
      root.render(
        <CapabilityChecksTable currentRows={[]} previousRows={previousRows} summary="300 BATCHES" />
      );
      await Promise.resolve();
    });

    expect(host.querySelectorAll('tr').length).toBeLessThan(300);
    expect(host.textContent).toContain('300 BATCHES • Showing 250');
    const showMore = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Show 50 More')
    );
    expect(showMore).toBeInstanceOf(HTMLButtonElement);

    await act(async () => {
      showMore?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(host.textContent).toContain('namespace-299');

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });

  it('filters across previous rows that are not currently rendered', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = ReactDOM.createRoot(host);
    const previousRows = Array.from({ length: 300 }, (_, index) => createBatchRow(index));

    await act(async () => {
      root.render(
        <CapabilityChecksTable currentRows={[]} previousRows={previousRows} summary="300 BATCHES" />
      );
      await Promise.resolve();
    });

    const search = host.querySelector<HTMLInputElement>('input[type="search"]');
    expect(search).toBeTruthy();

    await act(async () => {
      setSearchValue(search!, 'namespace-299');
      await Promise.resolve();
    });

    expect(host.textContent).toContain('1 MATCHES');
    expect(host.textContent).toContain('namespace-299');
    expect(host.textContent).not.toContain('Show 50 More');

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });
});
