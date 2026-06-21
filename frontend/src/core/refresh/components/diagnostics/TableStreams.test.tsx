import { act } from 'react';
import ReactDOM from 'react-dom/client';
import { describe, expect, it } from 'vitest';

import { DiagnosticsStreamsTable } from './TableStreams';
import type { DiagnosticsStreamRow } from './diagnosticsPanelTypes';

describe('DiagnosticsStreamsTable', () => {
  it('only colours an actual Last Error (warning class); the "—" placeholder stays plain', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = ReactDOM.createRoot(host);

    // Two domain leaves: one with no error ("—"), one with a real error. Domain
    // rows are the case that regressed — they must not render "—" in red.
    const rows: DiagnosticsStreamRow[] = [
      {
        kind: 'domain',
        rowKey: 'domain::resources::c1::nodes',
        cluster: 'kwok',
        domain: 'Nodes',
        delivered: 1,
        dropped: 0,
        errors: 0,
        resyncs: 0,
        fallbacks: 0,
        lastEvent: '1s',
        lastEventTooltip: '1s',
        lastError: '—',
      },
      {
        kind: 'domain',
        rowKey: 'domain::resources::c1::pods',
        cluster: 'kwok',
        domain: 'Pods',
        delivered: 1,
        dropped: 1,
        errors: 1,
        resyncs: 0,
        fallbacks: 0,
        lastEvent: '1s',
        lastEventTooltip: '1s',
        lastError: 'pods backlog',
        lastErrorAt: 1_700_000_000_000,
      },
    ];

    await act(async () => {
      root.render(<DiagnosticsStreamsTable rows={rows} summary="streams" />);
    });

    const bodyRows = host.querySelectorAll('tbody tr');
    const placeholderCell = bodyRows[0].querySelectorAll('td')[7];
    const errorCell = bodyRows[1].querySelectorAll('td')[7];

    // Placeholder: plain cell — neither the red error class nor the warning class,
    // and no relative-age element.
    expect(placeholderCell.textContent?.trim()).toBe('—');
    expect(placeholderCell.classList.contains('diagnostics-error')).toBe(false);
    expect(placeholderCell.classList.contains('diagnostics-error-warning')).toBe(false);
    expect(placeholderCell.querySelector('.diagnostics-error-age')).toBeNull();

    // Actual error: warning class (never red), the message, and the relative age
    // of when it occurred.
    expect(errorCell.textContent).toContain('pods backlog');
    expect(errorCell.classList.contains('diagnostics-error-warning')).toBe(true);
    expect(errorCell.classList.contains('diagnostics-error')).toBe(false);
    const ageEl = errorCell.querySelector('.diagnostics-error-age');
    expect(ageEl).not.toBeNull();
    expect((ageEl?.textContent ?? '').trim().length).toBeGreaterThan(0);

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });
});
