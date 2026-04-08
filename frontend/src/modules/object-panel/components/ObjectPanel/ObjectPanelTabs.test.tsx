/**
 * frontend/src/modules/object-panel/components/ObjectPanel/ObjectPanelTabs.test.tsx
 */

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

    // The shared Tabs component renders <div role="tab"> rather than <button>,
    // so we use HTMLElement here. The .tab-item class is still present.
    const tabItems = Array.from(container.querySelectorAll<HTMLElement>('.tab-item'));
    expect(tabItems).toHaveLength(3);
    expect(tabItems[1].classList.contains('tab-item--active')).toBe(true);
    expect(tabItems[0].classList.contains('tab-item--active')).toBe(false);
  });

  it('invokes onSelect when a tab is clicked', async () => {
    const onSelect = vi.fn();
    act(() => {
      root.render(<ObjectPanelTabs tabs={tabs} activeTab="details" onSelect={onSelect} />);
    });

    // The shared Tabs component renders <div role="tab"> rather than <button>.
    const logsButton = container.querySelectorAll<HTMLElement>('.tab-item')[1];
    await act(async () => {
      logsButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onSelect).toHaveBeenCalledWith('logs');
  });

  it('marks each tab with data-object-panel-focusable so the panel focus walker finds them', () => {
    // The ObjectPanel's custom focus walker (ObjectPanel.tsx) queries
    // [data-object-panel-focusable="true"] to build its list of focusable
    // elements. This attribute is load-bearing — if it stops being
    // forwarded through extraProps on the shared component, the panel's
    // Escape/Arrow key navigation silently breaks. Assert it explicitly.
    act(() => {
      root.render(<ObjectPanelTabs tabs={tabs} activeTab="details" onSelect={vi.fn()} />);
    });

    const tabItems = Array.from(container.querySelectorAll<HTMLElement>('.tab-item'));
    expect(tabItems).toHaveLength(3);
    tabItems.forEach((el) => {
      expect(el.dataset.objectPanelFocusable).toBe('true');
    });
  });
});
