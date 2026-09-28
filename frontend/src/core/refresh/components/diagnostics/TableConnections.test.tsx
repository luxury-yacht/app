import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireValue } from '@/test-utils/requireValue';
import type { BrokerReadRow } from './diagnosticsPanelTypes';
import { ConnectionsTable } from './TableConnections';

const createReadRow = (key: string, broker: string, label: string): BrokerReadRow => ({
  key,
  broker,
  label,
  resource: 'resource',
  adapter: 'adapter',
  reason: 'reason',
  scope: 'scope',
  inFlightCount: 0,
  totalRequests: 1,
  successCount: 1,
  errorCount: 0,
  blockedCount: 0,
  lastStatus: 'success',
  lastDuration: '1ms',
  lastUpdated: 'now',
  lastUpdatedTooltip: '',
  lastError: '',
});

const accessibleName = (element: Element): string => {
  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    return labelledBy
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ')
      .trim();
  }
  return element.getAttribute('aria-label') ?? '';
};

describe('ConnectionsTable', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeAll(() => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('filters reads by the broker chosen in the Broker dropdown', () => {
    act(() => {
      root.render(
        <ConnectionsTable
          rows={[]}
          callRows={[
            createReadRow('cluster-read', 'Cluster Data', 'cluster-read'),
            createReadRow('app-read', 'App State', 'app-read'),
          ]}
          summary="0 connections"
          callsSummary="2 reads"
        />
      );
    });

    const brokerTrigger = requireValue(
      Array.from(container.querySelectorAll('[role="combobox"]')).find(
        (element) => accessibleName(element) === 'Broker'
      ),
      'expected a Broker dropdown'
    ) as HTMLElement;

    act(() => {
      brokerTrigger.click();
    });
    act(() => {
      requireValue(
        Array.from(document.body.querySelectorAll<HTMLElement>('[role="option"]')).find(
          (option) => option.textContent === 'App State'
        ),
        'expected an App State option'
      ).click();
    });

    const visibleReads = Array.from(
      container.querySelectorAll('tbody .diagnostics-domain'),
      (element) => element.textContent
    );
    expect(visibleReads).toEqual(['app-read']);
  });
});
