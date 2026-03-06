import { act } from 'react';
import ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FormEmptyActionRow, FormGhostAddText, FormIconActionButton } from './FormActionPrimitives';

describe('FormActionPrimitives', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('renders visible add button and handles click', async () => {
    const onClick = vi.fn();
    await act(async () => {
      root.render(<FormIconActionButton variant="add" label="Add Label" onClick={onClick} />);
    });

    const btn = container.querySelector('button[aria-label="Add Label"]') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.disabled).toBe(false);
    expect(btn.querySelector('svg')).not.toBeNull();

    await act(async () => {
      btn.click();
    });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders hidden remove button as disabled placeholder when requested', async () => {
    await act(async () => {
      root.render(
        <FormIconActionButton
          variant="remove"
          label="Remove Label"
          hidden
          placeholder
          onClick={vi.fn()}
        />
      );
    });

    const btn = container.querySelector('button') as HTMLButtonElement;
    expect(btn.className).toContain('resource-form-icon-btn--hidden');
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-hidden')).toBe('true');
    expect(btn.getAttribute('aria-label')).toBeNull();
    expect(btn.tabIndex).toBe(-1);
  });

  it('shows ghost text only when provided', async () => {
    await act(async () => {
      root.render(<FormGhostAddText text={null} />);
    });
    expect(container.textContent).toBe('');

    await act(async () => {
      root.render(<FormGhostAddText text="Add label" />);
    });
    expect(container.textContent).toContain('Add label');
  });

  it('renders empty action row with left alignment and hidden remove placeholder', async () => {
    await act(async () => {
      root.render(
        <FormEmptyActionRow
          rowClassName="resource-form-kv-row"
          actionsClassName="resource-form-actions-inline"
          alignLeft
          alignLeftClassName="resource-form-actions-inline--left"
          addLabel="Add Annotation"
          removeLabel="Remove Annotation"
          onAdd={vi.fn()}
          ghostText="Add annotation"
        />
      );
    });

    const actions = container.querySelector('.resource-form-actions-inline') as HTMLElement;
    expect(actions.className).toContain('resource-form-actions-inline--left');
    expect(container.textContent).toContain('Add annotation');

    const buttons = container.querySelectorAll('button');
    expect(buttons.length).toBe(2);
    expect((buttons[1] as HTMLButtonElement).className).toContain('resource-form-icon-btn--hidden');
  });
});
