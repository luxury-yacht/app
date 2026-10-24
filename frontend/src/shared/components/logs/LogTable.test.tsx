/**
 * frontend/src/shared/components/logs/LogTable.test.tsx
 *
 * Log rows expand in place, so Space (the app's expand key) toggles the
 * focused row exactly as Enter and a click do.
 */

import { ZoomProvider } from '@core/contexts/ZoomContext';
import { KeyboardProvider } from '@ui/shortcuts';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PanelLayoutTestProvider } from '@/test-utils/PanelLayoutTestProvider';
import { requireValue } from '@/test-utils/requireValue';
import LogTable from './LogTable';

vi.mock('@core/desktop-runtime', () => ({
  desktopRuntimeAvailable: () => false,
  onEvent: () => () => undefined,
}));

interface LogRow {
  id: string;
  message: string;
}

const rows: LogRow[] = [
  { id: 'line-1', message: 'started' },
  { id: 'line-2', message: 'ready' },
];
const columns = [{ key: 'message', header: 'Message', render: (row: LogRow) => row.message }];

describe('LogTable', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it.each(['Enter', ' '])('toggles the focused log row with %s', async (key) => {
    const onToggleRow = vi.fn();
    await act(async () => {
      root.render(
        <PanelLayoutTestProvider>
          <KeyboardProvider>
            <ZoomProvider>
              <LogTable
                rows={rows}
                columns={columns}
                keyExtractor={(row) => row.id}
                expandedRows={new Set()}
                onToggleRow={onToggleRow}
                className="log-table"
              />
            </ZoomProvider>
          </KeyboardProvider>
        </PanelLayoutTestProvider>
      );
    });
    const table = requireValue(
      container.querySelector<HTMLTableElement>('table[tabindex="0"]'),
      'log table'
    );
    await act(async () => table.focus());

    await act(async () =>
      table.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    );

    expect(onToggleRow).toHaveBeenCalledExactlyOnceWith('line-1');
  });
});
