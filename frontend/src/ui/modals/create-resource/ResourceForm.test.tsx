import { act } from 'react';
import ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResourceFormDefinition } from './formDefinitions';

// A simple definition for testing.
const testDefinition: ResourceFormDefinition = {
  kind: 'TestKind',
  sections: [
    {
      title: 'Metadata',
      fields: [
        { key: 'name', label: 'Name', path: ['metadata', 'name'], type: 'text', placeholder: 'test-name' },
        { key: 'replicas', label: 'Replicas', path: ['spec', 'replicas'], type: 'number', placeholder: '1' },
        {
          key: 'type',
          label: 'Type',
          path: ['spec', 'type'],
          type: 'select',
          options: [
            { label: 'ClusterIP', value: 'ClusterIP' },
            { label: 'NodePort', value: 'NodePort' },
          ],
        },
      ],
    },
    {
      title: 'Data',
      fields: [
        { key: 'data', label: 'Data', path: ['data'], type: 'key-value-list' },
      ],
    },
    {
      title: 'Items',
      fields: [
        {
          key: 'items',
          label: 'Items',
          path: ['spec', 'items'],
          type: 'group-list',
          fields: [
            { key: 'itemName', label: 'Item Name', path: ['name'], type: 'text', placeholder: 'item' },
          ],
          defaultValue: { name: '' },
        },
      ],
    },
  ],
};

const sampleYaml = `apiVersion: v1
kind: TestKind
metadata:
  name: test-app
spec:
  replicas: 3
  type: ClusterIP
  items:
  - name: first
data:
  KEY_A: value-a
  KEY_B: value-b
`;

describe('ResourceForm', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    root.unmount();
    container.remove();
  });

  const renderForm = async (yaml: string, onChange: (yaml: string) => void) => {
    const { ResourceForm } = await import('./ResourceForm');
    await act(async () => {
      root.render(
        <ResourceForm
          definition={testDefinition}
          yamlContent={yaml}
          onYamlChange={onChange}
        />
      );
    });
  };

  it('renders section titles', async () => {
    await renderForm(sampleYaml, vi.fn());
    expect(container.textContent).toContain('Metadata');
    expect(container.textContent).toContain('Data');
    expect(container.textContent).toContain('Items');
  });

  it('renders text input with current value from YAML', async () => {
    await renderForm(sampleYaml, vi.fn());
    const nameInput = container.querySelector('input[data-field-key="name"]') as HTMLInputElement;
    expect(nameInput).not.toBeNull();
    expect(nameInput.value).toBe('test-app');
  });

  it('renders number input with current value from YAML', async () => {
    await renderForm(sampleYaml, vi.fn());
    const replicasInput = container.querySelector('input[data-field-key="replicas"]') as HTMLInputElement;
    expect(replicasInput).not.toBeNull();
    expect(replicasInput.value).toBe('3');
  });

  it('renders select with current value from YAML', async () => {
    await renderForm(sampleYaml, vi.fn());
    const select = container.querySelector('select[data-field-key="type"]') as HTMLSelectElement;
    expect(select).not.toBeNull();
    expect(select.value).toBe('ClusterIP');
  });

  it('calls onYamlChange when text input changes', async () => {
    const onChange = vi.fn();
    await renderForm(sampleYaml, onChange);
    const nameInput = container.querySelector('input[data-field-key="name"]') as HTMLInputElement;

    await act(async () => {
      nameInput.value = 'new-name';
      nameInput.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalled();
    const updatedYaml = onChange.mock.calls[0][0];
    expect(updatedYaml).toContain('name: new-name');
  });

  it('renders key-value list with existing entries', async () => {
    await renderForm(sampleYaml, vi.fn());
    const kvRows = container.querySelectorAll('[data-field-key="data"] .resource-form-kv-row');
    expect(kvRows.length).toBe(2);
  });

  it('renders group-list items', async () => {
    await renderForm(sampleYaml, vi.fn());
    const groupItems = container.querySelectorAll('[data-field-key="items"] .resource-form-group-item');
    expect(groupItems.length).toBe(1);
  });

  it('shows parse error message for invalid YAML', async () => {
    await renderForm('invalid: yaml: :', vi.fn());
    expect(container.textContent).toContain('YAML has syntax errors');
  });
});
