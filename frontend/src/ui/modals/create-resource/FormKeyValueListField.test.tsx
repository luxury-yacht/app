import { act } from 'react';
import ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FormKeyValueListField } from './FormKeyValueListField';

describe('FormKeyValueListField', () => {
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

  it('renders labeled key/value fields and routes row actions', async () => {
    const onKeyChange = vi.fn();
    const onValueChange = vi.fn();
    const onRemove = vi.fn();
    const onAdd = vi.fn();

    await act(async () => {
      root.render(
        <FormKeyValueListField
          dataFieldKey="labels"
          entries={[
            ['app', 'demo'],
            ['tier', 'api'],
          ]}
          onKeyChange={onKeyChange}
          onValueChange={onValueChange}
          onRemove={onRemove}
          onAdd={onAdd}
          addButtonLabel="Add Label"
          removeButtonLabel="Remove Label"
          showInlineKeyValueLabels
        />
      );
    });

    expect(container.textContent).toContain('Key');
    expect(container.textContent).toContain('Value');

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

  it('renders empty state with left alignment and ghost text', async () => {
    const onAdd = vi.fn();

    await act(async () => {
      root.render(
        <FormKeyValueListField
          dataFieldKey="annotations"
          entries={[]}
          onKeyChange={vi.fn()}
          onValueChange={vi.fn()}
          onRemove={vi.fn()}
          onAdd={onAdd}
          addButtonLabel="Add Annotation"
          removeButtonLabel="Remove Annotation"
          leftAlignEmptyStateActions
          addGhostText="Add annotation"
        />
      );
    });

    const actions = container.querySelector('.resource-form-actions-inline') as HTMLElement;
    expect(actions.className).toContain('resource-form-actions-inline--left');
    expect(container.textContent).toContain('Add annotation');

    const addButton = container.querySelector(
      'button[aria-label="Add Annotation"]'
    ) as HTMLButtonElement;
    await act(async () => {
      addButton.click();
    });
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('supports non-removable rows while preserving action alignment', async () => {
    const onRemove = vi.fn();

    await act(async () => {
      root.render(
        <FormKeyValueListField
          dataFieldKey="selectors"
          entries={[['app.kubernetes.io/name', '']]}
          onKeyChange={vi.fn()}
          onValueChange={vi.fn()}
          onRemove={onRemove}
          onAdd={vi.fn()}
          addButtonLabel="Add Selector"
          removeButtonLabel="Remove Selector"
          canRemoveEntry={() => false}
          showInlineKeyValueLabels
        />
      );
    });

    const removeButton = container.querySelector(
      'button.resource-form-remove-btn'
    ) as HTMLButtonElement;
    expect(removeButton.className).toContain('resource-form-icon-btn--hidden');
    expect(removeButton.disabled).toBe(true);

    await act(async () => {
      removeButton.click();
    });

    expect(onRemove).not.toHaveBeenCalled();
  });
});
