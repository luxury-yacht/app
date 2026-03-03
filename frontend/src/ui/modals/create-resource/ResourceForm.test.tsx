import { act } from 'react';
import ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as YAML from 'yaml';
import type { ResourceFormDefinition } from './formDefinitions';

// Mock Dropdown as a simple <select> so ResourceForm tests can assert values easily.
vi.mock('@shared/components/dropdowns/Dropdown', () => ({
  Dropdown: ({
    options,
    value,
    onChange,
    ariaLabel,
  }: {
    options: Array<{ value: string; label: string; disabled?: boolean }>;
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
        <option key={option.value} value={option.value} disabled={option.disabled}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

// A simple definition for testing.
const testDefinition: ResourceFormDefinition = {
  kind: 'TestKind',
  sections: [
    {
      title: 'Metadata',
      fields: [
        {
          key: 'name',
          label: 'Name',
          path: ['metadata', 'name'],
          type: 'text',
          placeholder: 'test-name',
        },
        { key: 'labels', label: 'Labels', path: ['metadata', 'labels'], type: 'key-value-list' },
        {
          key: 'annotations',
          label: 'Annotations',
          path: ['metadata', 'annotations'],
          type: 'key-value-list',
        },
        {
          key: 'replicas',
          label: 'Replicas',
          path: ['spec', 'replicas'],
          type: 'number',
          placeholder: '1',
          min: 0,
          max: 999,
          integer: true,
        },
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
      fields: [{ key: 'data', label: 'Data', path: ['data'], type: 'key-value-list' }],
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
            {
              key: 'itemName',
              label: 'Item Name',
              path: ['name'],
              type: 'text',
              placeholder: 'item',
            },
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
        <ResourceForm definition={testDefinition} yamlContent={yaml} onYamlChange={onChange} />
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
    const replicasInput = container.querySelector(
      'input[data-field-key="replicas"]'
    ) as HTMLInputElement;
    expect(replicasInput).not.toBeNull();
    expect(replicasInput.value).toBe('3');
    expect(replicasInput.min).toBe('0');
    expect(replicasInput.max).toBe('999');
    expect(replicasInput.step).toBe('1');
  });

  it('rejects out-of-range replicas values and keeps previous value', async () => {
    const onChange = vi.fn();
    await renderForm(sampleYaml, onChange);
    const replicasInput = container.querySelector(
      'input[data-field-key="replicas"]'
    ) as HTMLInputElement;

    await act(async () => {
      replicasInput.value = '1000';
      replicasInput.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(onChange).not.toHaveBeenCalled();
    expect(replicasInput.value).toBe('3');
  });

  it('limits replicas input to three digits while typing', async () => {
    await renderForm(sampleYaml, vi.fn());
    const replicasInput = container.querySelector(
      'input[data-field-key="replicas"]'
    ) as HTMLInputElement;

    await act(async () => {
      replicasInput.value = '2222';
      replicasInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(replicasInput.value).toBe('222');
  });

  it('accepts in-range replicas values', async () => {
    const onChange = vi.fn();
    await renderForm(sampleYaml, onChange);
    const replicasInput = container.querySelector(
      'input[data-field-key="replicas"]'
    ) as HTMLInputElement;

    await act(async () => {
      replicasInput.value = '999';
      replicasInput.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalled();
    const updatedYaml = onChange.mock.calls[0][0] as string;
    expect(updatedYaml).toContain('replicas: 999');
  });

  it('rejects non-integer replicas values', async () => {
    const onChange = vi.fn();
    await renderForm(sampleYaml, onChange);
    const replicasInput = container.querySelector(
      'input[data-field-key="replicas"]'
    ) as HTMLInputElement;

    await act(async () => {
      replicasInput.value = '1.5';
      replicasInput.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(onChange).not.toHaveBeenCalled();
    expect(replicasInput.value).toBe('3');
  });

  it('renders select with current value from YAML', async () => {
    await renderForm(sampleYaml, vi.fn());
    const select = container.querySelector('[data-field-key="type"] select') as HTMLSelectElement;
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
    const groupItems = container.querySelectorAll(
      '[data-field-key="items"] .resource-form-group-item'
    );
    expect(groupItems.length).toBe(1);
  });

  it('renders container name in the card header and removes from the header action', async () => {
    const onChange = vi.fn();
    const { ResourceForm } = await import('./ResourceForm');
    const containerDefinition: ResourceFormDefinition = {
      kind: 'TestKind',
      sections: [
        {
          title: 'Containers',
          fields: [
            {
              key: 'containers',
              label: 'Containers',
              path: ['spec', 'containers'],
              type: 'group-list',
              fields: [
                {
                  key: 'name',
                  label: 'Name',
                  path: ['name'],
                  type: 'text',
                  placeholder: 'main',
                },
              ],
              defaultValue: { name: '' },
            },
          ],
        },
      ],
    };
    const containerYaml = `apiVersion: v1
kind: TestKind
spec:
  containers:
  - name: main
`;

    await act(async () => {
      root.render(
        <ResourceForm
          definition={containerDefinition}
          yamlContent={containerYaml}
          onYamlChange={onChange}
        />
      );
    });

    const headerTitle = container.querySelector(
      '[data-field-key="containers"] .resource-form-group-item-header .resource-form-group-item-title'
    ) as HTMLElement | null;
    expect(headerTitle).not.toBeNull();
    expect(headerTitle?.textContent?.trim()).toBe('main');

    const outsideRemove = container.querySelector(
      '[data-field-key="containers"] .resource-form-group-entry-actions .resource-form-remove-btn'
    );
    expect(outsideRemove).toBeNull();

    const headerRemove = container.querySelector(
      '[data-field-key="containers"] .resource-form-group-item-header .resource-form-remove-btn'
    ) as HTMLButtonElement | null;
    expect(headerRemove).not.toBeNull();

    await act(async () => {
      headerRemove?.click();
    });

    expect(onChange).toHaveBeenCalled();
    const updatedYaml = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as string;
    expect(updatedYaml).not.toContain('- name: main');
  });

  it('reflects existing ports/env vars from YAML and renders add buttons', async () => {
    const { ResourceForm } = await import('./ResourceForm');
    const deploymentLikeDefinition: ResourceFormDefinition = {
      kind: 'Deployment',
      sections: [
        {
          title: 'Containers',
          fields: [
            {
              key: 'containers',
              label: 'Containers',
              path: ['spec', 'template', 'spec', 'containers'],
              type: 'group-list',
              fields: [
                { key: 'name', label: 'Name', path: ['name'], type: 'text' },
                {
                  key: 'ports',
                  label: 'Ports',
                  path: ['ports'],
                  type: 'group-list',
                  fields: [
                    {
                      key: 'containerPort',
                      label: 'Port',
                      path: ['containerPort'],
                      type: 'number',
                      min: 1,
                      max: 65535,
                      integer: true,
                    },
                    {
                      key: 'protocol',
                      label: 'Protocol',
                      path: ['protocol'],
                      type: 'select',
                      options: [{ label: 'TCP', value: 'TCP' }],
                    },
                  ],
                  defaultValue: { containerPort: 80, protocol: 'TCP' },
                },
                {
                  key: 'env',
                  label: 'Env Vars',
                  path: ['env'],
                  type: 'group-list',
                  fields: [
                    { key: 'name', label: 'Name', path: ['name'], type: 'text' },
                    { key: 'value', label: 'Value', path: ['value'], type: 'text' },
                  ],
                  defaultValue: { name: '', value: '' },
                },
              ],
              defaultValue: { name: '', ports: [], env: [] },
            },
          ],
        },
      ],
    };
    const deploymentLikeYaml = `apiVersion: apps/v1
kind: Deployment
spec:
  template:
    spec:
      containers:
        - name: api
          ports:
            - containerPort: 8080
              protocol: TCP
          env:
            - name: LOG_LEVEL
              value: debug
`;

    await act(async () => {
      root.render(
        <ResourceForm
          definition={deploymentLikeDefinition}
          yamlContent={deploymentLikeYaml}
          onYamlChange={vi.fn()}
        />
      );
    });

    const portInput = container.querySelector(
      '[data-field-key="ports"] input[data-field-key="containerPort"]'
    ) as HTMLInputElement;
    const protocolSelect = container.querySelector(
      '[data-field-key="ports"] [data-field-key="protocol"] select'
    ) as HTMLSelectElement;
    const envNameInput = container.querySelector(
      '[data-field-key="env"] input[data-field-key="name"]'
    ) as HTMLInputElement;
    const envValueInput = container.querySelector(
      '[data-field-key="env"] input[data-field-key="value"]'
    ) as HTMLInputElement;

    expect(portInput.value).toBe('8080');
    expect(portInput.min).toBe('1');
    expect(portInput.max).toBe('65535');
    expect(portInput.step).toBe('1');
    expect(protocolSelect.value).toBe('TCP');
    expect(envNameInput.value).toBe('LOG_LEVEL');
    expect(envValueInput.value).toBe('debug');
    const addPortsButton = container.querySelector(
      'button[aria-label="Add Ports"]'
    ) as HTMLButtonElement;
    const addEnvVarsButton = container.querySelector(
      'button[aria-label="Add Env Vars"]'
    ) as HTMLButtonElement;
    expect(addPortsButton).not.toBeNull();
    expect(addPortsButton.textContent).toBe('+');
    expect(addEnvVarsButton).not.toBeNull();
    expect(addEnvVarsButton.textContent).toBe('+');
  });

  it('removes empty protocol option and defaults protocol to TCP when missing', async () => {
    const { ResourceForm } = await import('./ResourceForm');
    const deploymentLikeDefinition: ResourceFormDefinition = {
      kind: 'Deployment',
      sections: [
        {
          title: 'Containers',
          fields: [
            {
              key: 'containers',
              label: 'Containers',
              path: ['spec', 'template', 'spec', 'containers'],
              type: 'group-list',
              fields: [
                { key: 'name', label: 'Name', path: ['name'], type: 'text' },
                {
                  key: 'ports',
                  label: 'Ports',
                  path: ['ports'],
                  type: 'group-list',
                  fields: [
                    {
                      key: 'containerPort',
                      label: 'Port',
                      path: ['containerPort'],
                      type: 'number',
                      min: 1,
                      max: 65535,
                      integer: true,
                    },
                    {
                      key: 'protocol',
                      label: 'Protocol',
                      path: ['protocol'],
                      type: 'select',
                      options: [
                        { label: 'TCP', value: 'TCP' },
                        { label: 'UDP', value: 'UDP' },
                      ],
                    },
                  ],
                  defaultValue: { containerPort: 80, protocol: 'TCP' },
                },
              ],
              defaultValue: { name: '', ports: [] },
            },
          ],
        },
      ],
    };
    const deploymentLikeYaml = `apiVersion: apps/v1
kind: Deployment
spec:
  template:
    spec:
      containers:
        - name: api
          ports:
            - containerPort: 8080
`;

    await act(async () => {
      root.render(
        <ResourceForm
          definition={deploymentLikeDefinition}
          yamlContent={deploymentLikeYaml}
          onYamlChange={vi.fn()}
        />
      );
    });

    const protocolSelect = container.querySelector(
      '[data-field-key="ports"] [data-field-key="protocol"] select'
    ) as HTMLSelectElement;
    expect(protocolSelect).not.toBeNull();
    expect(protocolSelect.value).toBe('TCP');
    const optionLabels = Array.from(protocolSelect.options).map((option) => option.textContent);
    expect(optionLabels).not.toContain('-- Select --');
  });

  it('adds new ports/env vars rows from nested add buttons', async () => {
    const onChange = vi.fn();
    const { ResourceForm } = await import('./ResourceForm');
    const deploymentLikeDefinition: ResourceFormDefinition = {
      kind: 'Deployment',
      sections: [
        {
          title: 'Containers',
          fields: [
            {
              key: 'containers',
              label: 'Containers',
              path: ['spec', 'template', 'spec', 'containers'],
              type: 'group-list',
              fields: [
                { key: 'name', label: 'Name', path: ['name'], type: 'text' },
                {
                  key: 'ports',
                  label: 'Ports',
                  path: ['ports'],
                  type: 'group-list',
                  fields: [
                    {
                      key: 'containerPort',
                      label: 'Port',
                      path: ['containerPort'],
                      type: 'number',
                      min: 1,
                      max: 65535,
                      integer: true,
                    },
                    {
                      key: 'protocol',
                      label: 'Protocol',
                      path: ['protocol'],
                      type: 'select',
                      options: [{ label: 'TCP', value: 'TCP' }],
                    },
                  ],
                  defaultValue: { containerPort: 80, protocol: 'TCP' },
                },
                {
                  key: 'env',
                  label: 'Env Vars',
                  path: ['env'],
                  type: 'group-list',
                  fields: [
                    { key: 'name', label: 'Name', path: ['name'], type: 'text' },
                    { key: 'value', label: 'Value', path: ['value'], type: 'text' },
                  ],
                  defaultValue: { name: '', value: '' },
                },
              ],
              defaultValue: { name: '', ports: [], env: [] },
            },
          ],
        },
      ],
    };
    const deploymentLikeYaml = `apiVersion: apps/v1
kind: Deployment
spec:
  template:
    spec:
      containers:
        - name: api
          ports: []
          env: []
`;

    await act(async () => {
      root.render(
        <ResourceForm
          definition={deploymentLikeDefinition}
          yamlContent={deploymentLikeYaml}
          onYamlChange={onChange}
        />
      );
    });

    const addPorts = container.querySelector(
      'button[aria-label="Add Ports"]'
    ) as HTMLButtonElement | null;
    const addEnvVars = container.querySelector(
      'button[aria-label="Add Env Vars"]'
    ) as HTMLButtonElement | null;
    expect(addPorts).not.toBeNull();
    expect(addEnvVars).not.toBeNull();

    await act(async () => {
      addPorts?.click();
      addEnvVars?.click();
    });

    expect(onChange).toHaveBeenCalled();
    const emittedYamls = onChange.mock.calls.map((call) => call[0] as string);
    expect(emittedYamls.some((yaml) => yaml.includes('containerPort: 80'))).toBe(true);
    expect(emittedYamls.some((yaml) => yaml.includes('protocol: TCP'))).toBe(true);
    expect(emittedYamls.some((yaml) => yaml.includes('env:'))).toBe(true);
  });

  it('uses optional hint for port name and omits blank port name from YAML', async () => {
    const onChange = vi.fn();
    const { ResourceForm } = await import('./ResourceForm');
    const deploymentLikeDefinition: ResourceFormDefinition = {
      kind: 'Deployment',
      sections: [
        {
          title: 'Containers',
          fields: [
            {
              key: 'containers',
              label: 'Containers',
              path: ['spec', 'template', 'spec', 'containers'],
              type: 'group-list',
              fields: [
                { key: 'name', label: 'Name', path: ['name'], type: 'text' },
                {
                  key: 'ports',
                  label: 'Ports',
                  path: ['ports'],
                  type: 'group-list',
                  fields: [
                    {
                      key: 'name',
                      label: 'Name',
                      path: ['name'],
                      type: 'text',
                      placeholder: 'optional',
                      omitIfEmpty: true,
                    },
                    {
                      key: 'containerPort',
                      label: 'Port',
                      path: ['containerPort'],
                      type: 'number',
                      min: 1,
                      max: 65535,
                      integer: true,
                    },
                    {
                      key: 'protocol',
                      label: 'Protocol',
                      path: ['protocol'],
                      type: 'select',
                      options: [{ label: 'TCP', value: 'TCP' }],
                    },
                  ],
                  defaultValue: { name: '', containerPort: 80, protocol: 'TCP' },
                },
              ],
              defaultValue: { name: '', ports: [] },
            },
          ],
        },
      ],
    };
    const deploymentLikeYaml = `apiVersion: apps/v1
kind: Deployment
spec:
  template:
    spec:
      containers:
        - name: api
          ports:
            - name: http
              containerPort: 8080
              protocol: TCP
`;

    await act(async () => {
      root.render(
        <ResourceForm
          definition={deploymentLikeDefinition}
          yamlContent={deploymentLikeYaml}
          onYamlChange={onChange}
        />
      );
    });

    const portNameInput = container.querySelector(
      '[data-field-key="ports"] input[data-field-key="name"]'
    ) as HTMLInputElement;
    expect(portNameInput).not.toBeNull();
    expect(portNameInput.placeholder).toBe('optional');
    expect(portNameInput.value).toBe('http');

    await act(async () => {
      setNativeInputValue(portNameInput, '');
      portNameInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalled();
    const updatedYaml = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as string;
    const parsed = YAML.parse(updatedYaml) as {
      spec?: { template?: { spec?: { containers?: Array<{ ports?: Array<{ name?: string }> }> } } };
    };
    const firstPort = parsed.spec?.template?.spec?.containers?.[0]?.ports?.[0];
    expect(firstPort?.name).toBeUndefined();
  });

  it('renders contextual add labels without plus prefixes', async () => {
    await renderForm(sampleYaml, vi.fn());
    const addButtons = Array.from(container.querySelectorAll('.resource-form-add-btn')).map(
      (button) => button.textContent?.trim() ?? ''
    );

    expect(addButtons).toContain('Add Label');
    expect(addButtons).toContain('Add Annotation');
    expect(addButtons).toContain('Add Entry');
    expect(addButtons.some((label) => label.startsWith('+'))).toBe(false);
  });

  it('adds annotation entries when Add Annotation is clicked', async () => {
    const onChange = vi.fn();
    await renderForm(sampleYaml, onChange);
    const addAnnotationButton = Array.from(
      container.querySelectorAll('.resource-form-add-btn')
    ).find((button) => button.textContent?.trim() === 'Add Annotation') as
      | HTMLButtonElement
      | undefined;

    expect(addAnnotationButton).toBeDefined();

    await act(async () => {
      addAnnotationButton?.click();
    });

    expect(onChange).toHaveBeenCalled();
    const updatedYaml = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as string;
    expect(updatedYaml).toContain('annotations:');
    expect(updatedYaml).toContain('annotation-key');
  });

  it('shows parse error message for invalid YAML', async () => {
    await renderForm('invalid: yaml: :', vi.fn());
    expect(container.textContent).toContain('YAML has syntax errors');
  });
});
