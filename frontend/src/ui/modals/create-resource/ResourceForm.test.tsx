import { act, useState } from 'react';
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
        {
          key: 'labels',
          label: 'Labels',
          path: ['metadata', 'labels'],
          type: 'key-value-list',
          addLabel: 'Add Label',
          addGhostText: 'Add label',
          inlineLabels: true,
          leftAlignEmptyActions: true,
          blankNewKeys: true,
        },
        {
          key: 'annotations',
          label: 'Annotations',
          path: ['metadata', 'annotations'],
          type: 'key-value-list',
          addLabel: 'Add Annotation',
          addGhostText: 'Add annotation',
          inlineLabels: true,
          leftAlignEmptyActions: true,
          blankNewKeys: true,
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

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
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

  it('shows Key/Value labels for labels and annotations rows', async () => {
    const yamlWithMetadataEntries = `apiVersion: v1
kind: TestKind
metadata:
  name: test-app
  labels:
    app: demo
  annotations:
    owner: team
spec:
  replicas: 3
  type: ClusterIP
  items:
  - name: first
data:
  KEY_A: value-a
`;
    await renderForm(yamlWithMetadataEntries, vi.fn());
    const labelsField = container.querySelector('[data-field-key="labels"]') as HTMLElement;
    const annotationsField = container.querySelector(
      '[data-field-key="annotations"]'
    ) as HTMLElement;

    expect(labelsField.textContent).toContain('Key');
    expect(labelsField.textContent).toContain('Value');
    expect(annotationsField.textContent).toContain('Key');
    expect(annotationsField.textContent).toContain('Value');
  });

  it('left-aligns empty add actions for labels, annotations, ports, env vars, and volume mounts', async () => {
    const { ResourceForm } = await import('./ResourceForm');
    const deploymentLikeDefinition: ResourceFormDefinition = {
      kind: 'Deployment',
      sections: [
        {
          title: 'Metadata',
          fields: [
            {
              key: 'labels',
              label: 'Labels',
              path: ['metadata', 'labels'],
              type: 'key-value-list',
              addLabel: 'Add Label',
              addGhostText: 'Add label',
              inlineLabels: true,
              leftAlignEmptyActions: true,
              blankNewKeys: true,
            },
            {
              key: 'annotations',
              label: 'Annotations',
              path: ['metadata', 'annotations'],
              type: 'key-value-list',
              addLabel: 'Add Annotation',
              addGhostText: 'Add annotation',
              inlineLabels: true,
              leftAlignEmptyActions: true,
              blankNewKeys: true,
            },
          ],
        },
        {
          title: 'Containers',
          fields: [
            {
              key: 'containers',
              label: 'Containers',
              path: ['spec', 'template', 'spec', 'containers'],
              type: 'group-list',
              itemTitleField: 'name',
              itemTitleFallback: 'Container',
              fields: [
                { key: 'name', label: 'Name', path: ['name'], type: 'text' },
                {
                  key: 'ports',
                  label: 'Ports',
                  path: ['ports'],
                  type: 'group-list',
                  leftAlignEmptyActions: true,
                  addGhostText: 'Add port',
                  fields: [
                    {
                      key: 'containerPort',
                      label: 'Port',
                      path: ['containerPort'],
                      type: 'number',
                    },
                  ],
                  defaultValue: { containerPort: 80 },
                },
                {
                  key: 'env',
                  label: 'Env Vars',
                  path: ['env'],
                  type: 'group-list',
                  leftAlignEmptyActions: true,
                  addGhostText: 'Add env var',
                  fields: [
                    { key: 'name', label: 'Name', path: ['name'], type: 'text' },
                    { key: 'value', label: 'Value', path: ['value'], type: 'text' },
                  ],
                  defaultValue: { name: '', value: '' },
                },
                {
                  key: 'volumeMounts',
                  label: 'Volume Mounts',
                  path: ['volumeMounts'],
                  type: 'group-list',
                  leftAlignEmptyActions: true,
                  addGhostText: 'Add volume mount',
                  fields: [
                    { key: 'name', label: 'Name', path: ['name'], type: 'text' },
                    { key: 'mountPath', label: 'Path', path: ['mountPath'], type: 'text' },
                    { key: 'readOnly', label: 'Read Only', path: ['readOnly'], type: 'text' },
                    { key: 'subPath', label: 'Sub Path', path: ['subPath'], type: 'text' },
                  ],
                  defaultValue: { name: '', mountPath: '' },
                },
              ],
              defaultValue: { name: '', ports: [], env: [], volumeMounts: [] },
            },
          ],
        },
      ],
    };
    const deploymentLikeYaml = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: test-app
spec:
  template:
    spec:
      containers:
        - name: api
          ports: []
          env: []
          volumeMounts: []
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

    expect(
      container.querySelector('[data-field-key="labels"] .resource-form-kv-empty-spacer')
    ).toBeNull();
    expect(
      container.querySelector('[data-field-key="annotations"] .resource-form-kv-empty-spacer')
    ).toBeNull();
    expect(
      container.querySelector('[data-field-key="labels"] .resource-form-actions-inline--left')
    ).not.toBeNull();
    expect(
      container.querySelector('[data-field-key="annotations"] .resource-form-actions-inline--left')
    ).not.toBeNull();
    expect(
      container.querySelector('[data-field-key="labels"] .resource-form-action-ghost-text')
        ?.textContent
    ).toBe('Add label');
    expect(
      container.querySelector('[data-field-key="annotations"] .resource-form-action-ghost-text')
        ?.textContent
    ).toBe('Add annotation');

    expect(
      container.querySelector('[data-field-key="ports"] .resource-form-nested-group-fields')
    ).toBeNull();
    expect(
      container.querySelector('[data-field-key="env"] .resource-form-nested-group-fields')
    ).toBeNull();
    expect(
      container.querySelector('[data-field-key="volumeMounts"] .resource-form-nested-group-fields')
    ).toBeNull();
    expect(
      container.querySelector(
        '[data-field-key="ports"] .resource-form-nested-group-row-actions--left'
      )
    ).not.toBeNull();
    expect(
      container.querySelector('[data-field-key="ports"] .resource-form-action-ghost-text')
        ?.textContent
    ).toBe('Add port');
    expect(
      container.querySelector(
        '[data-field-key="env"] .resource-form-nested-group-row-actions--left'
      )
    ).not.toBeNull();
    expect(
      container.querySelector('[data-field-key="env"] .resource-form-action-ghost-text')
        ?.textContent
    ).toBe('Add env var');
    expect(
      container.querySelector(
        '[data-field-key="volumeMounts"] .resource-form-nested-group-row-actions--left'
      )
    ).not.toBeNull();
    expect(
      container.querySelector('[data-field-key="volumeMounts"] .resource-form-action-ghost-text')
        ?.textContent
    ).toBe('Add a Volume below to enable Volume Mounts');
    const addVolumeMountsButton = container.querySelector(
      'button[aria-label="Add Volume Mounts"]'
    ) as HTMLButtonElement;
    expect(addVolumeMountsButton.disabled).toBe(true);
  });

  it('keeps deployment selectors separate from labels and prevents removing the last selector', async () => {
    const { ResourceForm } = await import('./ResourceForm');
    const deploymentDefinition: ResourceFormDefinition = {
      kind: 'Deployment',
      sections: [
        {
          title: 'Metadata',
          fields: [
            { key: 'replicas', label: 'Replicas', path: ['spec', 'replicas'], type: 'number' },
            {
              key: 'selectors',
              label: 'Selectors',
              path: ['spec', 'selector', 'matchLabels'],
              type: 'selector-list',
              mirrorPaths: [
                ['metadata', 'labels'],
                ['spec', 'template', 'metadata', 'labels'],
              ],
            },
            {
              key: 'labels',
              label: 'Labels',
              path: ['metadata', 'labels'],
              type: 'key-value-list',
              excludedKeysSourcePath: ['spec', 'selector', 'matchLabels'],
            },
          ],
        },
      ],
    };

    const yaml = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: test
  labels:
    app.kubernetes.io/name: app
    team: platform
spec:
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: app
  template:
    metadata:
      labels:
        app.kubernetes.io/name: app
`;

    await act(async () => {
      root.render(
        <ResourceForm definition={deploymentDefinition} yamlContent={yaml} onYamlChange={vi.fn()} />
      );
    });

    const selectorInputs = container.querySelectorAll(
      '[data-field-key="selectors"] .resource-form-kv-row input'
    );
    expect(selectorInputs.length).toBe(2);
    expect((selectorInputs[0] as HTMLInputElement).value).toBe('app.kubernetes.io/name');
    expect((selectorInputs[1] as HTMLInputElement).value).toBe('app');

    const labelInputs = container.querySelectorAll(
      '[data-field-key="labels"] .resource-form-kv-row input'
    );
    expect(labelInputs.length).toBe(2);
    expect((labelInputs[0] as HTMLInputElement).value).toBe('team');
    expect((labelInputs[1] as HTMLInputElement).value).toBe('platform');

    const selectorRemoveButton = container.querySelector(
      '[data-field-key="selectors"] button.resource-form-remove-btn'
    ) as HTMLButtonElement;
    expect(selectorRemoveButton.className).toContain('resource-form-icon-btn--hidden');
    expect(selectorRemoveButton.disabled).toBe(true);
  });

  it('syncs selector edits to metadata, selector.matchLabels, and pod template labels', async () => {
    const { ResourceForm } = await import('./ResourceForm');
    const onChange = vi.fn();
    const deploymentDefinition: ResourceFormDefinition = {
      kind: 'Deployment',
      sections: [
        {
          title: 'Metadata',
          fields: [
            {
              key: 'selectors',
              label: 'Selectors',
              path: ['spec', 'selector', 'matchLabels'],
              type: 'selector-list',
              mirrorPaths: [
                ['metadata', 'labels'],
                ['spec', 'template', 'metadata', 'labels'],
              ],
            },
          ],
        },
      ],
    };

    const yaml = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: test
  labels:
    app.kubernetes.io/name:
spec:
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name:
  template:
    metadata:
      labels:
        app.kubernetes.io/name:
`;

    await act(async () => {
      root.render(
        <ResourceForm
          definition={deploymentDefinition}
          yamlContent={yaml}
          onYamlChange={onChange}
        />
      );
    });

    const selectorInputs = container.querySelectorAll(
      '[data-field-key="selectors"] .resource-form-kv-row input'
    );
    const selectorValueInput = selectorInputs[1] as HTMLInputElement;
    expect(selectorValueInput).toBeDefined();
    await act(async () => {
      setNativeInputValue(selectorValueInput, 'api');
      selectorValueInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalled();
    const updatedYaml = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as string;
    const parsed = YAML.parse(updatedYaml) as {
      metadata?: { labels?: Record<string, string> };
      spec?: {
        selector?: { matchLabels?: Record<string, string> };
        template?: { metadata?: { labels?: Record<string, string> } };
      };
    };

    expect(parsed.metadata?.labels?.['app.kubernetes.io/name']).toBe('api');
    expect(parsed.spec?.selector?.matchLabels?.['app.kubernetes.io/name']).toBe('api');
    expect(parsed.spec?.template?.metadata?.labels?.['app.kubernetes.io/name']).toBe('api');
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
              itemTitleField: 'name',
              itemTitleFallback: 'Container',
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

  it('reflects existing ports/env vars/volume mounts from YAML and renders add buttons', async () => {
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
                  key: 'resources',
                  label: 'Resources',
                  path: ['resources'],
                  type: 'container-resources',
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
                {
                  key: 'volumeMounts',
                  label: 'Volume Mounts',
                  path: ['volumeMounts'],
                  type: 'group-list',
                  fields: [
                    { key: 'name', label: 'Name', path: ['name'], type: 'text' },
                    { key: 'mountPath', label: 'Path', path: ['mountPath'], type: 'text' },
                    { key: 'readOnly', label: 'Read Only', path: ['readOnly'], type: 'text' },
                    { key: 'subPath', label: 'Sub Path', path: ['subPath'], type: 'text' },
                  ],
                  defaultValue: { name: '', mountPath: '' },
                },
              ],
              defaultValue: { name: '', ports: [], env: [], volumeMounts: [] },
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
          resources:
            requests:
              cpu: 100m
            limits:
              memory: 256Mi
          env:
            - name: LOG_LEVEL
              value: debug
          volumeMounts:
            - name: data
              mountPath: /var/data
      volumes:
        - name: data
        - name: cache
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
    const mountNameSelect = container.querySelector(
      '[data-field-key="volumeMounts"] [data-field-key="name"] select'
    ) as HTMLSelectElement;
    const mountPathInput = container.querySelector(
      '[data-field-key="volumeMounts"] input[data-field-key="mountPath"]'
    ) as HTMLInputElement;
    const requestValueInput = container.querySelector(
      '[data-field-key="requestsCpu"]'
    ) as HTMLInputElement;
    const limitValueInput = container.querySelector(
      '[data-field-key="limitsMemory"]'
    ) as HTMLInputElement;

    expect(portInput.value).toBe('8080');
    expect(portInput.min).toBe('1');
    expect(portInput.max).toBe('65535');
    expect(portInput.step).toBe('1');
    expect(protocolSelect.value).toBe('TCP');
    expect(requestValueInput.value).toBe('100m');
    expect(limitValueInput.value).toBe('256Mi');
    expect(envNameInput.value).toBe('LOG_LEVEL');
    expect(envValueInput.value).toBe('debug');
    expect(mountNameSelect.value).toBe('data');
    const mountNameOptions = Array.from(mountNameSelect.options).map((option) => option.value);
    expect(mountNameOptions).toEqual(['', 'data', 'cache']);
    expect(mountPathInput.value).toBe('/var/data');
    const addPortsButton = container.querySelector(
      'button[aria-label="Add Ports"]'
    ) as HTMLButtonElement;
    const addEnvVarsButton = container.querySelector(
      'button[aria-label="Add Env Vars"]'
    ) as HTMLButtonElement;
    const addVolumeMountsButton = container.querySelector(
      'button[aria-label="Add Volume Mounts"]'
    ) as HTMLButtonElement;
    expect(addPortsButton).not.toBeNull();
    expect(addPortsButton.querySelector('svg')).not.toBeNull();
    expect(addEnvVarsButton).not.toBeNull();
    expect(addEnvVarsButton.querySelector('svg')).not.toBeNull();
    expect(addVolumeMountsButton).not.toBeNull();
    expect(addVolumeMountsButton.querySelector('svg')).not.toBeNull();
    expect(addVolumeMountsButton.disabled).toBe(false);
  });

  it('supports volume mount readOnly and subPath/subPathExpr toggle behavior', async () => {
    const emittedYamls: string[] = [];
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
                  key: 'volumeMounts',
                  label: 'Volume Mounts',
                  path: ['volumeMounts'],
                  type: 'group-list',
                  fields: [
                    { key: 'name', label: 'Name', path: ['name'], type: 'text' },
                    { key: 'mountPath', label: 'Path', path: ['mountPath'], type: 'text' },
                    { key: 'readOnly', label: 'Read Only', path: ['readOnly'], type: 'text' },
                    { key: 'subPath', label: 'Sub Path', path: ['subPath'], type: 'text' },
                  ],
                  defaultValue: { name: '', mountPath: '' },
                },
              ],
              defaultValue: { name: '', volumeMounts: [] },
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
          volumeMounts:
            - name: data
              mountPath: /var/data
      volumes:
        - name: data
`;

    const Harness = () => {
      const [yaml, setYaml] = useState(deploymentLikeYaml);
      return (
        <ResourceForm
          definition={deploymentLikeDefinition}
          yamlContent={yaml}
          onYamlChange={(nextYaml) => {
            emittedYamls.push(nextYaml);
            setYaml(nextYaml);
          }}
        />
      );
    };

    await act(async () => {
      root.render(<Harness />);
    });

    const readOnlySelector = '[data-field-key="volumeMounts"] input[data-field-key="readOnly"]';
    const subPathSelector = '[data-field-key="volumeMounts"] input[data-field-key="subPath"]';
    const subPathExprToggleSelector =
      '[data-field-key="volumeMounts"] input[data-field-key="subPathExprToggle"]';
    expect((container.querySelector(readOnlySelector) as HTMLInputElement).checked).toBe(false);
    expect((container.querySelector(subPathExprToggleSelector) as HTMLInputElement).checked).toBe(
      false
    );

    await act(async () => {
      const readOnlyCheckbox = container.querySelector(readOnlySelector) as HTMLInputElement;
      readOnlyCheckbox.click();
    });
    await act(async () => {
      const subPathInput = container.querySelector(subPathSelector) as HTMLInputElement;
      setNativeInputValue(subPathInput, 'logs');
      subPathInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      const subPathExprToggle = container.querySelector(
        subPathExprToggleSelector
      ) as HTMLInputElement;
      subPathExprToggle.click();
    });

    const yamlWithExpr = emittedYamls[emittedYamls.length - 1] as string;
    const parsedWithExpr = YAML.parse(yamlWithExpr) as {
      spec?: {
        template?: {
          spec?: {
            containers?: Array<{
              volumeMounts?: Array<{
                readOnly?: boolean;
                subPath?: string;
                subPathExpr?: string;
              }>;
            }>;
          };
        };
      };
    };
    const mountWithExpr = parsedWithExpr.spec?.template?.spec?.containers?.[0]?.volumeMounts?.[0];
    expect(mountWithExpr?.readOnly).toBe(true);
    expect(mountWithExpr?.subPath).toBeUndefined();
    expect(mountWithExpr?.subPathExpr).toBe('logs');

    await act(async () => {
      const subPathExprToggle = container.querySelector(
        subPathExprToggleSelector
      ) as HTMLInputElement;
      subPathExprToggle.click();
    });

    const yamlWithSubPath = emittedYamls[emittedYamls.length - 1] as string;
    const parsedWithSubPath = YAML.parse(yamlWithSubPath) as {
      spec?: {
        template?: {
          spec?: {
            containers?: Array<{
              volumeMounts?: Array<{
                readOnly?: boolean;
                subPath?: string;
                subPathExpr?: string;
              }>;
            }>;
          };
        };
      };
    };
    const mountWithSubPath =
      parsedWithSubPath.spec?.template?.spec?.containers?.[0]?.volumeMounts?.[0];
    expect(mountWithSubPath?.readOnly).toBe(true);
    expect(mountWithSubPath?.subPath).toBe('logs');
    expect(mountWithSubPath?.subPathExpr).toBeUndefined();

    await act(async () => {
      const readOnlyCheckbox = container.querySelector(readOnlySelector) as HTMLInputElement;
      const subPathInput = container.querySelector(subPathSelector) as HTMLInputElement;
      readOnlyCheckbox.click();
      setNativeInputValue(subPathInput, '');
      subPathInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const yamlWithoutOptionalValues = emittedYamls[emittedYamls.length - 1] as string;
    const parsedWithoutOptionalValues = YAML.parse(yamlWithoutOptionalValues) as {
      spec?: {
        template?: {
          spec?: {
            containers?: Array<{
              volumeMounts?: Array<{
                readOnly?: boolean;
                subPath?: string;
                subPathExpr?: string;
              }>;
            }>;
          };
        };
      };
    };
    const mountWithoutOptionalValues =
      parsedWithoutOptionalValues.spec?.template?.spec?.containers?.[0]?.volumeMounts?.[0];
    expect(mountWithoutOptionalValues?.readOnly).toBeUndefined();
    expect(mountWithoutOptionalValues?.subPath).toBeUndefined();
    expect(mountWithoutOptionalValues?.subPathExpr).toBeUndefined();
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
                      includeEmptyOption: false,
                      implicitDefault: 'TCP',
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

  it('adds new ports/env vars/volume mounts rows from nested add buttons', async () => {
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
                {
                  key: 'volumeMounts',
                  label: 'Volume Mounts',
                  path: ['volumeMounts'],
                  type: 'group-list',
                  fields: [
                    { key: 'name', label: 'Name', path: ['name'], type: 'text' },
                    { key: 'mountPath', label: 'Path', path: ['mountPath'], type: 'text' },
                    { key: 'readOnly', label: 'Read Only', path: ['readOnly'], type: 'text' },
                    { key: 'subPath', label: 'Sub Path', path: ['subPath'], type: 'text' },
                  ],
                  defaultValue: { name: '', mountPath: '' },
                },
              ],
              defaultValue: { name: '', ports: [], env: [], volumeMounts: [] },
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
          volumeMounts: []
      volumes:
        - name: data
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
    const addVolumeMounts = container.querySelector(
      'button[aria-label="Add Volume Mounts"]'
    ) as HTMLButtonElement | null;
    expect(addPorts).not.toBeNull();
    expect(addEnvVars).not.toBeNull();
    expect(addVolumeMounts).not.toBeNull();

    await act(async () => {
      addPorts?.click();
      addEnvVars?.click();
      addVolumeMounts?.click();
    });

    expect(onChange).toHaveBeenCalled();
    const emittedYamls = onChange.mock.calls.map((call) => call[0] as string);
    expect(emittedYamls.some((yaml) => yaml.includes('containerPort: 80'))).toBe(true);
    expect(emittedYamls.some((yaml) => yaml.includes('protocol: TCP'))).toBe(true);
    expect(emittedYamls.some((yaml) => yaml.includes('env:'))).toBe(true);
    expect(emittedYamls.some((yaml) => yaml.includes('volumeMounts:'))).toBe(true);
  });

  it('uses a single volume source dropdown/value pair and keeps sources mutually exclusive', async () => {
    const onChange = vi.fn();
    const emittedYamls: string[] = [];
    const { ResourceForm } = await import('./ResourceForm');
    const deploymentLikeDefinition: ResourceFormDefinition = {
      kind: 'Deployment',
      sections: [
        {
          title: 'Volumes',
          fields: [
            {
              key: 'volumes',
              label: 'Volumes',
              path: ['spec', 'template', 'spec', 'volumes'],
              type: 'group-list',
              fields: [
                { key: 'name', label: 'Name', path: ['name'], type: 'text' },
                { key: 'source', label: 'Source', path: ['source'], type: 'volume-source' },
              ],
              defaultValue: {},
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
      volumes:
        - name: data
          configMap:
            name: app-config
`;

    const Harness = () => {
      const [yaml, setYaml] = useState(deploymentLikeYaml);
      return (
        <ResourceForm
          definition={deploymentLikeDefinition}
          yamlContent={yaml}
          onYamlChange={(nextYaml) => {
            emittedYamls.push(nextYaml);
            setYaml(nextYaml);
            onChange(nextYaml);
          }}
        />
      );
    };

    await act(async () => {
      root.render(<Harness />);
    });

    const sourceSelect = container.querySelector(
      '[data-testid="dropdown-Source"]'
    ) as HTMLSelectElement;
    const configMapNameInput = container.querySelector(
      '[data-field-key="configMapName"] input'
    ) as HTMLInputElement;

    expect(sourceSelect.value).toBe('configMap');
    expect(configMapNameInput.value).toBe('app-config');

    await act(async () => {
      sourceSelect.value = 'secret';
      sourceSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const secretNameInput = container.querySelector(
      '[data-field-key="secretName"] input'
    ) as HTMLInputElement;

    await act(async () => {
      setNativeInputValue(secretNameInput, 'app-secret');
      secretNameInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const updatedYaml = emittedYamls[emittedYamls.length - 1] as string;
    const parsed = YAML.parse(updatedYaml) as {
      spec?: {
        template?: {
          spec?: {
            volumes?: Array<{
              configMap?: { name?: string };
              secret?: { secretName?: string };
            }>;
          };
        };
      };
    };

    const firstVolume = parsed.spec?.template?.spec?.volumes?.[0];
    expect(firstVolume?.configMap).toBeUndefined();
    expect(firstVolume?.secret?.secretName).toBe('app-secret');
  });

  it('shows source options in alpha order and defaults to ConfigMap', async () => {
    const emittedYamls: string[] = [];
    const { ResourceForm } = await import('./ResourceForm');
    const deploymentLikeDefinition: ResourceFormDefinition = {
      kind: 'Deployment',
      sections: [
        {
          title: 'Volumes',
          fields: [
            {
              key: 'volumes',
              label: 'Volumes',
              path: ['spec', 'template', 'spec', 'volumes'],
              type: 'group-list',
              fields: [
                { key: 'name', label: 'Name', path: ['name'], type: 'text' },
                { key: 'source', label: 'Source', path: ['source'], type: 'volume-source' },
              ],
              defaultValue: {},
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
      volumes:
        - name: data
`;

    const Harness = () => {
      const [yaml, setYaml] = useState(deploymentLikeYaml);
      return (
        <ResourceForm
          definition={deploymentLikeDefinition}
          yamlContent={yaml}
          onYamlChange={(nextYaml) => {
            emittedYamls.push(nextYaml);
            setYaml(nextYaml);
          }}
        />
      );
    };

    await act(async () => {
      root.render(<Harness />);
    });

    const sourceSelect = container.querySelector(
      '[data-testid="dropdown-Source"]'
    ) as HTMLSelectElement;
    expect(sourceSelect.value).toBe('configMap');
    const optionLabels = Array.from(sourceSelect.options).map((option) => option.textContent);
    expect(optionLabels).toEqual(['ConfigMap', 'EmptyDir', 'Host Path', 'PVC', 'Secret']);
    expect(optionLabels).not.toContain('-- Select --');

    const configMapNameInput = container.querySelector(
      '[data-field-key="configMapName"] input'
    ) as HTMLInputElement;

    await act(async () => {
      setNativeInputValue(configMapNameInput, 'app-config');
      configMapNameInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const updatedYaml = emittedYamls[emittedYamls.length - 1] as string;
    const parsed = YAML.parse(updatedYaml) as {
      spec?: {
        template?: {
          spec?: {
            volumes?: Array<{ configMap?: { name?: string } }>;
          };
        };
      };
    };
    expect(parsed.spec?.template?.spec?.volumes?.[0]?.configMap?.name).toBe('app-config');
  });

  it('changes source-specific fields when Source selection changes', async () => {
    const emittedYamls: string[] = [];
    const { ResourceForm } = await import('./ResourceForm');
    const deploymentLikeDefinition: ResourceFormDefinition = {
      kind: 'Deployment',
      sections: [
        {
          title: 'Volumes',
          fields: [
            {
              key: 'volumes',
              label: 'Volumes',
              path: ['spec', 'template', 'spec', 'volumes'],
              type: 'group-list',
              fields: [
                { key: 'name', label: 'Name', path: ['name'], type: 'text' },
                { key: 'source', label: 'Source', path: ['source'], type: 'volume-source' },
              ],
              defaultValue: {},
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
      volumes:
        - name: data
`;

    const Harness = () => {
      const [yaml, setYaml] = useState(deploymentLikeYaml);
      return (
        <ResourceForm
          definition={deploymentLikeDefinition}
          yamlContent={yaml}
          onYamlChange={(nextYaml) => {
            emittedYamls.push(nextYaml);
            setYaml(nextYaml);
          }}
        />
      );
    };

    await act(async () => {
      root.render(<Harness />);
    });

    const sourceSelect = container.querySelector(
      '[data-testid="dropdown-Source"]'
    ) as HTMLSelectElement;
    expect(sourceSelect.value).toBe('configMap');
    expect(container.querySelector('[data-testid="dropdown-Optional"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="dropdown-Read Only"]')).toBeNull();

    await act(async () => {
      sourceSelect.value = 'pvc';
      sourceSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(container.querySelector('.resource-form-volume-source > input')).toBeNull();
    const pvcSourceExtras = container.querySelector(
      '.resource-form-volume-source-extra'
    ) as HTMLDivElement;
    const pvcClaimInput = container.querySelector(
      '[data-field-key="claimName"] input'
    ) as HTMLInputElement;
    const readOnlyDropdown = container.querySelector(
      '[data-testid="dropdown-Read Only"]'
    ) as HTMLSelectElement;
    const claimLabel = container.querySelector(
      '[data-field-key="claimName"] .resource-form-field-label'
    ) as HTMLSpanElement;
    expect(pvcSourceExtras).not.toBeNull();
    expect(pvcClaimInput).not.toBeNull();
    expect(pvcClaimInput.required).toBe(true);
    expect(readOnlyDropdown).not.toBeNull();
    expect(claimLabel.textContent).toBe('Claim');
    expect(pvcSourceExtras.contains(pvcClaimInput)).toBe(true);
    expect(pvcSourceExtras.contains(readOnlyDropdown)).toBe(true);
    expect(container.querySelector('[data-testid="dropdown-Optional"]')).toBeNull();

    await act(async () => {
      setNativeInputValue(pvcClaimInput, 'shared-data');
      pvcClaimInput.dispatchEvent(new Event('input', { bubbles: true }));
      readOnlyDropdown.value = 'true';
      readOnlyDropdown.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const updatedYaml = emittedYamls[emittedYamls.length - 1] as string;
    const parsed = YAML.parse(updatedYaml) as {
      spec?: {
        template?: {
          spec?: {
            volumes?: Array<{
              configMap?: { optional?: boolean };
              persistentVolumeClaim?: { claimName?: string; readOnly?: boolean };
            }>;
          };
        };
      };
    };
    const firstVolume = parsed.spec?.template?.spec?.volumes?.[0];
    expect(firstVolume?.configMap).toBeUndefined();
    expect(firstVolume?.persistentVolumeClaim?.claimName).toBe('shared-data');
    expect(firstVolume?.persistentVolumeClaim?.readOnly).toBe(true);
  });

  it('pvc source keeps required claimName when blank and omits readOnly when unset', async () => {
    const emittedYamls: string[] = [];
    const { ResourceForm } = await import('./ResourceForm');
    const deploymentLikeDefinition: ResourceFormDefinition = {
      kind: 'Deployment',
      sections: [
        {
          title: 'Volumes',
          fields: [
            {
              key: 'volumes',
              label: 'Volumes',
              path: ['spec', 'template', 'spec', 'volumes'],
              type: 'group-list',
              fields: [
                { key: 'name', label: 'Name', path: ['name'], type: 'text' },
                { key: 'source', label: 'Source', path: ['source'], type: 'volume-source' },
              ],
              defaultValue: {},
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
      volumes:
        - name: data
`;

    const Harness = () => {
      const [yaml, setYaml] = useState(deploymentLikeYaml);
      return (
        <ResourceForm
          definition={deploymentLikeDefinition}
          yamlContent={yaml}
          onYamlChange={(nextYaml) => {
            emittedYamls.push(nextYaml);
            setYaml(nextYaml);
          }}
        />
      );
    };

    await act(async () => {
      root.render(<Harness />);
    });

    const sourceSelect = container.querySelector(
      '[data-testid="dropdown-Source"]'
    ) as HTMLSelectElement;

    await act(async () => {
      sourceSelect.value = 'pvc';
      sourceSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const claimInput = container.querySelector(
      '[data-field-key="claimName"] input'
    ) as HTMLInputElement;
    const readOnlyDropdown = container.querySelector(
      '[data-testid="dropdown-Read Only"]'
    ) as HTMLSelectElement;
    expect(claimInput.required).toBe(true);

    await act(async () => {
      setNativeInputValue(claimInput, 'shared-data');
      claimInput.dispatchEvent(new Event('input', { bubbles: true }));
      readOnlyDropdown.value = 'true';
      readOnlyDropdown.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await act(async () => {
      setNativeInputValue(claimInput, '');
      claimInput.dispatchEvent(new Event('input', { bubbles: true }));
      readOnlyDropdown.value = '';
      readOnlyDropdown.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const updatedYaml = emittedYamls[emittedYamls.length - 1] as string;
    const parsed = YAML.parse(updatedYaml) as {
      spec?: {
        template?: {
          spec?: {
            volumes?: Array<{
              persistentVolumeClaim?: { claimName?: string; readOnly?: boolean };
            }>;
          };
        };
      };
    };
    const pvc = parsed.spec?.template?.spec?.volumes?.[0]?.persistentVolumeClaim;
    expect(pvc?.claimName).toBe('');
    expect(pvc?.readOnly).toBeUndefined();
  });

  it('switching volume source clears previous source roots and preserves selected source root', async () => {
    const emittedYamls: string[] = [];
    const { ResourceForm } = await import('./ResourceForm');
    const deploymentLikeDefinition: ResourceFormDefinition = {
      kind: 'Deployment',
      sections: [
        {
          title: 'Volumes',
          fields: [
            {
              key: 'volumes',
              label: 'Volumes',
              path: ['spec', 'template', 'spec', 'volumes'],
              type: 'group-list',
              fields: [
                { key: 'name', label: 'Name', path: ['name'], type: 'text' },
                { key: 'source', label: 'Source', path: ['source'], type: 'volume-source' },
              ],
              defaultValue: {},
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
      volumes:
        - name: data
          configMap:
            name: app-config
`;

    const Harness = () => {
      const [yaml, setYaml] = useState(deploymentLikeYaml);
      return (
        <ResourceForm
          definition={deploymentLikeDefinition}
          yamlContent={yaml}
          onYamlChange={(nextYaml) => {
            emittedYamls.push(nextYaml);
            setYaml(nextYaml);
          }}
        />
      );
    };

    await act(async () => {
      root.render(<Harness />);
    });

    const sourceSelect = container.querySelector(
      '[data-testid="dropdown-Source"]'
    ) as HTMLSelectElement;

    await act(async () => {
      sourceSelect.value = 'secret';
      sourceSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const secretNameInput = container.querySelector(
      '[data-field-key="secretName"] input'
    ) as HTMLInputElement;
    await act(async () => {
      setNativeInputValue(secretNameInput, 'app-secret');
      secretNameInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const yamlAfterSecret = emittedYamls[emittedYamls.length - 1] as string;
    const parsedAfterSecret = YAML.parse(yamlAfterSecret) as {
      spec?: {
        template?: {
          spec?: {
            volumes?: Array<{
              configMap?: { name?: string };
              secret?: { secretName?: string };
            }>;
          };
        };
      };
    };
    const volumeAfterSecret = parsedAfterSecret.spec?.template?.spec?.volumes?.[0];
    expect(volumeAfterSecret?.configMap).toBeUndefined();
    expect(volumeAfterSecret?.secret?.secretName).toBe('app-secret');

    await act(async () => {
      sourceSelect.value = 'hostPath';
      sourceSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const yamlAfterHostPath = emittedYamls[emittedYamls.length - 1] as string;
    const parsedAfterHostPath = YAML.parse(yamlAfterHostPath) as {
      spec?: {
        template?: {
          spec?: {
            volumes?: Array<{
              secret?: { secretName?: string };
              hostPath?: { path?: string };
            }>;
          };
        };
      };
    };
    const volumeAfterHostPath = parsedAfterHostPath.spec?.template?.spec?.volumes?.[0];
    expect(volumeAfterHostPath?.secret).toBeUndefined();
    expect(volumeAfterHostPath?.hostPath?.path).toBe('');

    await act(async () => {
      sourceSelect.value = 'pvc';
      sourceSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const yamlAfterPvc = emittedYamls[emittedYamls.length - 1] as string;
    const parsedAfterPvc = YAML.parse(yamlAfterPvc) as {
      spec?: {
        template?: {
          spec?: {
            volumes?: Array<{
              hostPath?: { path?: string };
              persistentVolumeClaim?: { claimName?: string };
            }>;
          };
        };
      };
    };
    const volumeAfterPvc = parsedAfterPvc.spec?.template?.spec?.volumes?.[0];
    expect(volumeAfterPvc?.hostPath).toBeUndefined();
    expect(volumeAfterPvc?.persistentVolumeClaim?.claimName).toBe('');

    await act(async () => {
      sourceSelect.value = 'emptyDir';
      sourceSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const yamlAfterEmptyDir = emittedYamls[emittedYamls.length - 1] as string;
    const parsedAfterEmptyDir = YAML.parse(yamlAfterEmptyDir) as {
      spec?: {
        template?: {
          spec?: {
            volumes?: Array<{
              persistentVolumeClaim?: { claimName?: string };
              emptyDir?: Record<string, unknown>;
            }>;
          };
        };
      };
    };
    const volumeAfterEmptyDir = parsedAfterEmptyDir.spec?.template?.spec?.volumes?.[0];
    expect(volumeAfterEmptyDir?.persistentVolumeClaim).toBeUndefined();
    expect(volumeAfterEmptyDir?.emptyDir).toBeDefined();
    expect(Object.keys(volumeAfterEmptyDir?.emptyDir ?? {})).toHaveLength(0);
  });

  it('configMap source supports optional, default mode, and items fields', async () => {
    const emittedYamls: string[] = [];
    const { ResourceForm } = await import('./ResourceForm');
    const deploymentLikeDefinition: ResourceFormDefinition = {
      kind: 'Deployment',
      sections: [
        {
          title: 'Volumes',
          fields: [
            {
              key: 'volumes',
              label: 'Volumes',
              path: ['spec', 'template', 'spec', 'volumes'],
              type: 'group-list',
              fields: [
                { key: 'name', label: 'Name', path: ['name'], type: 'text' },
                { key: 'source', label: 'Source', path: ['source'], type: 'volume-source' },
              ],
              defaultValue: {},
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
      volumes:
        - name: data
`;

    const Harness = () => {
      const [yaml, setYaml] = useState(deploymentLikeYaml);
      return (
        <ResourceForm
          definition={deploymentLikeDefinition}
          yamlContent={yaml}
          onYamlChange={(nextYaml) => {
            emittedYamls.push(nextYaml);
            setYaml(nextYaml);
          }}
        />
      );
    };

    await act(async () => {
      root.render(<Harness />);
    });

    const configMapNameInput = container.querySelector(
      '[data-field-key="configMapName"] input'
    ) as HTMLInputElement;
    const optionalDropdown = container.querySelector(
      '[data-testid="dropdown-Optional"]'
    ) as HTMLSelectElement;
    const defaultModeInput = container.querySelector(
      'input[data-field-key="defaultMode"]'
    ) as HTMLInputElement;
    const addItemsBtn = container.querySelector(
      'button[aria-label="Add item"]'
    ) as HTMLButtonElement;

    expect(optionalDropdown).not.toBeNull();
    expect(optionalDropdown.value).toBe('');
    const optionalLabels = Array.from(optionalDropdown.options).map((option) => option.textContent);
    expect(optionalLabels).toEqual(['-----', 'true', 'false']);
    expect(optionalLabels).not.toContain('-- Select --');
    expect(defaultModeInput).not.toBeNull();
    expect(addItemsBtn).not.toBeNull();
    expect(container.querySelector('.resource-form-action-ghost-text')?.textContent?.trim()).toBe(
      'Add item'
    );

    await act(async () => {
      setNativeInputValue(configMapNameInput, 'app-config');
      configMapNameInput.dispatchEvent(new Event('input', { bubbles: true }));
      optionalDropdown.value = 'true';
      optionalDropdown.dispatchEvent(new Event('change', { bubbles: true }));
      setNativeInputValue(defaultModeInput, '420');
      defaultModeInput.dispatchEvent(new Event('change', { bubbles: true }));
      addItemsBtn.click();
    });
    expect(container.querySelector('.resource-form-action-ghost-text')).toBeNull();

    const configMapItemInputs = container.querySelectorAll(
      '[data-field-key="configMapItems"] .resource-form-nested-group-field input'
    );
    const itemKeyInput = configMapItemInputs[0] as HTMLInputElement;
    const itemPathInput = configMapItemInputs[1] as HTMLInputElement;
    const itemModeInput = configMapItemInputs[2] as HTMLInputElement;

    await act(async () => {
      setNativeInputValue(itemKeyInput, 'app.properties');
      itemKeyInput.dispatchEvent(new Event('input', { bubbles: true }));
      setNativeInputValue(itemPathInput, 'config/app.properties');
      itemPathInput.dispatchEvent(new Event('input', { bubbles: true }));
      setNativeInputValue(itemModeInput, '384');
      itemModeInput.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const updatedYaml = emittedYamls[emittedYamls.length - 1] as string;
    const parsed = YAML.parse(updatedYaml) as {
      spec?: {
        template?: {
          spec?: {
            volumes?: Array<{
              configMap?: {
                name?: string;
                optional?: boolean;
                defaultMode?: number;
                items?: Array<{ key?: string; path?: string; mode?: number }>;
              };
            }>;
          };
        };
      };
    };
    const configMap = parsed.spec?.template?.spec?.volumes?.[0]?.configMap;
    expect(configMap?.name).toBe('app-config');
    expect(configMap?.optional).toBe(true);
    expect(configMap?.defaultMode).toBe(420);
    expect(configMap?.items?.[0]).toEqual({
      key: 'app.properties',
      path: 'config/app.properties',
      mode: 384,
    });

    await act(async () => {
      optionalDropdown.value = '';
      optionalDropdown.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const yamlWithoutOptional = emittedYamls[emittedYamls.length - 1] as string;
    const parsedWithoutOptional = YAML.parse(yamlWithoutOptional) as {
      spec?: {
        template?: {
          spec?: {
            volumes?: Array<{
              configMap?: {
                optional?: boolean;
              };
            }>;
          };
        };
      };
    };
    expect(
      parsedWithoutOptional.spec?.template?.spec?.volumes?.[0]?.configMap?.optional
    ).toBeUndefined();
  });

  it('secret source supports required name, optional, default mode, and items fields', async () => {
    const emittedYamls: string[] = [];
    const { ResourceForm } = await import('./ResourceForm');
    const deploymentLikeDefinition: ResourceFormDefinition = {
      kind: 'Deployment',
      sections: [
        {
          title: 'Volumes',
          fields: [
            {
              key: 'volumes',
              label: 'Volumes',
              path: ['spec', 'template', 'spec', 'volumes'],
              type: 'group-list',
              fields: [
                { key: 'name', label: 'Name', path: ['name'], type: 'text' },
                { key: 'source', label: 'Source', path: ['source'], type: 'volume-source' },
              ],
              defaultValue: {},
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
      volumes:
        - name: data
`;

    const Harness = () => {
      const [yaml, setYaml] = useState(deploymentLikeYaml);
      return (
        <ResourceForm
          definition={deploymentLikeDefinition}
          yamlContent={yaml}
          onYamlChange={(nextYaml) => {
            emittedYamls.push(nextYaml);
            setYaml(nextYaml);
          }}
        />
      );
    };

    await act(async () => {
      root.render(<Harness />);
    });

    const sourceSelect = container.querySelector(
      '[data-testid="dropdown-Source"]'
    ) as HTMLSelectElement;
    await act(async () => {
      sourceSelect.value = 'secret';
      sourceSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(container.querySelector('.resource-form-volume-source > input')).toBeNull();
    const secretSourceExtras = container.querySelector(
      '.resource-form-volume-source-extra--configmap'
    ) as HTMLDivElement;
    const secretNameInput = container.querySelector(
      '[data-field-key="secretName"] input'
    ) as HTMLInputElement;
    const optionalDropdown = container.querySelector(
      '[data-testid="dropdown-Optional"]'
    ) as HTMLSelectElement;
    const defaultModeInput = container.querySelector(
      'input[data-field-key="defaultMode"]'
    ) as HTMLInputElement;
    const addItemsBtn = container.querySelector(
      'button[aria-label="Add item"]'
    ) as HTMLButtonElement;

    expect(secretNameInput).not.toBeNull();
    expect(secretSourceExtras).not.toBeNull();
    expect(secretSourceExtras.contains(secretNameInput)).toBe(true);
    expect(secretNameInput.required).toBe(true);
    expect(optionalDropdown).not.toBeNull();
    expect(defaultModeInput).not.toBeNull();
    expect(addItemsBtn).not.toBeNull();

    await act(async () => {
      setNativeInputValue(secretNameInput, 'app-secret');
      secretNameInput.dispatchEvent(new Event('input', { bubbles: true }));
      optionalDropdown.value = 'true';
      optionalDropdown.dispatchEvent(new Event('change', { bubbles: true }));
      setNativeInputValue(defaultModeInput, '420');
      defaultModeInput.dispatchEvent(new Event('change', { bubbles: true }));
      addItemsBtn.click();
    });

    const secretItemInputs = container.querySelectorAll(
      '[data-field-key="secretItems"] .resource-form-nested-group-field input'
    );
    const itemKeyInput = secretItemInputs[0] as HTMLInputElement;
    const itemPathInput = secretItemInputs[1] as HTMLInputElement;
    const itemModeInput = secretItemInputs[2] as HTMLInputElement;

    await act(async () => {
      setNativeInputValue(itemKeyInput, 'token');
      itemKeyInput.dispatchEvent(new Event('input', { bubbles: true }));
      setNativeInputValue(itemPathInput, 'secrets/token');
      itemPathInput.dispatchEvent(new Event('input', { bubbles: true }));
      setNativeInputValue(itemModeInput, '384');
      itemModeInput.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const yamlWithValues = emittedYamls[emittedYamls.length - 1] as string;
    const parsedWithValues = YAML.parse(yamlWithValues) as {
      spec?: {
        template?: {
          spec?: {
            volumes?: Array<{
              secret?: {
                secretName?: string;
                optional?: boolean;
                defaultMode?: number;
                items?: Array<{ key?: string; path?: string; mode?: number }>;
              };
            }>;
          };
        };
      };
    };
    const secretWithValues = parsedWithValues.spec?.template?.spec?.volumes?.[0]?.secret;
    expect(secretWithValues?.secretName).toBe('app-secret');
    expect(secretWithValues?.optional).toBe(true);
    expect(secretWithValues?.defaultMode).toBe(420);
    expect(secretWithValues?.items?.[0]).toEqual({
      key: 'token',
      path: 'secrets/token',
      mode: 384,
    });

    const removeItemBtn = container.querySelector(
      'button[aria-label="Remove Items"]'
    ) as HTMLButtonElement;
    await act(async () => {
      optionalDropdown.value = '';
      optionalDropdown.dispatchEvent(new Event('change', { bubbles: true }));
      setNativeInputValue(defaultModeInput, '');
      defaultModeInput.dispatchEvent(new Event('change', { bubbles: true }));
      removeItemBtn.click();
    });

    const yamlWithoutOptionals = emittedYamls[emittedYamls.length - 1] as string;
    const parsedWithoutOptionals = YAML.parse(yamlWithoutOptionals) as {
      spec?: {
        template?: {
          spec?: {
            volumes?: Array<{
              secret?: {
                secretName?: string;
                optional?: boolean;
                defaultMode?: number;
                items?: Array<{ key?: string; path?: string; mode?: number }>;
              };
            }>;
          };
        };
      };
    };
    const secretWithoutOptionals =
      parsedWithoutOptionals.spec?.template?.spec?.volumes?.[0]?.secret;
    expect(secretWithoutOptionals?.secretName).toBe('app-secret');
    expect(secretWithoutOptionals?.optional).toBeUndefined();
    expect(secretWithoutOptionals?.defaultMode).toBeUndefined();
    expect(secretWithoutOptionals?.items).toBeUndefined();
  });

  it('emptyDir source exposes medium and sizeLimit and preserves emptyDir root when blank', async () => {
    const emittedYamls: string[] = [];
    const { ResourceForm } = await import('./ResourceForm');
    const deploymentLikeDefinition: ResourceFormDefinition = {
      kind: 'Deployment',
      sections: [
        {
          title: 'Volumes',
          fields: [
            {
              key: 'volumes',
              label: 'Volumes',
              path: ['spec', 'template', 'spec', 'volumes'],
              type: 'group-list',
              fields: [
                { key: 'name', label: 'Name', path: ['name'], type: 'text' },
                { key: 'source', label: 'Source', path: ['source'], type: 'volume-source' },
              ],
              defaultValue: {},
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
      volumes:
        - name: data
`;

    const Harness = () => {
      const [yaml, setYaml] = useState(deploymentLikeYaml);
      return (
        <ResourceForm
          definition={deploymentLikeDefinition}
          yamlContent={yaml}
          onYamlChange={(nextYaml) => {
            emittedYamls.push(nextYaml);
            setYaml(nextYaml);
          }}
        />
      );
    };

    await act(async () => {
      root.render(<Harness />);
    });

    const sourceSelect = container.querySelector(
      '[data-testid="dropdown-Source"]'
    ) as HTMLSelectElement;

    await act(async () => {
      sourceSelect.value = 'emptyDir';
      sourceSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(container.querySelector('.resource-form-volume-source > input')).toBeNull();

    const mediumDropdown = container.querySelector(
      '[data-testid="dropdown-Medium"]'
    ) as HTMLSelectElement;
    const sizeLimitInput = container.querySelector(
      '[data-field-key="sizeLimit"] input'
    ) as HTMLInputElement;

    expect(mediumDropdown).not.toBeNull();
    expect(sizeLimitInput).not.toBeNull();

    await act(async () => {
      mediumDropdown.value = 'Memory';
      mediumDropdown.dispatchEvent(new Event('change', { bubbles: true }));
      setNativeInputValue(sizeLimitInput, '1Gi');
      sizeLimitInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const yamlWithValues = emittedYamls[emittedYamls.length - 1] as string;
    const parsedWithValues = YAML.parse(yamlWithValues) as {
      spec?: {
        template?: {
          spec?: {
            volumes?: Array<{
              emptyDir?: {
                medium?: string;
                sizeLimit?: string;
              };
            }>;
          };
        };
      };
    };
    const withValuesEmptyDir = parsedWithValues.spec?.template?.spec?.volumes?.[0]?.emptyDir;
    expect(withValuesEmptyDir?.medium).toBe('Memory');
    expect(withValuesEmptyDir?.sizeLimit).toBe('1Gi');

    await act(async () => {
      mediumDropdown.value = '';
      mediumDropdown.dispatchEvent(new Event('change', { bubbles: true }));
      setNativeInputValue(sizeLimitInput, '');
      sizeLimitInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const yamlWithoutValues = emittedYamls[emittedYamls.length - 1] as string;
    const parsedWithoutValues = YAML.parse(yamlWithoutValues) as {
      spec?: {
        template?: {
          spec?: {
            volumes?: Array<{
              emptyDir?: Record<string, unknown>;
            }>;
          };
        };
      };
    };
    const emptyDir = parsedWithoutValues.spec?.template?.spec?.volumes?.[0]?.emptyDir;
    expect(emptyDir).toBeDefined();
    expect(Object.keys(emptyDir ?? {})).toHaveLength(0);
  });

  it('hostPath source renders labeled Path and Type on the same extra row and omits optional type when blank', async () => {
    const emittedYamls: string[] = [];
    const { ResourceForm } = await import('./ResourceForm');
    const deploymentLikeDefinition: ResourceFormDefinition = {
      kind: 'Deployment',
      sections: [
        {
          title: 'Volumes',
          fields: [
            {
              key: 'volumes',
              label: 'Volumes',
              path: ['spec', 'template', 'spec', 'volumes'],
              type: 'group-list',
              fields: [
                { key: 'name', label: 'Name', path: ['name'], type: 'text' },
                { key: 'source', label: 'Source', path: ['source'], type: 'volume-source' },
              ],
              defaultValue: {},
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
      volumes:
        - name: data
`;

    const Harness = () => {
      const [yaml, setYaml] = useState(deploymentLikeYaml);
      return (
        <ResourceForm
          definition={deploymentLikeDefinition}
          yamlContent={yaml}
          onYamlChange={(nextYaml) => {
            emittedYamls.push(nextYaml);
            setYaml(nextYaml);
          }}
        />
      );
    };

    await act(async () => {
      root.render(<Harness />);
    });

    const sourceSelect = container.querySelector(
      '[data-testid="dropdown-Source"]'
    ) as HTMLSelectElement;

    await act(async () => {
      sourceSelect.value = 'hostPath';
      sourceSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(container.querySelector('.resource-form-volume-source > input')).toBeNull();

    const hostPathExtras = container.querySelector(
      '.resource-form-volume-source-extra'
    ) as HTMLDivElement;
    const hostPathInput = container.querySelector(
      '[data-field-key="path"] input'
    ) as HTMLInputElement;
    const hostPathTypeSelect = container.querySelector(
      '[data-testid="dropdown-Type"]'
    ) as HTMLSelectElement;
    const pathLabel = container.querySelector(
      '[data-field-key="path"] .resource-form-field-label'
    ) as HTMLSpanElement;

    expect(hostPathInput).not.toBeNull();
    expect(hostPathExtras).not.toBeNull();
    expect(hostPathInput.required).toBe(true);
    expect(hostPathTypeSelect).not.toBeNull();
    expect(pathLabel.textContent).toBe('Path');
    expect(hostPathExtras.contains(hostPathInput)).toBe(true);
    expect(hostPathExtras.contains(hostPathTypeSelect)).toBe(true);

    const yamlAfterSwitch = emittedYamls[emittedYamls.length - 1] as string;
    const parsedAfterSwitch = YAML.parse(yamlAfterSwitch) as {
      spec?: {
        template?: {
          spec?: {
            volumes?: Array<{ hostPath?: { path?: string } }>;
          };
        };
      };
    };
    expect(parsedAfterSwitch.spec?.template?.spec?.volumes?.[0]?.hostPath?.path).toBe('');

    await act(async () => {
      setNativeInputValue(hostPathInput, '/data');
      hostPathInput.dispatchEvent(new Event('input', { bubbles: true }));
      hostPathTypeSelect.value = 'Directory';
      hostPathTypeSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const yamlWithType = emittedYamls[emittedYamls.length - 1] as string;
    const parsedWithType = YAML.parse(yamlWithType) as {
      spec?: {
        template?: {
          spec?: {
            volumes?: Array<{ hostPath?: { path?: string; type?: string } }>;
          };
        };
      };
    };
    const hostPathWithType = parsedWithType.spec?.template?.spec?.volumes?.[0]?.hostPath;
    expect(hostPathWithType?.path).toBe('/data');
    expect(hostPathWithType?.type).toBe('Directory');

    await act(async () => {
      hostPathTypeSelect.value = '';
      hostPathTypeSelect.dispatchEvent(new Event('change', { bubbles: true }));
      setNativeInputValue(hostPathInput, '');
      hostPathInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const yamlWithoutType = emittedYamls[emittedYamls.length - 1] as string;
    const parsedWithoutType = YAML.parse(yamlWithoutType) as {
      spec?: {
        template?: {
          spec?: {
            volumes?: Array<{ hostPath?: { path?: string; type?: string } }>;
          };
        };
      };
    };
    const hostPathWithoutType = parsedWithoutType.spec?.template?.spec?.volumes?.[0]?.hostPath;
    expect(hostPathWithoutType?.type).toBeUndefined();
    expect(hostPathWithoutType?.path).toBe('');
  });

  it('updates container resource requests through labeled resource inputs', async () => {
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
                  key: 'resources',
                  label: 'Resources',
                  path: ['resources'],
                  type: 'container-resources',
                },
              ],
              defaultValue: { name: '', resources: { requests: {} } },
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
          resources:
            requests:
              cpu: 100m
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

    const requestValueInput = container.querySelector(
      '[data-field-key="requestsCpu"]'
    ) as HTMLInputElement;
    expect(requestValueInput).not.toBeNull();
    expect(requestValueInput.value).toBe('100m');

    await act(async () => {
      setNativeInputValue(requestValueInput, '250m');
      requestValueInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalled();
    const updatedYaml = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as string;
    const parsed = YAML.parse(updatedYaml) as {
      spec?: {
        template?: {
          spec?: { containers?: Array<{ resources?: { requests?: { cpu?: string } } }> };
        };
      };
    };
    const cpuRequest = parsed.spec?.template?.spec?.containers?.[0]?.resources?.requests?.cpu;
    expect(cpuRequest).toBe('250m');

    await act(async () => {
      setNativeInputValue(requestValueInput, '');
      requestValueInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalled();
    const clearedYaml = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as string;
    const cleared = YAML.parse(clearedYaml) as {
      spec?: {
        template?: {
          spec?: { containers?: Array<{ resources?: { requests?: { cpu?: string } } }> };
        };
      };
    };
    const clearedCpuRequest =
      cleared.spec?.template?.spec?.containers?.[0]?.resources?.requests?.cpu;
    expect(clearedCpuRequest).toBeUndefined();
  });

  it('removes container resources via the header-row remove button', async () => {
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
                  key: 'resources',
                  label: 'Resources',
                  path: ['resources'],
                  type: 'container-resources',
                },
              ],
              defaultValue: { name: '', resources: {} },
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
          resources:
            requests:
              cpu: 100m
            limits:
              memory: 256Mi
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

    const removeResourcesBtn = container.querySelector(
      'button[aria-label="Remove Resources"]'
    ) as HTMLButtonElement | null;
    expect(removeResourcesBtn).not.toBeNull();

    await act(async () => {
      removeResourcesBtn?.click();
    });

    expect(onChange).toHaveBeenCalled();
    const updatedYaml = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as string;
    const parsed = YAML.parse(updatedYaml) as {
      spec?: { template?: { spec?: { containers?: Array<{ resources?: unknown }> } } };
    };
    expect(parsed.spec?.template?.spec?.containers?.[0]?.resources).toBeUndefined();
    expect(container.querySelector('[data-field-key="requestsCpu"]')).toBeNull();
    expect(container.querySelector('button[aria-label="Add Resources"]')).not.toBeNull();
    expect(
      container.querySelector('.resource-form-actions-row .resource-form-action-ghost-text')
        ?.textContent
    ).toBe('Add resource requests/limits');
  });

  it('shows a single add icon button for resources and expands to labeled fields', async () => {
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
                  key: 'resources',
                  label: 'Resources',
                  path: ['resources'],
                  type: 'container-resources',
                },
              ],
              defaultValue: { name: '', resources: {} },
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

    const addResourcesBtn = container.querySelector(
      'button[aria-label="Add Resources"]'
    ) as HTMLButtonElement | null;
    expect(addResourcesBtn).toBeDefined();
    expect(addResourcesBtn?.querySelector('svg')).not.toBeNull();
    expect(
      container.querySelector('.resource-form-actions-row .resource-form-action-ghost-text')
        ?.textContent
    ).toBe('Add resource requests/limits');
    expect(container.querySelector('[data-field-key="requestsCpu"]')).toBeNull();

    await act(async () => {
      addResourcesBtn?.click();
    });

    expect(
      container.querySelector('.resource-form-actions-row .resource-form-action-ghost-text')
    ).toBeNull();
    expect(container.querySelector('[data-field-key="requestsCpu"]')).not.toBeNull();
    expect(container.querySelector('[data-field-key="requestsMemory"]')).not.toBeNull();
    expect(container.querySelector('[data-field-key="limitsCpu"]')).not.toBeNull();
    expect(container.querySelector('[data-field-key="limitsMemory"]')).not.toBeNull();
    expect(onChange).not.toHaveBeenCalled();
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

  it('renders icon add buttons with contextual aria labels', async () => {
    await renderForm(sampleYaml, vi.fn());
    const addButtons = Array.from(
      container.querySelectorAll('.resource-form-add-btn')
    ) as HTMLButtonElement[];
    const labels = addButtons.map((button) => button.getAttribute('aria-label') ?? '');

    expect(labels).toContain('Add Label');
    expect(labels).toContain('Add Annotation');
    expect(labels).toContain('Add Entry');
    expect(addButtons.every((button) => button.querySelector('svg') != null)).toBe(true);
  });

  it('adds annotation entries when annotation add icon is clicked', async () => {
    const onChange = vi.fn();
    await renderForm(sampleYaml, onChange);
    const addAnnotationButton = container.querySelector(
      'button[aria-label="Add Annotation"]'
    ) as HTMLButtonElement | null;

    expect(addAnnotationButton).toBeDefined();

    await act(async () => {
      addAnnotationButton?.click();
    });

    expect(onChange).toHaveBeenCalled();
    const annotationRows = container.querySelectorAll(
      '[data-field-key="annotations"] .resource-form-kv-row'
    );
    expect(annotationRows.length).toBe(1);
    const annotationInputs = container.querySelectorAll(
      '[data-field-key="annotations"] .resource-form-kv-row input'
    );
    expect((annotationInputs[0] as HTMLInputElement).value).toBe('');
    expect((annotationInputs[1] as HTMLInputElement).value).toBe('');
  });

  it('keeps first added annotation row visible after parent YAML state sync', async () => {
    const { ResourceForm } = await import('./ResourceForm');
    const StatefulHost = () => {
      const [yaml, setYaml] = useState(sampleYaml);
      return <ResourceForm definition={testDefinition} yamlContent={yaml} onYamlChange={setYaml} />;
    };

    await act(async () => {
      root.render(<StatefulHost />);
    });

    const addAnnotationButton = container.querySelector(
      'button[aria-label="Add Annotation"]'
    ) as HTMLButtonElement | null;
    expect(addAnnotationButton).not.toBeNull();

    await act(async () => {
      addAnnotationButton?.click();
    });

    const annotationRows = container.querySelectorAll(
      '[data-field-key="annotations"] .resource-form-kv-row'
    );
    expect(annotationRows.length).toBe(1);
    const annotationInputs = container.querySelectorAll(
      '[data-field-key="annotations"] .resource-form-kv-row input'
    );
    expect((annotationInputs[0] as HTMLInputElement).value).toBe('');
    expect((annotationInputs[1] as HTMLInputElement).value).toBe('');
  });

  it('keeps annotation row visible when key and value are cleared', async () => {
    const onChange = vi.fn();
    const yamlWithAnnotation = `apiVersion: v1
kind: TestKind
metadata:
  name: test-app
  annotations:
    owner: team
spec:
  replicas: 3
  type: ClusterIP
  items:
  - name: first
`;
    await renderForm(yamlWithAnnotation, onChange);

    const annotationInputs = container.querySelectorAll(
      '[data-field-key="annotations"] .resource-form-kv-row input'
    );
    const annotationKeyInput = annotationInputs[0] as HTMLInputElement;
    const annotationValueInput = annotationInputs[1] as HTMLInputElement;
    expect(annotationKeyInput.value).toBe('owner');
    expect(annotationValueInput.value).toBe('team');

    await act(async () => {
      setNativeInputValue(annotationKeyInput, '');
      annotationKeyInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      setNativeInputValue(annotationValueInput, '');
      annotationValueInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const rowsAfterClear = container.querySelectorAll(
      '[data-field-key="annotations"] .resource-form-kv-row'
    );
    expect(rowsAfterClear.length).toBe(1);
    const inputsAfterClear = container.querySelectorAll(
      '[data-field-key="annotations"] .resource-form-kv-row input'
    );
    expect((inputsAfterClear[0] as HTMLInputElement).value).toBe('');
    expect((inputsAfterClear[1] as HTMLInputElement).value).toBe('');
  });

  it('shows parse error message for invalid YAML', async () => {
    await renderForm('invalid: yaml: :', vi.fn());
    expect(container.textContent).toContain('YAML has syntax errors');
  });
});
