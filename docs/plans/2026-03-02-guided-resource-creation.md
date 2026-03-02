# Guided Resource Creation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a guided form-based creation mode to the existing CreateResourceModal, with bidirectional sync between form fields and the YAML editor via a tabbed toggle.

**Architecture:** YAML (`yamlContent`) is the single source of truth. A declarative form definition per resource type describes which YAML paths map to which form fields. A generic `ResourceForm` renderer reads these definitions and renders form inputs. Form changes update the YAML via the `yaml` library's AST (`parseDocument`/`setIn`/`toString`), preserving comments and formatting. The existing `tab-strip`/`tab-item` CSS classes provide the tab UI.

**Tech Stack:** React + TypeScript, `yaml` npm package (AST manipulation), existing `tab-strip` CSS, Vitest

**Design doc:** `docs/plans/2026-03-02-guided-resource-creation-design.md`

---

## Task 1: YAML Sync Helpers

**Files:**
- Create: `frontend/src/ui/modals/create-resource/yamlSync.ts`

**Step 1: Write the failing test**

Create `frontend/src/ui/modals/create-resource/yamlSync.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { getFieldValue, setFieldValue } from './yamlSync';

describe('yamlSync', () => {
  const sampleYaml = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
  namespace: default
  labels:
    app: my-app
spec:
  # Number of replicas
  replicas: 3
  selector:
    matchLabels:
      app: my-app
  template:
    metadata:
      labels:
        app: my-app
    spec:
      containers:
      - name: my-app
        image: nginx:latest
        ports:
        - containerPort: 80
`;

  describe('getFieldValue', () => {
    it('reads a scalar value from a YAML path', () => {
      expect(getFieldValue(sampleYaml, ['metadata', 'name'])).toBe('my-app');
    });

    it('reads a numeric value from a YAML path', () => {
      expect(getFieldValue(sampleYaml, ['spec', 'replicas'])).toBe(3);
    });

    it('reads a nested map as a plain object', () => {
      const labels = getFieldValue(sampleYaml, ['metadata', 'labels']);
      expect(labels).toEqual({ app: 'my-app' });
    });

    it('reads a list as a plain array', () => {
      const containers = getFieldValue(sampleYaml, ['spec', 'template', 'spec', 'containers']);
      expect(Array.isArray(containers)).toBe(true);
      expect(containers[0].name).toBe('my-app');
    });

    it('returns undefined for non-existent paths', () => {
      expect(getFieldValue(sampleYaml, ['spec', 'nonexistent'])).toBeUndefined();
    });

    it('returns undefined for invalid YAML', () => {
      expect(getFieldValue('invalid: yaml: :', ['spec'])).toBeUndefined();
    });
  });

  describe('setFieldValue', () => {
    it('updates a scalar value at a YAML path', () => {
      const result = setFieldValue(sampleYaml, ['metadata', 'name'], 'new-name');
      expect(result).not.toBeNull();
      expect(getFieldValue(result!, ['metadata', 'name'])).toBe('new-name');
    });

    it('updates a numeric value at a YAML path', () => {
      const result = setFieldValue(sampleYaml, ['spec', 'replicas'], 5);
      expect(result).not.toBeNull();
      expect(getFieldValue(result!, ['spec', 'replicas'])).toBe(5);
    });

    it('preserves comments in untouched nodes', () => {
      const result = setFieldValue(sampleYaml, ['metadata', 'name'], 'changed');
      expect(result).not.toBeNull();
      // The replicas comment should still be present.
      expect(result).toContain('# Number of replicas');
    });

    it('preserves fields not referenced by the set operation', () => {
      const result = setFieldValue(sampleYaml, ['metadata', 'name'], 'changed');
      expect(result).not.toBeNull();
      // Kind, apiVersion, spec should all be preserved.
      expect(getFieldValue(result!, ['kind'])).toBe('Deployment');
      expect(getFieldValue(result!, ['spec', 'replicas'])).toBe(3);
    });

    it('updates a nested map value', () => {
      const result = setFieldValue(sampleYaml, ['metadata', 'labels'], { app: 'new-app', tier: 'frontend' });
      expect(result).not.toBeNull();
      expect(getFieldValue(result!, ['metadata', 'labels'])).toEqual({ app: 'new-app', tier: 'frontend' });
    });

    it('updates a list value', () => {
      const newContainers = [
        { name: 'container-a', image: 'alpine:latest' },
        { name: 'container-b', image: 'busybox:latest' },
      ];
      const result = setFieldValue(sampleYaml, ['spec', 'template', 'spec', 'containers'], newContainers);
      expect(result).not.toBeNull();
      const containers = getFieldValue(result!, ['spec', 'template', 'spec', 'containers']);
      expect(containers).toHaveLength(2);
      expect(containers[0].name).toBe('container-a');
      expect(containers[1].name).toBe('container-b');
    });

    it('creates intermediate nodes for paths that do not exist yet', () => {
      const minimalYaml = `apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: test\n`;
      const result = setFieldValue(minimalYaml, ['data', 'MY_KEY'], 'MY_VALUE');
      expect(result).not.toBeNull();
      expect(getFieldValue(result!, ['data', 'MY_KEY'])).toBe('MY_VALUE');
    });

    it('returns null for unparseable YAML', () => {
      const result = setFieldValue('invalid: yaml: :', ['metadata', 'name'], 'test');
      expect(result).toBeNull();
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run --reporter=verbose src/ui/modals/create-resource/yamlSync.test.ts`
Expected: Compilation error — `yamlSync.ts` does not exist.

**Step 3: Write the implementation**

Create `frontend/src/ui/modals/create-resource/yamlSync.ts`:

```typescript
/**
 * frontend/src/ui/modals/create-resource/yamlSync.ts
 *
 * Bidirectional sync helpers between YAML content and form field values.
 * YAML is the source of truth — the form reads via getFieldValue and
 * writes via setFieldValue, which preserves comments and formatting
 * for untouched nodes.
 */

import * as YAML from 'yaml';

/**
 * Read a value from a YAML string at the given path.
 * Returns the JS-native value (string, number, object, array) or undefined
 * if the path does not exist or the YAML is unparseable.
 */
export function getFieldValue(yamlContent: string, path: string[]): unknown {
  try {
    const doc = YAML.parseDocument(yamlContent);
    if (doc.errors.length > 0) return undefined;
    const value = doc.getIn(path);
    // Convert YAML nodes to plain JS values.
    if (value === undefined || value === null) return undefined;
    if (YAML.isNode(value)) return (value as YAML.Node).toJSON();
    return value;
  } catch {
    return undefined;
  }
}

/**
 * Set a value in a YAML string at the given path and return the updated
 * YAML string. Preserves comments and formatting for untouched nodes.
 * Returns null if the YAML is unparseable.
 */
export function setFieldValue(
  yamlContent: string,
  path: string[],
  value: unknown
): string | null {
  try {
    const doc = YAML.parseDocument(yamlContent);
    if (doc.errors.length > 0) return null;
    doc.setIn(path, value);
    return doc.toString();
  } catch {
    return null;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run --reporter=verbose src/ui/modals/create-resource/yamlSync.test.ts`
Expected: All PASS

**Step 5: Commit**

```
feat: add YAML sync helpers for guided resource creation
```

---

## Task 2: Form Definition Types and Definitions

**Files:**
- Create: `frontend/src/ui/modals/create-resource/formDefinitions.ts`

**Step 1: Write the failing test**

Create `frontend/src/ui/modals/create-resource/formDefinitions.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { getFormDefinition, allFormDefinitions, type ResourceFormDefinition } from './formDefinitions';

describe('formDefinitions', () => {
  it('returns a definition for each supported kind', () => {
    const supportedKinds = ['Deployment', 'Service', 'ConfigMap', 'Secret', 'Job', 'CronJob', 'Ingress'];
    for (const kind of supportedKinds) {
      const def = getFormDefinition(kind);
      expect(def, `missing form definition for ${kind}`).toBeDefined();
      expect(def!.kind).toBe(kind);
    }
  });

  it('returns undefined for unsupported kinds', () => {
    expect(getFormDefinition('Pod')).toBeUndefined();
    expect(getFormDefinition('DaemonSet')).toBeUndefined();
    expect(getFormDefinition('')).toBeUndefined();
  });

  it('has no duplicate field keys within a definition', () => {
    for (const def of allFormDefinitions) {
      const allKeys = new Set<string>();
      const collectKeys = (fields: ResourceFormDefinition['sections'][0]['fields']) => {
        for (const field of fields) {
          expect(allKeys.has(field.key), `duplicate key "${field.key}" in ${def.kind}`).toBe(false);
          allKeys.add(field.key);
          if (field.fields) {
            // Group-list sub-fields are scoped — only check within their parent.
            const subKeys = new Set<string>();
            for (const sub of field.fields) {
              expect(subKeys.has(sub.key), `duplicate sub-key "${sub.key}" in ${def.kind}/${field.key}`).toBe(false);
              subKeys.add(sub.key);
            }
          }
        }
      };
      for (const section of def.sections) {
        collectKeys(section.fields);
      }
    }
  });

  it('every field has a non-empty path', () => {
    for (const def of allFormDefinitions) {
      for (const section of def.sections) {
        for (const field of section.fields) {
          expect(field.path.length, `empty path for ${def.kind}/${field.key}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('every select field has at least one option', () => {
    for (const def of allFormDefinitions) {
      for (const section of def.sections) {
        for (const field of section.fields) {
          if (field.type === 'select') {
            expect(field.options?.length, `no options for select ${def.kind}/${field.key}`).toBeGreaterThan(0);
          }
        }
      }
    }
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run --reporter=verbose src/ui/modals/create-resource/formDefinitions.test.ts`
Expected: Compilation error — `formDefinitions.ts` does not exist.

**Step 3: Write the implementation**

Create `frontend/src/ui/modals/create-resource/formDefinitions.ts`:

```typescript
/**
 * frontend/src/ui/modals/create-resource/formDefinitions.ts
 *
 * Declarative form definitions for the guided resource creation mode.
 * Each definition describes which YAML paths map to which form fields.
 * The generic ResourceForm renderer uses these definitions to render
 * the appropriate inputs.
 */

// --- Types ---

export interface FormFieldOption {
  label: string;
  value: string;
}

export interface FormFieldDefinition {
  /** Unique field identifier within the definition. */
  key: string;
  /** Display label shown next to the input. */
  label: string;
  /** YAML path to read/write this field's value, e.g. ['spec', 'replicas']. */
  path: string[];
  /** Input type. */
  type: 'text' | 'number' | 'select' | 'textarea' | 'key-value-list' | 'group-list';
  /** Placeholder text for text/number inputs. */
  placeholder?: string;
  /** Options for 'select' type fields. */
  options?: FormFieldOption[];
  /** Sub-field definitions for 'group-list' type fields. */
  fields?: FormFieldDefinition[];
  /** Default value for the field when creating a new list item. */
  defaultValue?: unknown;
}

export interface FormSectionDefinition {
  /** Section heading displayed above the fields. */
  title: string;
  /** Fields in this section. */
  fields: FormFieldDefinition[];
}

export interface ResourceFormDefinition {
  /** Kubernetes kind this form applies to. */
  kind: string;
  /** Sections of the form, rendered top-to-bottom. */
  sections: FormSectionDefinition[];
}

// --- Definitions ---

const deploymentDefinition: ResourceFormDefinition = {
  kind: 'Deployment',
  sections: [
    {
      title: 'Metadata',
      fields: [
        { key: 'name', label: 'Name', path: ['metadata', 'name'], type: 'text', placeholder: 'my-app' },
        { key: 'replicas', label: 'Replicas', path: ['spec', 'replicas'], type: 'number', placeholder: '1' },
        { key: 'labels', label: 'Labels', path: ['metadata', 'labels'], type: 'key-value-list' },
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
          fields: [
            { key: 'name', label: 'Name', path: ['name'], type: 'text', placeholder: 'my-container' },
            { key: 'image', label: 'Image', path: ['image'], type: 'text', placeholder: 'nginx:latest' },
            {
              key: 'ports',
              label: 'Ports',
              path: ['ports'],
              type: 'group-list',
              fields: [
                { key: 'containerPort', label: 'Port', path: ['containerPort'], type: 'number', placeholder: '80' },
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
            {
              key: 'env',
              label: 'Environment Variables',
              path: ['env'],
              type: 'group-list',
              fields: [
                { key: 'name', label: 'Name', path: ['name'], type: 'text', placeholder: 'ENV_VAR' },
                { key: 'value', label: 'Value', path: ['value'], type: 'text', placeholder: 'value' },
              ],
              defaultValue: { name: '', value: '' },
            },
          ],
          defaultValue: { name: '', image: '', ports: [], env: [] },
        },
      ],
    },
  ],
};

const serviceDefinition: ResourceFormDefinition = {
  kind: 'Service',
  sections: [
    {
      title: 'Metadata',
      fields: [
        { key: 'name', label: 'Name', path: ['metadata', 'name'], type: 'text', placeholder: 'my-service' },
      ],
    },
    {
      title: 'Spec',
      fields: [
        {
          key: 'type',
          label: 'Type',
          path: ['spec', 'type'],
          type: 'select',
          options: [
            { label: 'ClusterIP', value: 'ClusterIP' },
            { label: 'NodePort', value: 'NodePort' },
            { label: 'LoadBalancer', value: 'LoadBalancer' },
          ],
        },
        { key: 'selector', label: 'Selector', path: ['spec', 'selector'], type: 'key-value-list' },
        {
          key: 'ports',
          label: 'Ports',
          path: ['spec', 'ports'],
          type: 'group-list',
          fields: [
            { key: 'port', label: 'Port', path: ['port'], type: 'number', placeholder: '80' },
            { key: 'targetPort', label: 'Target Port', path: ['targetPort'], type: 'number', placeholder: '80' },
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
          defaultValue: { port: 80, targetPort: 80, protocol: 'TCP' },
        },
      ],
    },
  ],
};

const configMapDefinition: ResourceFormDefinition = {
  kind: 'ConfigMap',
  sections: [
    {
      title: 'Metadata',
      fields: [
        { key: 'name', label: 'Name', path: ['metadata', 'name'], type: 'text', placeholder: 'my-config' },
      ],
    },
    {
      title: 'Data',
      fields: [
        { key: 'data', label: 'Data', path: ['data'], type: 'key-value-list' },
      ],
    },
  ],
};

const secretDefinition: ResourceFormDefinition = {
  kind: 'Secret',
  sections: [
    {
      title: 'Metadata',
      fields: [
        { key: 'name', label: 'Name', path: ['metadata', 'name'], type: 'text', placeholder: 'my-secret' },
        {
          key: 'type',
          label: 'Type',
          path: ['type'],
          type: 'select',
          options: [
            { label: 'Opaque', value: 'Opaque' },
            { label: 'kubernetes.io/tls', value: 'kubernetes.io/tls' },
            { label: 'kubernetes.io/dockerconfigjson', value: 'kubernetes.io/dockerconfigjson' },
            { label: 'kubernetes.io/basic-auth', value: 'kubernetes.io/basic-auth' },
          ],
        },
      ],
    },
    {
      title: 'Data',
      fields: [
        { key: 'stringData', label: 'String Data', path: ['stringData'], type: 'key-value-list' },
      ],
    },
  ],
};

const jobDefinition: ResourceFormDefinition = {
  kind: 'Job',
  sections: [
    {
      title: 'Metadata',
      fields: [
        { key: 'name', label: 'Name', path: ['metadata', 'name'], type: 'text', placeholder: 'my-job' },
        { key: 'backoffLimit', label: 'Backoff Limit', path: ['spec', 'backoffLimit'], type: 'number', placeholder: '3' },
        {
          key: 'restartPolicy',
          label: 'Restart Policy',
          path: ['spec', 'template', 'spec', 'restartPolicy'],
          type: 'select',
          options: [
            { label: 'Never', value: 'Never' },
            { label: 'OnFailure', value: 'OnFailure' },
          ],
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
          fields: [
            { key: 'name', label: 'Name', path: ['name'], type: 'text', placeholder: 'worker' },
            { key: 'image', label: 'Image', path: ['image'], type: 'text', placeholder: 'busybox:latest' },
            { key: 'command', label: 'Command', path: ['command'], type: 'text', placeholder: 'echo,Hello' },
          ],
          defaultValue: { name: '', image: '', command: [] },
        },
      ],
    },
  ],
};

const cronJobDefinition: ResourceFormDefinition = {
  kind: 'CronJob',
  sections: [
    {
      title: 'Metadata',
      fields: [
        { key: 'name', label: 'Name', path: ['metadata', 'name'], type: 'text', placeholder: 'my-cronjob' },
        { key: 'schedule', label: 'Schedule', path: ['spec', 'schedule'], type: 'text', placeholder: '0 * * * *' },
        { key: 'backoffLimit', label: 'Backoff Limit', path: ['spec', 'jobTemplate', 'spec', 'backoffLimit'], type: 'number', placeholder: '3' },
        {
          key: 'restartPolicy',
          label: 'Restart Policy',
          path: ['spec', 'jobTemplate', 'spec', 'template', 'spec', 'restartPolicy'],
          type: 'select',
          options: [
            { label: 'Never', value: 'Never' },
            { label: 'OnFailure', value: 'OnFailure' },
          ],
        },
      ],
    },
    {
      title: 'Containers',
      fields: [
        {
          key: 'containers',
          label: 'Containers',
          path: ['spec', 'jobTemplate', 'spec', 'template', 'spec', 'containers'],
          type: 'group-list',
          fields: [
            { key: 'name', label: 'Name', path: ['name'], type: 'text', placeholder: 'worker' },
            { key: 'image', label: 'Image', path: ['image'], type: 'text', placeholder: 'busybox:latest' },
            { key: 'command', label: 'Command', path: ['command'], type: 'text', placeholder: 'echo,Hello' },
          ],
          defaultValue: { name: '', image: '', command: [] },
        },
      ],
    },
  ],
};

const ingressDefinition: ResourceFormDefinition = {
  kind: 'Ingress',
  sections: [
    {
      title: 'Metadata',
      fields: [
        { key: 'name', label: 'Name', path: ['metadata', 'name'], type: 'text', placeholder: 'my-ingress' },
        { key: 'ingressClassName', label: 'Ingress Class', path: ['spec', 'ingressClassName'], type: 'text', placeholder: 'nginx' },
      ],
    },
    {
      title: 'Rules',
      fields: [
        {
          key: 'rules',
          label: 'Rules',
          path: ['spec', 'rules'],
          type: 'group-list',
          fields: [
            { key: 'host', label: 'Host', path: ['host'], type: 'text', placeholder: 'my-app.example.com' },
            {
              key: 'paths',
              label: 'Paths',
              path: ['http', 'paths'],
              type: 'group-list',
              fields: [
                { key: 'path', label: 'Path', path: ['path'], type: 'text', placeholder: '/' },
                {
                  key: 'pathType',
                  label: 'Path Type',
                  path: ['pathType'],
                  type: 'select',
                  options: [
                    { label: 'Prefix', value: 'Prefix' },
                    { label: 'Exact', value: 'Exact' },
                    { label: 'ImplementationSpecific', value: 'ImplementationSpecific' },
                  ],
                },
                { key: 'serviceName', label: 'Service', path: ['backend', 'service', 'name'], type: 'text', placeholder: 'my-service' },
                { key: 'servicePort', label: 'Port', path: ['backend', 'service', 'port', 'number'], type: 'number', placeholder: '80' },
              ],
              defaultValue: { path: '/', pathType: 'Prefix', backend: { service: { name: '', port: { number: 80 } } } },
            },
          ],
          defaultValue: { host: '', http: { paths: [] } },
        },
      ],
    },
  ],
};

// --- Registry ---

export const allFormDefinitions: ResourceFormDefinition[] = [
  deploymentDefinition,
  serviceDefinition,
  configMapDefinition,
  secretDefinition,
  jobDefinition,
  cronJobDefinition,
  ingressDefinition,
];

const definitionsByKind = new Map<string, ResourceFormDefinition>(
  allFormDefinitions.map((d) => [d.kind, d])
);

/**
 * Look up a form definition by Kubernetes kind.
 * Returns undefined if no handcrafted form exists for this kind.
 */
export function getFormDefinition(kind: string): ResourceFormDefinition | undefined {
  return definitionsByKind.get(kind);
}
```

**Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run --reporter=verbose src/ui/modals/create-resource/formDefinitions.test.ts`
Expected: All PASS

**Step 5: Commit**

```
feat: add declarative form definitions for 7 resource types
```

---

## Task 3: ResourceForm Renderer Component

**Files:**
- Create: `frontend/src/ui/modals/create-resource/ResourceForm.tsx`
- Create: `frontend/src/ui/modals/create-resource/ResourceForm.css`

**Step 1: Write the failing test**

Create `frontend/src/ui/modals/create-resource/ResourceForm.test.tsx`:

```typescript
import React, { act } from 'react';
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
    // Should render two key-value rows for KEY_A and KEY_B.
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
```

**Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run --reporter=verbose src/ui/modals/create-resource/ResourceForm.test.tsx`
Expected: Compilation error — `ResourceForm.tsx` does not exist.

**Step 3: Write the component**

Create `frontend/src/ui/modals/create-resource/ResourceForm.tsx`. This is the generic form renderer. It reads values from YAML via `getFieldValue` and writes changes via `setFieldValue`. The component handles all 6 field types: text, number, select, textarea, key-value-list, group-list.

The component should:
- Accept props: `definition: ResourceFormDefinition`, `yamlContent: string`, `onYamlChange: (yaml: string) => void`
- Parse the YAML once per render to extract all field values
- If YAML has parse errors, show an inline message and make fields read-only
- For each section, render a heading and its fields
- For `text`/`number` inputs: `<input>` with `data-field-key` attribute and `onChange` that calls `setFieldValue` then `onYamlChange`
- For `select`: `<select>` with `data-field-key` attribute
- For `textarea`: `<textarea>` with `data-field-key`
- For `key-value-list`: render rows of key/value `<input>` pairs with Add/Remove buttons; on change, build a plain object from all rows and call `setFieldValue` with the object
- For `group-list`: render each array item as a bordered card containing its sub-fields; Add/Remove item buttons; on change, rebuild the array and call `setFieldValue`
- Export as a named export: `export function ResourceForm(...)`

**Step 4: Write the CSS**

Create `frontend/src/ui/modals/create-resource/ResourceForm.css`:

- `.resource-form` — flex column with gap, overflow-y auto, padding
- `.resource-form-section` — section container with bottom border
- `.resource-form-section-title` — section heading styled like `.create-resource-dropdown-label` (uppercase, secondary color, small)
- `.resource-form-field` — flex column with small gap for label + input
- `.resource-form-label` — field label styling
- `.resource-form-input` — text/number inputs using theme variables
- `.resource-form-select` — select styling
- `.resource-form-kv-row` — flex row for key-value pair with gap
- `.resource-form-group-item` — bordered card for each group-list item
- `.resource-form-add-btn` / `.resource-form-remove-btn` — small action buttons
- `.resource-form-parse-error` — error message matching `.create-resource-parse-error` style
- All colors via CSS variables (`--color-bg`, `--color-text`, `--color-border`, `--color-error`, etc.)

**Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run --reporter=verbose src/ui/modals/create-resource/ResourceForm.test.tsx`
Expected: All PASS

**Step 6: Commit**

```
feat: add generic ResourceForm renderer component
```

---

## Task 4: Integrate Tab Toggle into CreateResourceModal

**Files:**
- Modify: `frontend/src/ui/modals/CreateResourceModal.tsx`
- Modify: `frontend/src/ui/modals/CreateResourceModal.css`

**Step 1: Write the failing test**

Add these tests to `frontend/src/ui/modals/CreateResourceModal.test.tsx`:

```typescript
it('shows tab strip when a supported template is selected', async () => {
  const { container, unmount } = await renderModal({ isOpen: true, onClose: vi.fn() });
  await flushPromises();

  // Select the Deployment template.
  const templateSelect = container.querySelector('[data-testid="dropdown-Resource template"]') as HTMLSelectElement;
  await act(async () => {
    templateSelect.value = 'Deployment';
    templateSelect.dispatchEvent(new Event('change', { bubbles: true }));
  });

  const tabStrip = container.querySelector('.tab-strip');
  expect(tabStrip).not.toBeNull();
  expect(tabStrip?.textContent).toContain('Form');
  expect(tabStrip?.textContent).toContain('YAML');
  await unmount();
});

it('does not show tab strip when Blank template is selected', async () => {
  const { container, unmount } = await renderModal({ isOpen: true, onClose: vi.fn() });
  await flushPromises();

  // Default is Blank — no tab strip expected.
  const tabStrip = container.querySelector('.tab-strip');
  expect(tabStrip).toBeNull();
  await unmount();
});

it('defaults to Form tab when a supported template is selected', async () => {
  const { container, unmount } = await renderModal({ isOpen: true, onClose: vi.fn() });
  await flushPromises();

  const templateSelect = container.querySelector('[data-testid="dropdown-Resource template"]') as HTMLSelectElement;
  await act(async () => {
    templateSelect.value = 'Deployment';
    templateSelect.dispatchEvent(new Event('change', { bubbles: true }));
  });

  // Form tab should be active.
  const activeTab = container.querySelector('.tab-item--active');
  expect(activeTab?.textContent).toBe('Form');
  // YAML editor should NOT be visible.
  expect(container.querySelector('[data-testid="yaml-editor"]')).toBeNull();
  await unmount();
});

it('switches to YAML tab when clicked', async () => {
  const { container, unmount } = await renderModal({ isOpen: true, onClose: vi.fn() });
  await flushPromises();

  // Select Deployment to show tabs.
  const templateSelect = container.querySelector('[data-testid="dropdown-Resource template"]') as HTMLSelectElement;
  await act(async () => {
    templateSelect.value = 'Deployment';
    templateSelect.dispatchEvent(new Event('change', { bubbles: true }));
  });

  // Click the YAML tab.
  const yamlTab = Array.from(container.querySelectorAll('.tab-item')).find(
    (el) => el.textContent === 'YAML'
  ) as HTMLButtonElement;
  await act(async () => { yamlTab.click(); });

  // YAML editor should now be visible.
  expect(container.querySelector('[data-testid="yaml-editor"]')).not.toBeNull();
  // Active tab should be YAML.
  const activeTab = container.querySelector('.tab-item--active');
  expect(activeTab?.textContent).toBe('YAML');
  await unmount();
});

it('form changes are reflected in YAML when switching tabs', async () => {
  const { container, unmount } = await renderModal({ isOpen: true, onClose: vi.fn() });
  await flushPromises();

  // Select Deployment.
  const templateSelect = container.querySelector('[data-testid="dropdown-Resource template"]') as HTMLSelectElement;
  await act(async () => {
    templateSelect.value = 'Deployment';
    templateSelect.dispatchEvent(new Event('change', { bubbles: true }));
  });

  // Change the name field in the form.
  const nameInput = container.querySelector('input[data-field-key="name"]') as HTMLInputElement;
  if (nameInput) {
    await act(async () => {
      nameInput.value = 'changed-name';
      nameInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  // Switch to YAML tab.
  const yamlTab = Array.from(container.querySelectorAll('.tab-item')).find(
    (el) => el.textContent === 'YAML'
  ) as HTMLButtonElement;
  await act(async () => { yamlTab.click(); });

  // YAML should contain the changed name.
  const editor = container.querySelector('[data-testid="yaml-editor"]') as HTMLTextAreaElement;
  expect(editor.value).toContain('name: changed-name');
  await unmount();
});
```

**Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run --reporter=verbose src/ui/modals/CreateResourceModal.test.tsx`
Expected: New tests fail — no `.tab-strip` rendered, no Form tab behavior.

**Step 3: Implement the tab integration**

Modify `frontend/src/ui/modals/CreateResourceModal.tsx`:

1. Add imports at the top:
   ```typescript
   import { getFormDefinition } from './create-resource/formDefinitions';
   import { ResourceForm } from './create-resource/ResourceForm';
   ```

2. Add tab state after the existing `parsedKind` useMemo:
   ```typescript
   // Active tab: 'form' or 'yaml'. Defaults based on whether a form definition exists.
   const [activeTab, setActiveTab] = useState<'form' | 'yaml'>('yaml');

   // Look up form definition for the current kind.
   const formDefinition = useMemo(
     () => (parsedKind ? getFormDefinition(parsedKind) : undefined),
     [parsedKind]
   );

   // Whether to show the tab strip.
   const showTabs = !!formDefinition;
   ```

3. When a template is selected (`handleTemplateChange`), after setting `yamlContent`, set the active tab:
   ```typescript
   // After setYamlContent(templateYaml):
   const def = getFormDefinition(template?.kind ?? '');
   setActiveTab(def ? 'form' : 'yaml');
   ```

4. In the state reset block (inside the `useEffect` for `isOpen`), reset the tab:
   ```typescript
   setActiveTab('yaml');
   ```

5. In the JSX, between the context bar and the editor, add the tab strip (conditionally rendered):
   ```tsx
   {showTabs && (
     <div className="tab-strip create-resource-tab-strip">
       <button
         className={`tab-item${activeTab === 'form' ? ' tab-item--active' : ''}`}
         onClick={() => setActiveTab('form')}
         type="button"
         data-create-resource-focusable="true"
       >
         Form
       </button>
       <button
         className={`tab-item${activeTab === 'yaml' ? ' tab-item--active' : ''}`}
         onClick={() => setActiveTab('yaml')}
         type="button"
         data-create-resource-focusable="true"
       >
         YAML
       </button>
     </div>
   )}
   ```

6. Conditionally render either the form or the CodeMirror editor:
   ```tsx
   {showTabs && activeTab === 'form' && formDefinition ? (
     <div className="create-resource-editor">
       <ResourceForm
         definition={formDefinition}
         yamlContent={yamlContent}
         onYamlChange={handleYamlChange}
       />
     </div>
   ) : (
     <div className="create-resource-editor">
       <CodeMirror ... /> {/* existing CodeMirror block */}
     </div>
   )}
   ```
   Note: when `showTabs` is false (Blank/unsupported kind), always show CodeMirror.

**Step 4: Add CSS**

Add to `CreateResourceModal.css`:

```css
/* Tab strip within the create resource modal */
.create-resource-tab-strip {
  flex-shrink: 0;
}
```

**Step 5: Run tests to verify they pass**

Run: `cd frontend && npx vitest run --reporter=verbose src/ui/modals/CreateResourceModal.test.tsx`
Expected: All PASS (both old and new tests)

**Step 6: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

**Step 7: Commit**

```
feat: integrate form/YAML tab toggle into CreateResourceModal
```

---

## Task 5: Full Test Suite and Edge Cases

**Files:**
- Modify: `frontend/src/ui/modals/create-resource/yamlSync.test.ts`
- Modify: `frontend/src/ui/modals/create-resource/ResourceForm.test.tsx`
- Modify: `frontend/src/ui/modals/CreateResourceModal.test.tsx`

**Step 1: Add edge case tests to yamlSync**

Add to `yamlSync.test.ts`:

```typescript
describe('round-trip preservation', () => {
  it('preserves unrelated fields through a set operation', () => {
    const yaml = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: test
  annotations:
    custom: value
spec:
  replicas: 1
  strategy:
    type: RollingUpdate
`;
    const result = setFieldValue(yaml, ['spec', 'replicas'], 5);
    expect(result).not.toBeNull();
    // Annotations and strategy should survive untouched.
    expect(getFieldValue(result!, ['metadata', 'annotations', 'custom'])).toBe('value');
    expect(getFieldValue(result!, ['spec', 'strategy', 'type'])).toBe('RollingUpdate');
  });
});
```

**Step 2: Add tab-related edge case tests to CreateResourceModal**

Add to `CreateResourceModal.test.tsx`:

```typescript
it('hides tab strip when kind is changed to unsupported in YAML', async () => {
  const { container, unmount } = await renderModal({ isOpen: true, onClose: vi.fn() });
  await flushPromises();

  // Select Deployment to show tabs.
  const templateSelect = container.querySelector('[data-testid="dropdown-Resource template"]') as HTMLSelectElement;
  await act(async () => {
    templateSelect.value = 'Deployment';
    templateSelect.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(container.querySelector('.tab-strip')).not.toBeNull();

  // Switch to YAML and change kind to unsupported.
  const yamlTab = Array.from(container.querySelectorAll('.tab-item')).find(
    (el) => el.textContent === 'YAML'
  ) as HTMLButtonElement;
  await act(async () => { yamlTab.click(); });

  const editor = container.querySelector('[data-testid="yaml-editor"]') as HTMLTextAreaElement;
  await act(async () => {
    editor.value = 'apiVersion: v1\nkind: Pod\nmetadata:\n  name: test\n';
    editor.dispatchEvent(new Event('change', { bubbles: true }));
  });

  // Tab strip should disappear for unsupported kind.
  expect(container.querySelector('.tab-strip')).toBeNull();
  await unmount();
});
```

**Step 3: Run all tests**

Run: `cd frontend && npx vitest run --reporter=verbose src/ui/modals/`
Expected: All PASS

**Step 4: Commit**

```
test: add edge case tests for form/YAML sync and tab behavior
```

---

## Task 6: Full Verification

**Step 1: Run all frontend tests**

Run: `cd frontend && npx vitest run`
Expected: All PASS

**Step 2: Run TypeScript check**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

**Step 3: Run all backend tests**

Run: `cd backend && go test ./... -v`
Expected: All PASS (no backend changes, but verify nothing broke)

**Step 4: Run linting**

Run whatever lint commands the project uses (check `package.json` scripts).

**Step 5: Commit (if any lint fixes needed)**

```
chore: lint fixes for guided resource creation
```
