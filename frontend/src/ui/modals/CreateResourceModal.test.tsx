/**
 * frontend/src/ui/modals/CreateResourceModal.test.tsx
 *
 * Test suite for CreateResourceModal.
 */

import React, { act } from 'react';
import ReactDOM from 'react-dom/client';
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
  getClusterMeta: (id: string) => ({ id, name: id === 'config:test-cluster' ? 'test-cluster' : id }),
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
      yaml: 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: my-app\n  namespace: my-namespace',
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
}));

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
            ],
          },
        ],
      };
    }
    return undefined;
  },
}));

vi.mock('./create-resource/ResourceForm', () => ({
  ResourceForm: ({ yamlContent, onYamlChange }: { yamlContent: string; onYamlChange: (v: string) => void; definition: unknown }) => {
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
        onChangeRef.current(
          yamlRef.current.replace(/name: [^\n]+/, `name: ${target.value}`)
        );
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
  default: ({ value, onChange }: { value: string; onChange?: (v: string) => void }) => (
    <textarea
      data-testid="yaml-editor"
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
    />
  ),
}));

vi.mock('@codemirror/lang-yaml', () => ({
  yaml: () => [],
}));

vi.mock('@codemirror/view', () => ({
  EditorView: { lineWrapping: [] },
}));

// --- Test helpers ---

type CreateResourceModalModule = typeof import('./CreateResourceModal');
type CreateResourceModalComponent = CreateResourceModalModule['default'];
type ModalProps = React.ComponentProps<CreateResourceModalComponent>;

const renderModal = async (props: ModalProps) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);
  const { default: CreateResourceModal } = await import('./CreateResourceModal');

  await act(async () => {
    root.render(<CreateResourceModal {...props} />);
  });

  return {
    container,
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
      container.remove();
    },
  };
};

// Helper to flush pending promises.
const flushPromises = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

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
    expect(container.textContent).toContain('Create Resource');
    expect(container.textContent).toContain('Validate');
    expect(container.textContent).toContain('Create');
    expect(container.textContent).toContain('Cancel');
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

    const templateSelect = container.querySelector('[data-testid="dropdown-Resource template"]') as HTMLSelectElement;
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

    const select = container.querySelector('[data-testid="dropdown-Resource template"]') as HTMLSelectElement;
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
    await act(async () => { toggleBtn?.click(); });

    const editor = container.querySelector('[data-testid="yaml-editor"]') as HTMLTextAreaElement;
    expect(editor.value).toContain('kind: Deployment');
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
    await act(async () => { validateBtn?.click(); });
    await flushPromises();

    expect(container.querySelector('.create-resource-validation-success')).not.toBeNull();
    expect(container.textContent).toContain('Validation passed');
    await unmount();
  });

  it('shows structured error with causes on validation failure', async () => {
    wailsMock.ValidateResourceCreation.mockRejectedValueOnce(
      new Error('ObjectYAMLError:{"code":"Invalid","message":"spec.containers required","causes":["spec.containers: Required value"]}')
    );

    const { container, unmount } = await renderModal({ isOpen: true, onClose: vi.fn() });
    await flushPromises();

    const validateBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Validate'
    );
    await act(async () => { validateBtn?.click(); });
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
    await act(async () => { createBtn?.click(); });
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
    await act(async () => { createBtn?.click(); });
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
    await act(async () => { createBtn?.click(); });
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
    await act(async () => { createBtn?.click(); });
    await flushPromises();

    expect(onClose).toHaveBeenCalled();
    await unmount();
  });

  it('namespace dropdown shows only namespaces for the target cluster', async () => {
    const { container, unmount } = await renderModal({ isOpen: true, onClose: vi.fn() });
    await flushPromises();

    const nsSelect = container.querySelector('[data-testid="dropdown-Target namespace"]') as HTMLSelectElement;
    expect(nsSelect).not.toBeNull();

    const options = Array.from(nsSelect.options).map((o) => o.text);
    // Should include namespaces from config:test-cluster.
    expect(options).toContain('default');
    expect(options).toContain('kube-system');
    // Should NOT include namespaces from other clusters.
    expect(options).not.toContain('other-ns');
    await unmount();
  });

  it('defaults to empty namespace when current selection is All Namespaces', async () => {
    namespaceMock.selectedNamespace = 'namespace:all';

    const { container, unmount } = await renderModal({ isOpen: true, onClose: vi.fn() });
    await flushPromises();

    const nsSelect = container.querySelector('[data-testid="dropdown-Target namespace"]') as HTMLSelectElement;
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

    const clusterDropdown = container.querySelector('[data-testid="dropdown-Target cluster"]') as HTMLSelectElement;
    expect(clusterDropdown).not.toBeNull();
    // The active cluster should be selected.
    expect(clusterDropdown.value).toBe('config:test-cluster');
    await unmount();
  });

  it('shows view toggle when a supported template is selected', async () => {
    const { container, unmount } = await renderModal({ isOpen: true, onClose: vi.fn() });
    await flushPromises();

    const templateSelect = container.querySelector('[data-testid="dropdown-Resource template"]') as HTMLSelectElement;
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

  it('disables view toggle when Blank template is selected', async () => {
    const { container, unmount } = await renderModal({ isOpen: true, onClose: vi.fn() });
    await flushPromises();

    const templateSelect = container.querySelector('[data-testid="dropdown-Resource template"]') as HTMLSelectElement;
    await act(async () => {
      templateSelect.value = '';
      templateSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const toggleBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Show Form'
    ) as HTMLButtonElement | undefined;
    expect(toggleBtn).toBeDefined();
    expect(toggleBtn?.disabled).toBe(true);
    expect(container.querySelector('[data-testid="yaml-editor"]')).not.toBeNull();
    await unmount();
  });

  it('defaults to Form view when a supported template is selected', async () => {
    const { container, unmount } = await renderModal({ isOpen: true, onClose: vi.fn() });
    await flushPromises();

    const templateSelect = container.querySelector('[data-testid="dropdown-Resource template"]') as HTMLSelectElement;
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

  it('switches to YAML view when toggle is clicked', async () => {
    const { container, unmount } = await renderModal({ isOpen: true, onClose: vi.fn() });
    await flushPromises();

    const templateSelect = container.querySelector('[data-testid="dropdown-Resource template"]') as HTMLSelectElement;
    await act(async () => {
      templateSelect.value = 'Deployment';
      templateSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const toggleBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Show YAML'
    ) as HTMLButtonElement | undefined;
    expect(toggleBtn).toBeDefined();
    await act(async () => { toggleBtn?.click(); });

    expect(container.querySelector('[data-testid="yaml-editor"]')).not.toBeNull();
    const showFormBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Show Form'
    ) as HTMLButtonElement | undefined;
    expect(showFormBtn).toBeDefined();
    await unmount();
  });

  it('form changes are reflected in YAML when switching views', async () => {
    const { container, unmount } = await renderModal({ isOpen: true, onClose: vi.fn() });
    await flushPromises();

    const templateSelect = container.querySelector('[data-testid="dropdown-Resource template"]') as HTMLSelectElement;
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
    await act(async () => { toggleBtn?.click(); });

    const editor = container.querySelector('[data-testid="yaml-editor"]') as HTMLTextAreaElement;
    expect(editor.value).toContain('name: changed-name');
    await unmount();
  });

  it('disables view toggle when kind is changed to unsupported in YAML', async () => {
    const { container, unmount } = await renderModal({ isOpen: true, onClose: vi.fn() });
    await flushPromises();

    // Select Deployment to enable form toggle.
    const templateSelect = container.querySelector('[data-testid="dropdown-Resource template"]') as HTMLSelectElement;
    await act(async () => {
      templateSelect.value = 'Deployment';
      templateSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const showYamlBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Show YAML'
    ) as HTMLButtonElement | undefined;
    expect(showYamlBtn).toBeDefined();
    expect(showYamlBtn?.disabled).toBe(false);

    // Switch to YAML and change kind to unsupported.
    await act(async () => { showYamlBtn?.click(); });

    const editor = container.querySelector('[data-testid="yaml-editor"]') as HTMLTextAreaElement;
    // Use the native value setter + input event to trigger React's synthetic onChange.
    const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value'
    )!.set!;
    await act(async () => {
      nativeTextAreaValueSetter.call(editor, 'apiVersion: v1\nkind: Pod\nmetadata:\n  name: test\n');
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // Form toggle should be disabled for unsupported kinds.
    const showFormBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Show Form'
    ) as HTMLButtonElement | undefined;
    expect(showFormBtn).toBeDefined();
    expect(showFormBtn?.disabled).toBe(true);
    await unmount();
  });
});
