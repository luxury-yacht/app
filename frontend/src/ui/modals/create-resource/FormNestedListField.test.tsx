import { act } from 'react';
import ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FormNestedListField } from './FormNestedListField';

describe('FormNestedListField', () => {
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

  it('shows add button only on the last row and calls remove by index', async () => {
    const onAdd = vi.fn();
    const onRemove = vi.fn();
    const items = [{ name: 'A' }, { name: 'B' }];

    await act(async () => {
      root.render(
        <FormNestedListField
          dataFieldKey="ports"
          items={items}
          addLabel="Add Ports"
          removeLabel="Remove Ports"
          onAdd={onAdd}
          onRemove={onRemove}
          renderFields={(item, index) => (
            <div data-testid={`fields-${index}`} className="resource-form-nested-group-field">
              {item.name}
            </div>
          )}
        />
      );
    });

    const addButtons = container.querySelectorAll('button.resource-form-add-btn');
    expect(addButtons.length).toBe(2);
    expect((addButtons[0] as HTMLButtonElement).className).toContain(
      'resource-form-icon-btn--hidden'
    );
    expect((addButtons[1] as HTMLButtonElement).className).not.toContain(
      'resource-form-icon-btn--hidden'
    );

    const removeButtons = container.querySelectorAll('button.resource-form-remove-btn');
    await act(async () => {
      (removeButtons[0] as HTMLButtonElement).click();
      (addButtons[1] as HTMLButtonElement).click();
    });

    expect(onRemove).toHaveBeenCalledWith(0);
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('renders left-aligned empty state with ghost text', async () => {
    const onAdd = vi.fn();

    await act(async () => {
      root.render(
        <FormNestedListField
          dataFieldKey="env"
          items={[] as Array<{ name: string }>}
          addLabel="Add Env Vars"
          removeLabel="Remove Env Vars"
          onAdd={onAdd}
          onRemove={vi.fn()}
          leftAlignEmptyStateActions
          addGhostText="Add env var"
          renderFields={() => null}
        />
      );
    });

    const actions = container.querySelector(
      '.resource-form-nested-group-row-actions'
    ) as HTMLElement;
    expect(actions.className).toContain('resource-form-nested-group-row-actions--left');
    expect(container.textContent).toContain('Add env var');

    const addButton = container.querySelector(
      'button[aria-label="Add Env Vars"]'
    ) as HTMLButtonElement;
    await act(async () => {
      addButton.click();
    });
    expect(onAdd).toHaveBeenCalledTimes(1);
  });
});
