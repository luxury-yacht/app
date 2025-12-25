/**
 * frontend/src/shared/components/kubernetes/ResourceStatus.test.tsx
 *
 * Test suite for ResourceStatus.
 * Covers key behaviors and edge cases for ResourceStatus.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock(
  '@modules/object-panel/components/ObjectPanel/Details/Overview/shared/OverviewItem',
  () => ({
    OverviewItem: ({ label, value }: { label: React.ReactNode; value: React.ReactNode }) => (
      <div className="overview-item-mock" data-label={String(label)}>
        {value}
      </div>
    ),
  })
);

import { ResourceStatus } from './ResourceStatus';

const renderStatus = async (props: React.ComponentProps<typeof ResourceStatus>) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);

  await act(async () => {
    root.render(<ResourceStatus {...props} />);
    await Promise.resolve();
  });

  return {
    container,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
};

describe('ResourceStatus', () => {
  let container: HTMLDivElement | null;

  beforeEach(() => {
    container = null;
  });

  afterEach(() => {
    container?.remove();
  });

  it('returns null when nothing is provided', async () => {
    const result = await renderStatus({});
    container = result.container;
    expect(result.container.innerHTML).toBe('');
    result.cleanup();
  });

  it('renders status badge with severity class', async () => {
    const { container: root, cleanup } = await renderStatus({
      status: 'Running',
      statusSeverity: 'Warning',
    });
    container = root;

    const badge = root.querySelector('.status-badge');
    expect(badge?.textContent).toBe('Running');
    expect(badge?.classList.contains('warning')).toBe(true);
    cleanup();
  });

  it('renders ready badge and highlights when counts mismatch', async () => {
    const { container: root, cleanup } = await renderStatus({
      ready: '1/3',
    });
    container = root;

    const badge = root.querySelector('.status-badge.warning');
    expect(badge?.textContent).toBe('1/3');
    cleanup();
  });

  it('renders conditions list', async () => {
    const { container: root, cleanup } = await renderStatus({
      conditions: [
        { type: 'Available', status: 'True', message: 'All good' },
        { type: 'Progressing', status: 'False' },
      ],
    });
    container = root;

    const conditions = root.querySelectorAll('.condition-item');
    expect(conditions.length).toBe(2);
    expect(root.textContent).toContain('Available');
    expect(root.textContent).toContain('All good');
    cleanup();
  });

  it('renders custom label when provided', async () => {
    const { container: root, cleanup } = await renderStatus({
      status: 'Ready',
      customLabel: 'Phase',
    });
    container = root;

    const mockItem = root.querySelector('.overview-item-mock');
    expect(mockItem?.getAttribute('data-label')).toBe('Phase');
    cleanup();
  });
});
