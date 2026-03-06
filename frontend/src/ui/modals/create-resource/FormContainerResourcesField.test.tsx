import { act } from 'react';
import ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FormContainerResourcesField } from './FormContainerResourcesField';

/**
 * Update an input's native value so React's change tracking picks it up.
 */
const setNativeInputValue = (element: HTMLInputElement, value: string) => {
  const valueSetter = Object.getOwnPropertyDescriptor(element, 'value')?.set;
  const prototype = Object.getPrototypeOf(element) as HTMLInputElement;
  const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;

  if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
    prototypeValueSetter.call(element, value);
    return;
  }
  if (valueSetter) {
    valueSetter.call(element, value);
    return;
  }
  element.value = value;
};

describe('FormContainerResourcesField', () => {
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

  it('renders empty state add row and triggers show callback', async () => {
    const onShowFields = vi.fn();

    await act(async () => {
      root.render(
        <FormContainerResourcesField
          dataFieldKey="resources"
          resources={undefined}
          showFields={false}
          onShowFields={onShowFields}
          onRemoveResources={vi.fn()}
          onResourceValueChange={vi.fn()}
        />
      );
    });

    const addButton = container.querySelector(
      'button[aria-label="Add Resources"]'
    ) as HTMLButtonElement;
    expect(addButton).not.toBeNull();
    expect(container.textContent).toContain('Add resource requests/limits');

    await act(async () => {
      addButton.click();
    });

    expect(onShowFields).toHaveBeenCalledTimes(1);
  });

  it('renders requests and limits rows and wires value changes', async () => {
    const onResourceValueChange = vi.fn();

    await act(async () => {
      root.render(
        <FormContainerResourcesField
          dataFieldKey="resources"
          resources={{ requests: { cpu: '100m' }, limits: { memory: '256Mi' } }}
          showFields
          onShowFields={vi.fn()}
          onRemoveResources={vi.fn()}
          onResourceValueChange={onResourceValueChange}
        />
      );
    });

    const requestsCpu = container.querySelector(
      'input[data-field-key="requestsCpu"]'
    ) as HTMLInputElement;
    const limitsMemory = container.querySelector(
      'input[data-field-key="limitsMemory"]'
    ) as HTMLInputElement;

    expect(requestsCpu.value).toBe('100m');
    expect(limitsMemory.value).toBe('256Mi');

    const removeButtons = container.querySelectorAll('button.resource-form-remove-btn');
    expect((removeButtons[0] as HTMLButtonElement).className).not.toContain(
      'resource-form-icon-btn--hidden'
    );
    expect((removeButtons[1] as HTMLButtonElement).className).toContain(
      'resource-form-icon-btn--hidden'
    );

    await act(async () => {
      setNativeInputValue(requestsCpu, '250m');
      requestsCpu.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(onResourceValueChange).toHaveBeenCalledWith(['requests', 'cpu'], '250m');
  });

  it('passes hasAnyValue flag to remove callback', async () => {
    const onRemoveResources = vi.fn();

    await act(async () => {
      root.render(
        <FormContainerResourcesField
          dataFieldKey="resources"
          resources={{}}
          showFields
          onShowFields={vi.fn()}
          onRemoveResources={onRemoveResources}
          onResourceValueChange={vi.fn()}
        />
      );
    });

    const removeButton = container.querySelector(
      'button[aria-label="Remove Resources"]'
    ) as HTMLButtonElement;

    await act(async () => {
      removeButton.click();
    });

    expect(onRemoveResources).toHaveBeenCalledWith(false);

    await act(async () => {
      root.render(
        <FormContainerResourcesField
          dataFieldKey="resources"
          resources={{ requests: { cpu: '100m' } }}
          showFields
          onShowFields={vi.fn()}
          onRemoveResources={onRemoveResources}
          onResourceValueChange={vi.fn()}
        />
      );
    });

    const removeButtonWithValues = container.querySelector(
      'button[aria-label="Remove Resources"]'
    ) as HTMLButtonElement;

    await act(async () => {
      removeButtonWithValues.click();
    });

    expect(onRemoveResources).toHaveBeenLastCalledWith(true);
  });
});
