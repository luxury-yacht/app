/**
 * frontend/src/ui/modals/CreateResourceModal.test.tsx
 *
 * Test suite for CreateResourceModal.
 */

import React, { act } from 'react';
import ReactDOM from 'react-dom/client';
import * as YAML from 'yaml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- Hoisted mocks ---

const shortcutContextMock = vi.hoisted(() => ({
  pushContext: vi.fn(),
  popContext: vi.fn(),
}));

const shortcutMock = vi.hoisted(() => ({
  register: [] as Array<any>,
  useKeyboardNavigationScope: vi.fn(),
}));

const kubeconfigMock = vi.hoisted(() => ({
  selectedClusterId: 'config:test-cluster',
  selectedClusterName: 'test-cluster',
  selectedClusterIds: ['config:test-cluster'],
  getClusterMeta: (id: string) => ({
    id,
    name: id === 'config:test-cluster' ? 'test-cluster' : id,
  }),
}));

const namespaceMock = vi.hoisted(() => ({
  selectedNamespace: 'default',
}));

// Namespace domain data returned by useRefreshScopedDomain('namespaces', ...).
const namespaceDomainMock = vi.hoisted(() => ({
  data: {
    namespaces: [
      { name: 'default', clusterId: 'config:test-cluster' },
      { name: 'kube-system', clusterId: 'config:test-cluster' },
      { name: 'other-ns', clusterId: 'config:other-cluster' },
    ],
  },
  status: 'ready' as const,
}));

const objectPanelMock = vi.hoisted(() => ({
  openWithObject: vi.fn(),
}));

const errorContextMock = vi.hoisted(() => ({
  addError: vi.fn(),
}));

const wailsMock = vi.hoisted(() => ({
  GetResourceTemplates: vi.fn().mockResolvedValue([
    {
      name: 'Deployment',
      kind: 'Deployment',
      apiVersion: 'apps/v1',
      category: 'Workloads',
      description: 'A Deployment manages replicated Pods',
      yaml: 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name:\n  namespace: my-namespace\n  labels:\n    app.kubernetes.io/name:\nspec:\n  replicas: 1\n  selector:\n    matchLabels:\n      app.kubernetes.io/name:\n  template:\n    metadata:\n      labels:\n        app.kubernetes.io/name:\n    spec:\n      containers:\n      - name:',
    },
    {
      name: 'Service',
      kind: 'Service',
      apiVersion: 'v1',
      category: 'Networking',
      description: 'A Service exposes a network endpoint',
      yaml: 'apiVersion: v1\nkind: Service\nmetadata:\n  name: my-service\n  namespace: my-namespace',
    },
  ]),
  ValidateResourceCreation: vi.fn().mockResolvedValue({
    name: 'my-app',
    namespace: 'default',
    kind: 'Deployment',
    apiVersion: 'apps/v1',
    resourceVersion: '1',
  }),
  CreateResource: vi.fn().mockResolvedValue({
    name: 'my-app',
    namespace: 'default',
    kind: 'Deployment',
    apiVersion: 'apps/v1',
    resourceVersion: '1',
  }),
  ValidateObjectYaml: vi.fn().mockResolvedValue({
    resourceVersion: '2',
  }),
  ApplyObjectYaml: vi.fn().mockResolvedValue({
    resourceVersion: '3',
  }),
}));

const codeMirrorMock = vi.hoisted(() => ({
  renders: [] as Array<{ extensions?: unknown[] }>,
}));

const lineWrappingExtension = vi.hoisted(() => ({ name: 'lineWrapping' }));

vi.mock('./create-resource/formDefinitions', () => ({
  getFormDefinition: (kind: string) => {
    if (kind === 'Deployment') {
      return {
        kind: 'Deployment',
        sections: [
          {
            title: 'Metadata',
            fields: [
              { key: 'name', label: 'Name', path: ['metadata', 'name'], type: 'text' as const },
              {
                key: 'labels',
                label: 'Labels',
                path: ['metadata', 'labels'],
                type: 'key-value-list' as const,
              },
              {
                key: 'containers',
                label: 'Containers',
                path: ['spec', 'template', 'spec', 'containers'],
                type: 'group-list' as const,
                fields: [
                  {
                    key: 'resources',
                    label: 'Resources',
                    path: ['resources'],
                    type: 'container-resources' as const,
                  },
                ],
              },
            ],
          },
        ],
      };
    }
    return undefined;
  },
}));

vi.mock('./create-resource/ResourceForm', () => ({
  ResourceForm: ({
    yamlContent,
    onYamlChange,
    namespaceOptions = [],
    onNamespaceChange,
  }: {
    yamlContent: string;
    onYamlChange: (v: string) => void;
    definition: unknown;
    namespaceOptions?: Array<{ value: string; label: string }>;
    onNamespaceChange?: (namespace: string) => void;
  }) => {
    // Use a ref-based native event listener so that dispatching a native
    // 'change' event from tests correctly invokes onYamlChange.
    const yamlRef = React.useRef(yamlContent);
    const onChangeRef = React.useRef(onYamlChange);
    yamlRef.current = yamlContent;
    onChangeRef.current = onYamlChange;

    const inputRef = React.useRef<HTMLInputElement | null>(null);

    React.useEffect(() => {
      const el = inputRef.current;
      if (!el) return;
      const handler = (e: Event) => {
        const target = e.target as HTMLInputElement;
        try {
          const doc = YAML.parseDocument(yamlRef.current);
          doc.setIn(['metadata', 'name'], target.value);
          onChangeRef.current(doc.toString());
          return;
        } catch {
          onChangeRef.current(yamlRef.current.replace(/name: [^\n]+/, `name: ${target.value}`));
        }
      };
      el.addEventListener('change', handler);
      return () => el.removeEventListener('change', handler);
    }, []);

    return (
      <div data-testid="resource-form">
        <input
          ref={inputRef}
          data-field-key="name"
          data-testid="form-name-input"
          defaultValue="mock-form"
        />
        <select
          data-testid="dropdown-Form namespace"
          value={(() => {
            try {
              const parsed = YAML.parse(yamlContent) as {
                metadata?: { namespace?: string | null };
              };
              return parsed.metadata?.namespace ?? '';
            } catch {
              return '';
            }
          })()}
          onChange={(event) => {
            const nextNamespace = event.target.value;
            try {
              const doc = YAML.parseDocument(yamlContent);
              doc.setIn(['metadata', 'namespace'], nextNamespace);
              onYamlChange(doc.toString());
            } catch {
              onYamlChange(yamlContent);
            }
            onNamespaceChange?.(nextNamespace);
          }}
        >
          <option value="">Select namespace</option>
          {namespaceOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    );
  },
}));

// --- Module mocks ---

vi.mock('@ui/shortcuts', () => ({
  useShortcut: (config: unknown) => {
    shortcutMock.register.push(config);
    return () => {};
  },
  useKeyboardContext: () => shortcutContextMock,
  useSearchShortcutTarget: () => undefined,
  useKeyboardNavigationScope: (...args: unknown[]) =>
    shortcutMock.useKeyboardNavigationScope(...args),
}));

vi.mock('@shared/components/modals/useModalFocusTrap', () => ({
  useModalFocusTrap: vi.fn(),
}));

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => kubeconfigMock,
}));

vi.mock('@modules/namespace/contexts/NamespaceContext', () => ({
  useNamespace: () => ({ selectedNamespace: namespaceMock.selectedNamespace }),
}));

vi.mock('@modules/namespace/constants', () => ({
  ALL_NAMESPACES_SCOPE: 'namespace:all',
  isAllNamespaces: (v?: string | null) => v === 'namespace:all',
}));

vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => objectPanelMock,
}));

vi.mock('@core/contexts/ErrorContext', () => ({
  useErrorContext: () => errorContextMock,
}));

vi.mock('@utils/errorHandler', () => ({
  ErrorSeverity: { INFO: 'info', WARNING: 'warning', ERROR: 'error', CRITICAL: 'critical' },
  ErrorCategory: { UNKNOWN: 'UNKNOWN', VALIDATION: 'VALIDATION' },
  errorHandler: { handle: vi.fn() },
  subscribeToErrors: vi.fn(() => () => {}),
}));

vi.mock('@/core/refresh', () => ({
  refreshOrchestrator: {
    fetchScopedDomain: vi.fn().mockResolvedValue(undefined),
    triggerManualRefreshForContext: vi.fn().mockResolvedValue(undefined),
  },
  useRefreshScopedDomain: () => namespaceDomainMock,
}));

vi.mock('@/core/refresh/clusterScope', () => ({
  buildClusterScopeList: () => 'clusters=config:test-cluster|',
}));

vi.mock('@/core/codemirror/theme', () => ({
  buildCodeTheme: () => ({
    theme: [],
    highlight: [],
  }),
}));

vi.mock('@/core/codemirror/search', () => ({
  createSearchExtensions: () => [],
}));

vi.mock('@wailsjs/go/backend/App', () => ({
  GetResourceTemplates: wailsMock.GetResourceTemplates,
  ValidateResourceCreation: wailsMock.ValidateResourceCreation,
  CreateResource: wailsMock.CreateResource,
  ValidateObjectYaml: wailsMock.ValidateObjectYaml,
  ApplyObjectYaml: wailsMock.ApplyObjectYaml,
}));

vi.mock('@modules/object-panel/components/ObjectPanel/Yaml/yamlErrors', () => ({
  OBJECT_YAML_ERROR_PREFIX: 'ObjectYAMLError:',
  parseObjectYamlError: (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.startsWith('ObjectYAMLError:')) return null;
    try {
      return JSON.parse(msg.slice('ObjectYAMLError:'.length));
    } catch {
      return null;
    }
  },
}));

// Mock Dropdown as a simple <select> element for testing.
vi.mock('@shared/components/dropdowns/Dropdown', () => ({
  Dropdown: ({
    options,
    value,
    onChange,
    placeholder,
    ariaLabel,
  }: {
    options: Array<{ value: string; label: string; disabled?: boolean }>;
    value: string | string[];
    onChange: (v: string | string[]) => void;
    placeholder?: string;
    ariaLabel?: string;
    [key: string]: unknown;
  }) => (
    <select
      data-testid={`dropdown-${ariaLabel ?? 'unknown'}`}
      value={Array.isArray(value) ? value[0] : value}
      onChange={(e) => onChange(e.target.value)}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options
        .filter((o) => !o.disabled)
        .map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
    </select>
  ),
}));

// Mock CodeMirror to avoid JSDOM limitations.
vi.mock('@uiw/react-codemirror', () => ({
  __esModule: true,
  default: ({
    value,
    onChange,
    extensions,
  }: {
    value: string;
    onChange?: (v: string) => void;
    extensions?: unknown[];
  }) => {
    codeMirrorMock.renders.push({ extensions });
    return (
      <textarea
        data-testid="yaml-editor"
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
      />
    );
  },
}));

vi.mock('@codemirror/lang-yaml', () => ({
  yaml: () => [],
}));

vi.mock('@codemirror/view', () => ({
  EditorView: { lineWrapping: lineWrappingExtension },
}));

// --- Test helpers ---

type CreateResourceModalModule = typeof import('./CreateResourceModal');
type CreateResourceModalComponent = CreateResourceModalModule['default'];
type ModalProps = React.ComponentProps<CreateResourceModalComponent>;
type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

const renderModal = async (props: ModalProps) => {
  const mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  const root = ReactDOM.createRoot(mountNode);
  const { default: CreateResourceModal } = await import('./CreateResourceModal');

  await act(async () => {
    root.render(<CreateResourceModal {...props} />);
  });

  return {
    container: document.body,
    root,
    rerender: async (newProps: ModalProps) => {
      await act(async () => {
        root.render(<CreateResourceModal {...newProps} />);
      });
    },
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      mountNode.remove();
    },
  };
};

// Helper to flush pending promises.
const flushPromises = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

const createDeferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const EDIT_YAML = `
apiVersion: v1
kind: Pod
metadata:
  name: demo
  namespace: default
  resourceVersion: "123"
spec:
  containers:
    - name: demo
      image: demo:v1
`.trim();

// --- Tests ---

describe('CreateResourceModal', () => {
  beforeEach(() => {
    shortcutContextMock.pushContext.mockClear();
    shortcutContextMock.popContext.mockClear();
    shortcutMock.register = [];
    objectPanelMock.openWithObject.mockClear();
    errorContextMock.addError.mockClear();
    wailsMock.GetResourceTemplates.mockClear();
    wailsMock.ValidateResourceCreation.mockClear();
    wailsMock.CreateResource.mockClear();
    wailsMock.ValidateObjectYaml.mockClear();
    wailsMock.ApplyObjectYaml.mockClear();
    codeMirrorMock.renders = [];
    kubeconfigMock.selectedClusterId = 'config:test-cluster';
    kubeconfigMock.selectedClusterName = 'test-cluster';
    kubeconfigMock.selectedClusterIds = ['config:test-cluster'];
    namespaceMock.selectedNamespace = 'default';
    document.body.style.overflow = '';
  });

  afterEach(() => {
    // Clean up rendered DOM nodes between tests.
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
  });

  it('does not render when isOpen is false', async () => {
    const { container, unmount } = await renderModal({ isOpen: false, onClose: vi.fn() });
    expect(container.querySelector('.create-resource-modal')).toBeNull();
    await unmount();
  });

  it('renders modal header and buttons when isOpen is true', async () => {
    const { container, unmount } = await renderModal({ isOpen: true, onClose: vi.fn() });
    await flushPromises();

    expect(container.querySelector('.create-resource-modal')).not.toBeNull();
    expect(container.textContent).toContain('Create Deployment');
    expect(container.textContent).toContain('Validate');
    expect(container.textContent).toContain('Create');
    expect(container.textContent).toContain('Cancel');
    await unmount();
  });

  it('renders edit-mode controls when opened with an edit request', async () => {
    const { container, unmount } = await renderModal({
      isOpen: true,
      onClose: vi.fn(),
      request: {
        mode: 'edit',
        clusterId: 'config:test-cluster',
        initialYaml: EDIT_YAML,
        scope: 'default:pod:demo',
        identity: {
          apiVersion: 'v1',
          kind: 'Pod',
          name: 'demo',
          namespace: 'default',
          resourceVersion: '123',
        },
      },
    });
    await flushPromises();

    expect(container.textContent).toContain('Edit Pod');
    expect(container.textContent).toContain('Save');
    expect(container.textContent).not.toContain('Create');
    expect(container.textContent).toContain('test-cluster');
    expect(container.textContent).toContain('Pod');
    expect(wailsMock.GetResourceTemplates).not.toHaveBeenCalled();

    await unmount();
  });

  it('loads templates on open', async () => {
    const { unmount } = await renderModal({ isOpen: true, onClose: vi.fn() });
    await flushPromises();

    expect(wailsMock.GetResourceTemplates).toHaveBeenCalled();
    await unmount();
  });

  it('defaults to Deployment template on open', async () => {
    const { container, unmount } = await renderModal({ isOpen: true, onClose: vi.fn() });
    await flushPromises();

    const templateSelect = container.querySelector(
      '[data-testid="dropdown-Resource template"]'
    ) as HTMLSelectElement;
    expect(templateSelect.value).toBe('Deployment');
    const toggleBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Show YAML'
    ) as HTMLButtonElement | undefined;
    expect(toggleBtn).toBeDefined();
    expect(toggleBtn?.disabled).toBe(false);
    expect(container.querySelector('[data-testid="resource-form"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="yaml-editor"]')).toBeNull();
    await unmount();
  });

  it('populates editor when template is selected', async () => {
    const { container, unmount } = await renderModal({ isOpen: true, onClose: vi.fn() });
    await flushPromises();

    const select = container.querySelector(
      '[data-testid="dropdown-Resource template"]'
    ) as HTMLSelectElement;
    expect(select).not.toBeNull();

    await act(async () => {
      select.value = 'Deployment';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // Selecting Deployment activates form view; switch to YAML to
    // verify the template content was loaded into the editor.
    const toggleBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Show YAML'
    ) as HTMLButtonElement | undefined;
    expect(toggleBtn).toBeDefined();
    await act(async () => {
      toggleBtn?.click();
    });

    const editor = container.querySelector('[data-testid="yaml-editor"]') as HTMLTextAreaElement;
    expect(editor.value).toContain('kind: Deployment');
    await unmount();
  });

  it('defaults the YAML side panel to unwrapped lines and toggles wrapping on demand', async () => {
    const { container, unmount } = await renderModal({ isOpen: true, onClose: vi.fn() });
    await flushPromises();

    const toggleBtn = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Show YAML'
    ) as HTMLButtonElement | undefined;

    await act(async () => {
      toggleBtn?.click();
    });

    const wrapCheckbox = container.querySelector(
      '.yaml-panel-wrap-toggle input[type="checkbox"]'
    ) as HTMLInputElement;
    const latestExtensions = () =>
      codeMirrorMock.renders[codeMirrorMock.renders.length - 1]?.extensions ?? [];

    expect(wrapCheckbox.checked).toBe(false);
    expect(latestExtensions()).not.toContain(lineWrappingExtension);

    await act(async () => {
      wrapCheckbox.click();
    });

    expect(wrapCheckbox.checked).toBe(true);
    expect(latestExtensions()).toContain(lineWrappingExtension);
    await unmount();
  });

  it('updates header based on selected kind and falls back for Blank', async () => {
    const { container, unmount } = await renderModal({ isOpen: true, onClose: vi.fn() });
    await flushPromises();

    const title = container.querySelector('.modal-header h2');
    expect(title?.textContent).toBe('Create Deployment');

    const templateSelect = container.querySelector(
      '[data-testid="dropdown-Resource template"]'
    ) as HTMLSelectElement;

    await act(async () => {
      templateSelect.value = 'Service';
      templateSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(title?.textContent).toBe('Create Service');

    await act(async () => {
      templateSelect.value = '';
      templateSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(title?.textContent).toBe('Create Resource');
    await unmount();
  });

  it('prepopulates deployment label key and does not prepopulate other deployment editable fields', async () => {
    const { container, unmount } = await renderModal({ isOpen: true, onClose: vi.fn() });
    await flushPromises();

    const toggleBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Show YAML'
    ) as HTMLButtonElement | undefined;
    expect(toggleBtn).toBeDefined();
    await act(async () => {
      toggleBtn?.click();
    });

    const editor = container.querySelector('[data-testid="yaml-editor"]') as HTMLTextAreaElement;
    const parsed = YAML.parse(editor.value) as {
      metadata?: { name?: string | null; labels?: Record<string, unknown> };
      spec?: {
        template?: {
          spec?: {
            containers?: Array<{
              name?: string | null;
              image?: string;
              ports?: unknown[];
              resources?: Record<string, unknown>;
            }>;
          };
        };
      };
    };
    const firstContainer = parsed.spec?.template?.spec?.containers?.[0];

    expect(editor.value).toContain('kind: Deployment');
    expect(parsed.metadata?.name ?? null).toBeNull();
    expect(parsed.metadata?.labels).toBeDefined();
    expect(parsed.metadata?.labels?.['app.kubernetes.io/name'] ?? null).toBeNull();
    expect(firstContainer?.name ?? null).toBeNull();
    expect(firstContainer?.image).toBeUndefined();
    expect(firstContainer?.ports).toBeUndefined();
    expect(firstContainer?.resources).toBeUndefined();
    await unmount();
  });

  it('calls onClose when Cancel is clicked', async () => {
    const onClose = vi.fn();
    const { container, unmount } = await renderModal({ isOpen: true, onClose });
    await flushPromises();

    const cancelBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Cancel'
    );
    expect(cancelBtn).toBeTruthy();

    await act(async () => {
      cancelBtn?.click();
    });

    expect(onClose).toHaveBeenCalled();
    await unmount();
  });

  it('calls ValidateResourceCreation with correct clusterId', async () => {
    const { container, unmount } = await renderModal({ isOpen: true, onClose: vi.fn() });
    await flushPromises();

    const validateBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Validate'
    );

    await act(async () => {
      validateBtn?.click();
    });
    await flushPromises();

    expect(wailsMock.ValidateResourceCreation).toHaveBeenCalledWith(
      'config:test-cluster',
      expect.objectContaining({ yaml: expect.any(String) })
    );
    await unmount();
  });

  it('validates edited YAML through the object YAML endpoint in edit mode', async () => {
    const { container, unmount } = await renderModal({
      isOpen: true,
      onClose: vi.fn(),
      request: {
        mode: 'edit',
        clusterId: 'config:test-cluster',
        initialYaml: EDIT_YAML,
        scope: 'default:pod:demo',
        identity: {
          apiVersion: 'v1',
          kind: 'Pod',
          name: 'demo',
          namespace: 'default',
          resourceVersion: '123',
        },
      },
    });
    await flushPromises();

    const validateBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Validate'
    );

    await act(async () => {
      validateBtn?.click();
    });
    await flushPromises();

    expect(wailsMock.ValidateObjectYaml).toHaveBeenCalledWith(
      'config:test-cluster',
      expect.objectContaining({
        yaml: expect.stringContaining('kind: Pod'),
        kind: 'Pod',
        apiVersion: 'v1',
        namespace: 'default',
        name: 'demo',
        resourceVersion: '123',
      })
    );

    await unmount();
  });

  it('saves edited YAML and refreshes the object YAML domain in edit mode', async () => {
    const onClose = vi.fn();
    const refreshModule = await import('@/core/refresh');
    const { container, unmount } = await renderModal({
      isOpen: true,
      onClose,
      request: {
        mode: 'edit',
        clusterId: 'config:test-cluster',
        initialYaml: EDIT_YAML,
        scope: 'default:pod:demo',
        identity: {
          apiVersion: 'v1',
          kind: 'Pod',
          name: 'demo',
          namespace: 'default',
          resourceVersion: '123',
        },
      },
    });
    await flushPromises();

    const editor = container.querySelector('[data-testid="yaml-editor"]') as HTMLTextAreaElement;
    const setEditorValue = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value'
    )?.set;
    await act(async () => {
      setEditorValue?.call(editor, EDIT_YAML.replace('demo:v1', 'demo:v2'));
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const saveBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Save'
    );
    await act(async () => {
      saveBtn?.click();
    });
    await flushPromises();

    expect(wailsMock.ValidateObjectYaml).toHaveBeenCalled();
    expect(wailsMock.ApplyObjectYaml).toHaveBeenCalledWith(
      'config:test-cluster',
      expect.objectContaining({
        yaml: expect.stringContaining('demo:v2'),
        kind: 'Pod',
        apiVersion: 'v1',
        namespace: 'default',
        name: 'demo',
        resourceVersion: '2',
      })
    );
    expect(refreshModule.refreshOrchestrator.fetchScopedDomain).toHaveBeenCalledWith(
      'object-yaml',
      'default:pod:demo',
      expect.objectContaining({ isManual: true })
    );
    expect(refreshModule.refreshOrchestrator.triggerManualRefreshForContext).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    expect(errorContextMock.addError).toHaveBeenCalledWith(
      expect.objectContaining({
        userMessage: 'Saved Pod/demo in namespace default on cluster test-cluster',
      })
    );

    await unmount();
  });

  it('keeps validate pinned to the original cluster during an in-flight cluster switch', async () => {
    kubeconfigMock.selectedClusterIds = ['config:test-cluster', 'config:other-cluster'];
    kubeconfigMock.getClusterMeta = (id: string) => ({
      id,
      name: id === 'config:test-cluster' ? 'test-cluster' : 'other-cluster',
    });
    const validateDeferred = createDeferred<{
      name: string;
      namespace: string;
      kind: string;
      apiVersion: string;
      resourceVersion: string;
    }>();
    wailsMock.ValidateResourceCreation.mockImplementationOnce(() => validateDeferred.promise);

    const { container, unmount } = await renderModal({ isOpen: true, onClose: vi.fn() });
    await flushPromises();

    const validateBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Validate'
    ) as HTMLButtonElement | undefined;
    const clusterSelect = container.querySelector(
      '[data-testid="dropdown-Target cluster"]'
    ) as HTMLSelectElement;

    await act(async () => {
      validateBtn?.click();
    });
    await flushPromises();

    await act(async () => {
      clusterSelect.value = 'config:other-cluster';
      clusterSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await act(async () => {
      validateDeferred.resolve({
        name: 'my-app',
        namespace: 'default',
        kind: 'Deployment',
        apiVersion: 'apps/v1',
        resourceVersion: '1',
      });
      await validateDeferred.promise;
    });
    await flushPromises();

    expect(wailsMock.ValidateResourceCreation).toHaveBeenCalledTimes(1);
    expect(wailsMock.ValidateResourceCreation).toHaveBeenCalledWith(
      'config:test-cluster',
      expect.objectContaining({ yaml: expect.any(String) })
    );

    await act(async () => {
      validateBtn?.click();
    });
    await flushPromises();

    expect(wailsMock.ValidateResourceCreation).toHaveBeenCalledTimes(2);
    expect(wailsMock.ValidateResourceCreation).toHaveBeenLastCalledWith(
      'config:other-cluster',
      expect.objectContaining({ yaml: expect.any(String) })
    );
    await unmount();
  });

  it('calls CreateResource with correct clusterId', async () => {
    const onClose = vi.fn();
    const { container, unmount } = await renderModal({ isOpen: true, onClose });
    await flushPromises();

    const createBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Create'
    );

    await act(async () => {
      createBtn?.click();
    });
    await flushPromises();

    expect(wailsMock.CreateResource).toHaveBeenCalledWith(
      'config:test-cluster',
      expect.objectContaining({ yaml: expect.any(String) })
    );
    await unmount();
  });

  it('keeps create pinned to the original cluster during an in-flight cluster switch', async () => {
    kubeconfigMock.selectedClusterIds = ['config:test-cluster', 'config:other-cluster'];
    kubeconfigMock.getClusterMeta = (id: string) => ({
      id,
      name: id === 'config:test-cluster' ? 'test-cluster' : 'other-cluster',
    });
    const createCallDeferred = createDeferred<{
      name: string;
      namespace: string;
      kind: string;
      apiVersion: string;
      resourceVersion: string;
    }>();
    wailsMock.CreateResource.mockImplementationOnce(() => createCallDeferred.promise);

    const onClose = vi.fn();
    const { container, unmount } = await renderModal({ isOpen: true, onClose });
    await flushPromises();

    const createBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Create'
    ) as HTMLButtonElement | undefined;
    const clusterSelect = container.querySelector(
      '[data-testid="dropdown-Target cluster"]'
    ) as HTMLSelectElement;

    await act(async () => {
      createBtn?.click();
    });
    await flushPromises();

    await act(async () => {
      clusterSelect.value = 'config:other-cluster';
      clusterSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await act(async () => {
      createCallDeferred.resolve({
        name: 'my-app',
        namespace: 'default',
        kind: 'Deployment',
        apiVersion: 'apps/v1',
        resourceVersion: '1',
      });
      await createCallDeferred.promise;
    });
    await flushPromises();

    expect(wailsMock.CreateResource).toHaveBeenCalledTimes(1);
    expect(wailsMock.CreateResource).toHaveBeenCalledWith(
      'config:test-cluster',
      expect.objectContaining({ yaml: expect.any(String) })
    );
    expect(objectPanelMock.openWithObject).toHaveBeenCalledWith(
      expect.objectContaining({
        clusterId: 'config:test-cluster',
        clusterName: 'test-cluster',
      })
    );
    expect(onClose).toHaveBeenCalled();
    await unmount();
  });

  it('Create button is always enabled (not gated on validation)', async () => {
    const { container, unmount } = await renderModal({ isOpen: true, onClose: vi.fn() });
    await flushPromises();

    const createBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Create'
    ) as HTMLButtonElement;

    // Create should be enabled without having validated first.
    expect(createBtn.disabled).toBe(false);
    await unmount();
  });

  it('shows validation success on dry-run pass', async () => {
    const { container, unmount } = await renderModal({ isOpen: true, onClose: vi.fn() });
    await flushPromises();

    const validateBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Validate'
    );
    await act(async () => {
      validateBtn?.click();
    });
    await flushPromises();

    expect(container.querySelector('.create-resource-validation-success')).not.toBeNull();
    expect(container.textContent).toContain('Validation passed');
    await unmount();
  });

  it('shows structured error with causes on validation failure', async () => {
    wailsMock.ValidateResourceCreation.mockRejectedValueOnce(
      new Error(
        'ObjectYAMLError:{"code":"Invalid","message":"spec.containers required","causes":["spec.containers: Required value"]}'
      )
    );

    const { container, unmount } = await renderModal({ isOpen: true, onClose: vi.fn() });
    await flushPromises();

    const validateBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Validate'
    );
    await act(async () => {
      validateBtn?.click();
    });
    await flushPromises();

    expect(container.querySelector('.create-resource-validation-error')).not.toBeNull();
    expect(container.textContent).toContain('Invalid');
    expect(container.textContent).toContain('spec.containers: Required value');
    await unmount();
  });

  it('shows AlreadyExists error on create failure', async () => {
    wailsMock.CreateResource.mockRejectedValueOnce(
      new Error('ObjectYAMLError:{"code":"AlreadyExists","message":"already exists","causes":[]}')
    );

    const { container, unmount } = await renderModal({ isOpen: true, onClose: vi.fn() });
    await flushPromises();

    const createBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Create'
    );
    await act(async () => {
      createBtn?.click();
    });
    await flushPromises();

    expect(container.querySelector('.create-resource-validation-error')).not.toBeNull();
    expect(container.textContent).toContain('AlreadyExists');
    await unmount();
  });

  it('shows Forbidden error on create failure', async () => {
    wailsMock.CreateResource.mockRejectedValueOnce(
      new Error('ObjectYAMLError:{"code":"Forbidden","message":"forbidden","causes":[]}')
    );

    const { container, unmount } = await renderModal({ isOpen: true, onClose: vi.fn() });
    await flushPromises();

    const createBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Create'
    );
    await act(async () => {
      createBtn?.click();
    });
    await flushPromises();

    expect(container.textContent).toContain('Forbidden');
    await unmount();
  });

  it('opens object panel with explicit clusterId on success', async () => {
    const onClose = vi.fn();
    const { container, unmount } = await renderModal({ isOpen: true, onClose });
    await flushPromises();

    const createBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Create'
    );
    await act(async () => {
      createBtn?.click();
    });
    await flushPromises();

    // Verify openWithObject receives pinned cluster context.
    expect(objectPanelMock.openWithObject).toHaveBeenCalledWith(
      expect.objectContaining({
        clusterId: 'config:test-cluster',
        clusterName: 'test-cluster',
        kind: 'Deployment',
        name: 'my-app',
      })
    );
    await unmount();
  });

  it('calls onClose after successful creation', async () => {
    const onClose = vi.fn();
    const { container, unmount } = await renderModal({ isOpen: true, onClose });
    await flushPromises();

    const createBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Create'
    );
    await act(async () => {
      createBtn?.click();
    });
    await flushPromises();

    expect(onClose).toHaveBeenCalled();
    await unmount();
  });

  it('namespace dropdown shows only namespaces for the target cluster', async () => {
    const { container, unmount } = await renderModal({ isOpen: true, onClose: vi.fn() });
    await flushPromises();

    const nsSelect = container.querySelector(
      '[data-testid="dropdown-Form namespace"]'
    ) as HTMLSelectElement;
    expect(nsSelect).not.toBeNull();

    const options = Array.from(nsSelect.options).map((o) => o.text);
    // Should include namespaces from config:test-cluster.
    expect(options).toContain('default');
    expect(options).toContain('kube-system');
    // Should NOT include namespaces from other clusters.
    expect(options).not.toContain('other-ns');
    await unmount();
  });

  it('re-scopes namespace options and clears namespace selection when target cluster changes', async () => {
    kubeconfigMock.selectedClusterIds = ['config:test-cluster', 'config:other-cluster'];
    kubeconfigMock.getClusterMeta = (id: string) => ({
      id,
      name: id === 'config:test-cluster' ? 'test-cluster' : 'other-cluster',
    });

    const { container, unmount } = await renderModal({ isOpen: true, onClose: vi.fn() });
    await flushPromises();

    const clusterSelect = container.querySelector(
      '[data-testid="dropdown-Target cluster"]'
    ) as HTMLSelectElement;
    const nsSelect = container.querySelector(
      '[data-testid="dropdown-Form namespace"]'
    ) as HTMLSelectElement;
    expect(nsSelect.value).toBe('default');

    await act(async () => {
      clusterSelect.value = 'config:other-cluster';
      clusterSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(nsSelect.value).toBe('');
    const options = Array.from(nsSelect.options).map((o) => o.text);
    expect(options).toContain('other-ns');
    expect(options).not.toContain('kube-system');
    expect(options).not.toContain('default');
    await unmount();
  });

  it('defaults to empty namespace when current selection is All Namespaces', async () => {
    namespaceMock.selectedNamespace = 'namespace:all';

    const { container, unmount } = await renderModal({ isOpen: true, onClose: vi.fn() });
    await flushPromises();

    const nsSelect = container.querySelector(
      '[data-testid="dropdown-Form namespace"]'
    ) as HTMLSelectElement;
    expect(nsSelect.value).toBe('');
    await unmount();
  });

  it('shows no-cluster message when disconnected', async () => {
    kubeconfigMock.selectedClusterId = '';
    kubeconfigMock.selectedClusterName = '';
    kubeconfigMock.selectedClusterIds = [];

    const { container, unmount } = await renderModal({ isOpen: true, onClose: vi.fn() });
    await flushPromises();

    expect(container.textContent).toContain('No cluster connected');
    expect(container.querySelector('[data-testid="yaml-editor"]')).toBeNull();
    await unmount();
  });

  it('renders cluster dropdown in context bar', async () => {
    const { container, unmount } = await renderModal({ isOpen: true, onClose: vi.fn() });
    await flushPromises();

    const clusterDropdown = container.querySelector(
      '[data-testid="dropdown-Target cluster"]'
    ) as HTMLSelectElement;
    expect(clusterDropdown).not.toBeNull();
    // The active cluster should be selected.
    expect(clusterDropdown.value).toBe('config:test-cluster');
    await unmount();
  });

  it('shows view toggle when a supported template is selected', async () => {
    const { container, unmount } = await renderModal({ isOpen: true, onClose: vi.fn() });
    await flushPromises();

    const templateSelect = container.querySelector(
      '[data-testid="dropdown-Resource template"]'
    ) as HTMLSelectElement;
    await act(async () => {
      templateSelect.value = 'Deployment';
      templateSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const toggleBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Show YAML'
    ) as HTMLButtonElement | undefined;
    expect(toggleBtn).toBeDefined();
    expect(toggleBtn?.disabled).toBe(false);
    await unmount();
  });

  it('shows inline YAML editor when Blank template is selected', async () => {
    const { container, unmount } = await renderModal({ isOpen: true, onClose: vi.fn() });
    await flushPromises();

    const templateSelect = container.querySelector(
      '[data-testid="dropdown-Resource template"]'
    ) as HTMLSelectElement;
    await act(async () => {
      templateSelect.value = '';
      templateSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // No form definition for blank → inline YAML editor is shown.
    expect(container.querySelector('[data-testid="yaml-editor"]')).not.toBeNull();
    await unmount();
  });

  it('defaults to Form view when a supported template is selected', async () => {
    const { container, unmount } = await renderModal({ isOpen: true, onClose: vi.fn() });
    await flushPromises();

    const templateSelect = container.querySelector(
      '[data-testid="dropdown-Resource template"]'
    ) as HTMLSelectElement;
    await act(async () => {
      templateSelect.value = 'Deployment';
      templateSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const toggleBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Show YAML'
    ) as HTMLButtonElement | undefined;
    expect(toggleBtn).toBeDefined();
    expect(toggleBtn?.disabled).toBe(false);
    expect(container.querySelector('[data-testid="yaml-editor"]')).toBeNull();
    await unmount();
  });

  it('opens YAML panel when Show YAML is clicked', async () => {
    const { container, unmount } = await renderModal({ isOpen: true, onClose: vi.fn() });
    await flushPromises();

    const toggleBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Show YAML'
    ) as HTMLButtonElement | undefined;
    expect(toggleBtn).toBeDefined();
    await act(async () => {
      toggleBtn?.click();
    });

    // Panel is now open; button text changes to "Hide YAML".
    const hideBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Hide YAML'
    ) as HTMLButtonElement | undefined;
    expect(hideBtn).toBeDefined();
    await unmount();
  });

  it('form changes are reflected in YAML when switching views', async () => {
    const { container, unmount } = await renderModal({ isOpen: true, onClose: vi.fn() });
    await flushPromises();

    const templateSelect = container.querySelector(
      '[data-testid="dropdown-Resource template"]'
    ) as HTMLSelectElement;
    await act(async () => {
      templateSelect.value = 'Deployment';
      templateSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const nameInput = container.querySelector('input[data-field-key="name"]') as HTMLInputElement;
    if (nameInput) {
      await act(async () => {
        nameInput.value = 'changed-name';
        nameInput.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }

    const toggleBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Show YAML'
    ) as HTMLButtonElement | undefined;
    expect(toggleBtn).toBeDefined();
    await act(async () => {
      toggleBtn?.click();
    });

    const editor = container.querySelector('[data-testid="yaml-editor"]') as HTMLTextAreaElement;
    expect(editor.value).toContain('name: changed-name');
    await unmount();
  });

  it('falls back to inline YAML editor when kind has no form definition', async () => {
    const { container, unmount } = await renderModal({ isOpen: true, onClose: vi.fn() });
    await flushPromises();

    // Default template is Deployment (has form definition) → no inline YAML editor.
    expect(container.querySelector('[data-testid="yaml-editor"]')).toBeNull();

    // Select Blank (no form definition) → inline YAML editor is shown.
    const templateSelect = container.querySelector(
      '[data-testid="dropdown-Resource template"]'
    ) as HTMLSelectElement;
    await act(async () => {
      templateSelect.value = '';
      templateSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(container.querySelector('[data-testid="yaml-editor"]')).not.toBeNull();
    await unmount();
  });
});
