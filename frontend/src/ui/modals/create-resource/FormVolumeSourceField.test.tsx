import { act } from 'react';
import ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FormVolumeSourceField } from './FormVolumeSourceField';

// Mock Dropdown as a simple <select>.
vi.mock('@shared/components/dropdowns/Dropdown', () => ({
  Dropdown: ({
    options,
    value,
    onChange,
    ariaLabel,
  }: {
    options: Array<{ value: string; label: string }>;
    value: string | string[];
    onChange: (next: string | string[]) => void;
    ariaLabel?: string;
  }) => (
    <select
      data-testid={`dropdown-${ariaLabel ?? 'unknown'}`}
      value={Array.isArray(value) ? (value[0] ?? '') : value}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

describe('FormVolumeSourceField', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  /** Helper: render with correct props, returns the updateItem mock. */
  const render = (
    item: Record<string, unknown>,
    updateItem?: (updater: (item: Record<string, unknown>) => Record<string, unknown>) => void
  ) => {
    const mockUpdateItem =
      updateItem ??
      vi.fn<(updater: (item: Record<string, unknown>) => Record<string, unknown>) => void>();
    act(() => {
      root.render(
        <FormVolumeSourceField
          item={item}
          updateItem={mockUpdateItem}
          dataFieldKey="source"
          ariaLabel="Source"
        />
      );
    });
    return mockUpdateItem;
  };

  it('detects configMap source and renders name input', () => {
    render({ name: 'cfg-vol', configMap: { name: 'my-config' } });
    const nameInput = container.querySelector(
      '[data-field-key="configMapName"] input'
    ) as HTMLInputElement;
    expect(nameInput).not.toBeNull();
    expect(nameInput.value).toBe('my-config');
  });

  it('detects secret source and renders name input with aria-required', () => {
    render({ name: 'secret-vol', secret: { secretName: 'my-secret' } });
    const nameInput = container.querySelector(
      '[data-field-key="secretName"] input'
    ) as HTMLInputElement;
    expect(nameInput).not.toBeNull();
    expect(nameInput.value).toBe('my-secret');
    expect(nameInput.getAttribute('aria-required')).toBe('true');
  });

  it('detects PVC source and shows PVC-specific extra fields', () => {
    render({ name: 'pvc-vol', persistentVolumeClaim: { claimName: 'my-claim' } });
    // PVC renders claimName as an extra field.
    const claimInput = container.querySelector(
      '[data-field-key="claimName"] input'
    ) as HTMLInputElement;
    expect(claimInput).not.toBeNull();
    expect(claimInput.value).toBe('my-claim');
  });

  it('detects hostPath source and renders path extra field', () => {
    render({ name: 'host-vol', hostPath: { path: '/data' } });
    const pathInput = container.querySelector('[data-field-key="path"] input') as HTMLInputElement;
    expect(pathInput).not.toBeNull();
    expect(pathInput.value).toBe('/data');
  });

  it('detects emptyDir source via dropdown value', () => {
    render({ name: 'tmp-vol', emptyDir: {} });
    const sourceTypeDropdown = container.querySelector(
      '[data-testid="dropdown-Source"]'
    ) as HTMLSelectElement;
    expect(sourceTypeDropdown.value).toBe('emptyDir');
  });

  it('switching source type calls updateItem with updater that clears old keys', () => {
    const updateItem = vi.fn();
    const item = { name: 'vol', configMap: { name: 'cm' } };
    render(item, updateItem);
    // Switch to PVC.
    const sourceTypeDropdown = container.querySelector(
      '[data-testid="dropdown-Source"]'
    ) as HTMLSelectElement;
    act(() => {
      sourceTypeDropdown.value = 'pvc';
      sourceTypeDropdown.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(updateItem).toHaveBeenCalledTimes(1);
    // The argument is an updater function — call it with the current item to inspect result.
    const updater = updateItem.mock.calls[0][0] as (
      i: Record<string, unknown>
    ) => Record<string, unknown>;
    const result = updater(item);
    expect(result.configMap).toBeUndefined();
    expect(result.persistentVolumeClaim).toBeDefined();
  });

  it('selecting the same source type is a no-op', () => {
    const updateItem = vi.fn();
    render({ name: 'vol', configMap: { name: 'cm' } }, updateItem);
    // Select configMap again.
    const sourceTypeDropdown = container.querySelector(
      '[data-testid="dropdown-Source"]'
    ) as HTMLSelectElement;
    act(() => {
      sourceTypeDropdown.value = 'configMap';
      sourceTypeDropdown.dispatchEvent(new Event('change', { bubbles: true }));
    });
    // updateItem should NOT have been called.
    expect(updateItem).not.toHaveBeenCalled();
  });

  it('configMap source renders items list with add button', () => {
    render({ name: 'vol', configMap: { name: 'cm' } });
    const addBtns = container.querySelectorAll('button.resource-form-add-btn');
    expect(addBtns.length).toBeGreaterThan(0);
  });
});
