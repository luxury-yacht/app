import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ObjectPanelTabs } from '@modules/object-panel/components/ObjectPanel/ObjectPanelTabs';

describe('ObjectPanelTabs', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  const tabs = [
    { id: 'details', label: 'Details' },
    { id: 'logs', label: 'Logs' },
    { id: 'events', label: 'Events' },
  ];

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
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

  it('renders tabs and highlights the active one', () => {
    act(() => {
      root.render(<ObjectPanelTabs tabs={tabs} activeTab="logs" onSelect={vi.fn()} />);
    });

    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('.tab'));
    expect(buttons).toHaveLength(3);
    expect(buttons[1].classList.contains('active')).toBe(true);
    expect(buttons[0].classList.contains('active')).toBe(false);
  });

  it('invokes onSelect when a tab is clicked', async () => {
    const onSelect = vi.fn();
    act(() => {
      root.render(<ObjectPanelTabs tabs={tabs} activeTab="details" onSelect={onSelect} />);
    });

    const logsButton = container.querySelectorAll<HTMLButtonElement>('.tab')[1];
    await act(async () => {
      logsButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onSelect).toHaveBeenCalledWith('logs');
  });
});
