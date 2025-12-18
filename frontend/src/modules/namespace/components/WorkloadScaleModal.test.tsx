import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkloadData } from '@modules/namespace/components/NsViewWorkloads.helpers';
import WorkloadScaleModal from '@modules/namespace/components/WorkloadScaleModal';

describe('WorkloadScaleModal', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  const workload: WorkloadData = {
    kind: 'Deployment',
    name: 'queue-worker',
    namespace: 'team-a',
    status: 'Running',
  };

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

  const renderComponent = async (
    props: Partial<React.ComponentProps<typeof WorkloadScaleModal>> = {}
  ) => {
    const onCancel = vi.fn();
    const onApply = vi.fn();
    const onInputChange = vi.fn();
    const onIncrement = vi.fn();

    const finalProps: React.ComponentProps<typeof WorkloadScaleModal> = {
      scaleState: { show: false, workload: null, value: 0 },
      scaleLoading: false,
      scaleError: null,
      onCancel,
      onApply,
      onInputChange,
      onIncrement,
      ...props,
    };

    await act(async () => {
      root.render(<WorkloadScaleModal {...finalProps} />);
      await Promise.resolve();
    });

    return {
      onCancel,
      onApply,
      onInputChange,
      onIncrement,
    };
  };

  it('renders nothing when modal is hidden', async () => {
    await renderComponent();
    expect(document.querySelector('.scale-modal')).toBeNull();
  });

  it('renders modal content and forwards interactions', async () => {
    const callbacks = await renderComponent({
      scaleState: { show: true, workload, value: 3 },
    });

    const modal = document.querySelector('.scale-modal');
    expect(modal).toBeTruthy();
    expect(modal?.querySelector('h2')?.textContent).toContain('queue-worker');

    const decrement = modal?.querySelectorAll<HTMLButtonElement>('.scale-spinner-btn')[0];
    const increment = modal?.querySelectorAll<HTMLButtonElement>('.scale-spinner-btn')[1];
    const applyButton = modal?.querySelector<HTMLButtonElement>('.button.warning');

    await act(async () => {
      increment?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      decrement?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    expect(callbacks.onIncrement).toHaveBeenCalledWith(1);
    expect(callbacks.onIncrement).toHaveBeenCalledWith(-1);

    await act(async () => {
      applyButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    expect(callbacks.onApply).toHaveBeenCalled();

    await act(async () => {
      modal?.parentElement?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    expect(callbacks.onCancel).toHaveBeenCalled();
  });
});
