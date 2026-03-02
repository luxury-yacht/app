/**
 * frontend/src/ui/modals/CreateResourceModal.tsx
 *
 * Modal for creating new Kubernetes resources from YAML.
 * Provides a YAML editor with starter templates, server-side
 * dry-run validation, and multi-cluster-aware creation.
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { yaml as yamlLang } from '@codemirror/lang-yaml';
import { EditorView } from '@codemirror/view';
import * as YAML from 'yaml';
import './modals.css';
import './CreateResourceModal.css';
import { useShortcut, useKeyboardContext } from '@ui/shortcuts';
import { KeyboardContextPriority, KeyboardScopePriority } from '@ui/shortcuts/priorities';
import { useModalFocusTrap } from '@shared/components/modals/useModalFocusTrap';
import { CloseIcon } from '@shared/components/icons/MenuIcons';
import { Dropdown } from '@shared/components/dropdowns/Dropdown';
import type { DropdownOption } from '@shared/components/dropdowns/Dropdown';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useNamespace } from '@modules/namespace/contexts/NamespaceContext';
import { isAllNamespaces } from '@modules/namespace/constants';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { useErrorContext } from '@core/contexts/ErrorContext';
import { ErrorSeverity, ErrorCategory } from '@utils/errorHandler';
import { refreshOrchestrator } from '@/core/refresh';
import { buildCodeTheme } from '@/core/codemirror/theme';
import {
  GetResourceTemplates,
  ValidateResourceCreation,
  CreateResource,
} from '@wailsjs/go/backend/App';
import {
  parseObjectYamlError,
  type ObjectYamlErrorPayload,
} from '@modules/object-panel/components/ObjectPanel/Yaml/yamlErrors';
import type { templates } from '@wailsjs/go/models';

// Minimal YAML skeleton for the "Blank" option.
const BLANK_YAML = `apiVersion:
kind:
metadata:
  name:
  namespace:
`;

interface CreateResourceModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const CreateResourceModal: React.FC<CreateResourceModalProps> = React.memo(
  ({ isOpen, onClose }) => {
    const [isClosing, setIsClosing] = useState(false);
    const [shouldRender, setShouldRender] = useState(false);
    const { pushContext, popContext } = useKeyboardContext();
    const contextPushedRef = useRef(false);
    const modalRef = useRef<HTMLDivElement>(null);
    const {
      selectedClusterId,
      selectedClusterIds,
      getClusterMeta,
    } = useKubeconfig();
    const namespace = useNamespace();
    const { openWithObject } = useObjectPanel();
    const { addError } = useErrorContext();

    // YAML editor content.
    const [yamlContent, setYamlContent] = useState(BLANK_YAML);

    // Template state.
    const [availableTemplates, setAvailableTemplates] = useState<templates.ResourceTemplate[]>([]);
    const [selectedTemplate, setSelectedTemplate] = useState('');

    // Cluster selection — the user can target any connected cluster.
    const [targetClusterId, setTargetClusterId] = useState(selectedClusterId ?? '');

    // Resolve display name for the target cluster.
    const targetClusterName = useMemo(() => {
      if (!targetClusterId) return '';
      const meta = getClusterMeta(targetClusterId);
      return meta.name || targetClusterId;
    }, [targetClusterId, getClusterMeta]);

    // Cluster dropdown options — one per connected cluster.
    const clusterOptions: DropdownOption[] = useMemo(
      () =>
        selectedClusterIds.map((id) => {
          const meta = getClusterMeta(id);
          return { value: id, label: meta.name || id };
        }),
      [selectedClusterIds, getClusterMeta]
    );

    // Namespace selection — filtered to exclude synthetic entries.
    const realNamespaces = useMemo(
      () => (namespace.namespaces ?? []).filter((ns) => !ns.isSynthetic),
      [namespace.namespaces]
    );
    const defaultNamespace = isAllNamespaces(namespace.selectedNamespace)
      ? ''
      : namespace.selectedNamespace ?? '';
    const [selectedNamespace, setSelectedNamespace] = useState(defaultNamespace);

    // Namespace dropdown options.
    const namespaceOptions: DropdownOption[] = useMemo(
      () => realNamespaces.map((ns) => ({ value: ns.name, label: ns.name })),
      [realNamespaces]
    );

    // Client-side YAML parse error.
    const [parseError, setParseError] = useState<string | null>(null);

    // Validation state.
    const [isValidating, setIsValidating] = useState(false);
    const [validationSuccess, setValidationSuccess] = useState<string | null>(null);
    const [validationError, setValidationError] = useState<ObjectYamlErrorPayload | null>(null);
    const [rawError, setRawError] = useState<string | null>(null);

    // Creation state.
    const [isCreating, setIsCreating] = useState(false);

    // Dark theme detection for CodeMirror.
    const [isDarkTheme, setIsDarkTheme] = useState(
      () => document.documentElement.getAttribute('data-theme') === 'dark'
    );

    useEffect(() => {
      const checkTheme = () => {
        setIsDarkTheme(document.documentElement.getAttribute('data-theme') === 'dark');
      };
      const observer = new MutationObserver(checkTheme);
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme', 'class'],
      });
      return () => observer.disconnect();
    }, []);

    const { theme: codeMirrorTheme, highlight: highlightExtension } = useMemo(
      () => buildCodeTheme(isDarkTheme),
      [isDarkTheme]
    );

    const editorExtensions = useMemo(
      () => [yamlLang(), EditorView.lineWrapping, codeMirrorTheme, highlightExtension],
      [codeMirrorTheme, highlightExtension]
    );

    // Handle open/close animation and state reset.
    useEffect(() => {
      if (isOpen) {
        setShouldRender(true);
        setIsClosing(false);
        // Reset state on open.
        setYamlContent(BLANK_YAML);
        setSelectedTemplate('');
        setTargetClusterId(selectedClusterId ?? '');
        setSelectedNamespace(
          isAllNamespaces(namespace.selectedNamespace)
            ? ''
            : namespace.selectedNamespace ?? ''
        );
        setParseError(null);
        setValidationSuccess(null);
        setValidationError(null);
        setRawError(null);
        setIsValidating(false);
        setIsCreating(false);
        // Load templates.
        GetResourceTemplates()
          .then(setAvailableTemplates)
          .catch(() => setAvailableTemplates([]));
      } else if (shouldRender) {
        setIsClosing(true);
        const timer = setTimeout(() => {
          setShouldRender(false);
          setIsClosing(false);
        }, 200);
        return () => clearTimeout(timer);
      }
    }, [isOpen, shouldRender, namespace.selectedNamespace]);

    // Handle keyboard context and body overflow.
    useEffect(() => {
      if (!isOpen) {
        if (contextPushedRef.current) {
          popContext();
          contextPushedRef.current = false;
        }
        document.body.style.overflow = '';
        return;
      }

      pushContext({ priority: KeyboardContextPriority.CREATE_RESOURCE_MODAL });
      contextPushedRef.current = true;
      document.body.style.overflow = 'hidden';

      return () => {
        if (contextPushedRef.current) {
          popContext();
          contextPushedRef.current = false;
        }
        document.body.style.overflow = '';
      };
    }, [isOpen, popContext, pushContext]);

    // Escape key handling.
    useShortcut({
      key: 'Escape',
      handler: () => {
        if (!isOpen) return false;
        onClose();
        return true;
      },
      description: 'Close create resource modal',
      category: 'Modals',
      enabled: isOpen,
      view: 'global',
      priority: KeyboardContextPriority.CREATE_RESOURCE_MODAL,
    });

    // Focus trap for accessibility.
    useModalFocusTrap({
      ref: modalRef,
      focusableSelector: '[data-create-resource-focusable="true"]',
      priority: KeyboardScopePriority.CREATE_RESOURCE_MODAL,
      disabled: !isOpen,
    });

    // Client-side YAML parsing — extract kind for display and detect parse errors.
    const parsedKind = useMemo(() => {
      if (!yamlContent.trim()) return '';
      try {
        const doc = YAML.parseDocument(yamlContent);
        if (doc.errors.length > 0) {
          setParseError(doc.errors[0].message);
          return '';
        }
        setParseError(null);
        const kind = doc.get('kind');
        return typeof kind === 'string' ? kind : '';
      } catch {
        setParseError('Invalid YAML');
        return '';
      }
    }, [yamlContent]);

    // Template selection handler.
    const handleTemplateChange = useCallback(
      (value: string | string[]) => {
        const templateName = Array.isArray(value) ? value[0] ?? '' : value;
        setSelectedTemplate(templateName);
        // Clear previous validation state on template change.
        setValidationSuccess(null);
        setValidationError(null);
        setRawError(null);

        if (!templateName) {
          setYamlContent(BLANK_YAML);
          return;
        }

        const template = availableTemplates.find((t) => t.name === templateName);
        if (!template) return;

        // Replace the namespace placeholder with the selected namespace.
        let templateYaml = template.yaml;
        if (selectedNamespace) {
          templateYaml = templateYaml.replace(
            /namespace:\s*my-namespace/,
            `namespace: ${selectedNamespace}`
          );
        }
        setYamlContent(templateYaml);
      },
      [availableTemplates, selectedNamespace]
    );

    // Template dropdown options — disabled category headers + template entries.
    const templateOptions: DropdownOption[] = useMemo(() => {
      const opts: DropdownOption[] = [{ value: '', label: 'Blank' }];
      const groups = new Map<string, templates.ResourceTemplate[]>();
      for (const t of availableTemplates) {
        const existing = groups.get(t.category) ?? [];
        groups.set(t.category, [...existing, t]);
      }
      for (const [category, items] of groups) {
        // Disabled category header.
        opts.push({ value: `_header_${category}`, label: category, disabled: true, group: 'header' });
        for (const t of items) {
          opts.push({ value: t.name, label: t.name });
        }
      }
      return opts;
    }, [availableTemplates]);

    // Clear validation state when YAML changes.
    const handleYamlChange = useCallback((value: string) => {
      setYamlContent(value);
      setValidationSuccess(null);
      setValidationError(null);
      setRawError(null);
    }, []);

    // Shared error handling for validate/create responses.
    const handleBackendError = useCallback((err: unknown) => {
      const parsed = parseObjectYamlError(err);
      if (parsed) {
        setValidationError(parsed);
        setRawError(null);
      } else {
        const message = err instanceof Error ? err.message : String(err);
        setValidationError(null);
        setRawError(message);
      }
    }, []);

    // Validate button handler (dry-run).
    const handleValidate = useCallback(async () => {
      if (!targetClusterId) return;
      setIsValidating(true);
      setValidationSuccess(null);
      setValidationError(null);
      setRawError(null);

      try {
        const resp = await ValidateResourceCreation(targetClusterId, {
          yaml: yamlContent,
          namespace: selectedNamespace,
        });
        setValidationSuccess(
          `Validation passed: ${resp.kind}/${resp.name}` +
            (resp.namespace ? ` in ${resp.namespace}` : '')
        );
      } catch (err) {
        handleBackendError(err);
      } finally {
        setIsValidating(false);
      }
    }, [targetClusterId, yamlContent, selectedNamespace, handleBackendError]);

    // Create button handler.
    const handleCreate = useCallback(async () => {
      if (!targetClusterId) return;

      // Capture cluster context before async call for multi-cluster safety.
      const capturedClusterId = targetClusterId;
      const capturedClusterName = targetClusterName || targetClusterId;

      setIsCreating(true);
      setValidationSuccess(null);
      setValidationError(null);
      setRawError(null);

      try {
        const resp = await CreateResource(capturedClusterId, {
          yaml: yamlContent,
          namespace: selectedNamespace,
        });

        // 1. Open the new object in the Object Panel with pinned cluster context.
        openWithObject({
          kind: resp.kind,
          name: resp.name,
          namespace: resp.namespace || undefined,
          clusterId: capturedClusterId,
          clusterName: capturedClusterName,
        });

        // 2. Close the modal.
        onClose();

        // 3. Refresh current view (no cluster override — refreshes whatever is displayed).
        void refreshOrchestrator.triggerManualRefreshForContext();

        // 4. Show success notification with cluster context.
        const nsLabel = resp.namespace ? ` in namespace ${resp.namespace}` : '';
        addError({
          message: `Created ${resp.kind}/${resp.name}${nsLabel} on cluster ${capturedClusterName}`,
          category: ErrorCategory.UNKNOWN,
          severity: ErrorSeverity.INFO,
          timestamp: new Date(),
          retryable: false,
          userMessage: `Created ${resp.kind}/${resp.name}${nsLabel} on cluster ${capturedClusterName}`,
        });
      } catch (err) {
        handleBackendError(err);
      } finally {
        setIsCreating(false);
      }
    }, [
      targetClusterId,
      targetClusterName,
      yamlContent,
      selectedNamespace,
      openWithObject,
      onClose,
      addError,
      handleBackendError,
    ]);

    if (!shouldRender) return null;

    const hasCluster = selectedClusterIds.length > 0;
    const hasTarget = !!targetClusterId;
    const isBusy = isValidating || isCreating;

    return (
      <>
        <div className={`modal-overlay ${isClosing ? 'closing' : ''}`} onClick={onClose}>
          <div
            className={`modal-container create-resource-modal ${isClosing ? 'closing' : ''}`}
            onClick={(e) => e.stopPropagation()}
            ref={modalRef}
          >
            <div className="modal-header">
              <h2>Create Resource</h2>
              <button
                className="modal-close"
                onClick={onClose}
                aria-label="Close"
                data-create-resource-focusable="true"
              >
                <CloseIcon />
              </button>
            </div>

            <div className="modal-content create-resource-content">
              {hasCluster ? (
                <>
                  {/* Context bar: cluster, namespace, and kind dropdowns */}
                  <div className="create-resource-context-bar">
                    <label className="create-resource-dropdown-field">
                      <span className="create-resource-dropdown-label">Cluster</span>
                      <Dropdown
                        options={clusterOptions}
                        value={targetClusterId}
                        onChange={(v) => setTargetClusterId(Array.isArray(v) ? v[0] ?? '' : v)}
                        placeholder="Select cluster"
                        size="compact"
                        ariaLabel="Target cluster"
                      />
                    </label>
                    <label className="create-resource-dropdown-field">
                      <span className="create-resource-dropdown-label">Namespace</span>
                      <Dropdown
                        options={namespaceOptions}
                        value={selectedNamespace}
                        onChange={(v) => setSelectedNamespace(Array.isArray(v) ? v[0] ?? '' : v)}
                        placeholder="Select namespace"
                        size="compact"
                        clearable
                        ariaLabel="Target namespace"
                      />
                    </label>
                    <label className="create-resource-dropdown-field">
                      <span className="create-resource-dropdown-label">Kind</span>
                      <Dropdown
                        options={templateOptions}
                        value={selectedTemplate}
                        onChange={handleTemplateChange}
                        placeholder="Blank"
                        size="compact"
                        ariaLabel="Resource template"
                      />
                    </label>
                  </div>

                  {/* YAML editor */}
                  <div className="create-resource-editor">
                    <CodeMirror
                      value={yamlContent}
                      extensions={editorExtensions}
                      onChange={handleYamlChange}
                    />
                  </div>

                  {/* Client-side parse error */}
                  {parseError && (
                    <div className="create-resource-parse-error">Parse error: {parseError}</div>
                  )}

                  {/* Validation success */}
                  {validationSuccess && (
                    <div className="create-resource-validation-success">{validationSuccess}</div>
                  )}

                  {/* Structured validation/creation error */}
                  {validationError && (
                    <div className="create-resource-validation-error">
                      <strong>{validationError.code}:</strong> {validationError.message}
                      {validationError.causes && validationError.causes.length > 0 && (
                        <ul className="create-resource-error-causes">
                          {validationError.causes.map((cause, i) => (
                            <li key={i}>{cause}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}

                  {/* Raw (non-structured) error */}
                  {rawError && (
                    <div className="create-resource-validation-error">{rawError}</div>
                  )}
                </>
              ) : (
                <div className="create-resource-no-cluster">
                  No cluster connected. Connect to a cluster to create resources.
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button
                className="modal-btn modal-btn-secondary"
                onClick={onClose}
                data-create-resource-focusable="true"
              >
                Cancel
              </button>
              {parsedKind && (
                <span className="create-resource-kind-badge">{parsedKind}</span>
              )}
              <button
                className="modal-btn modal-btn-primary"
                disabled={!hasTarget || isBusy}
                onClick={handleValidate}
                data-create-resource-focusable="true"
              >
                {isValidating ? 'Validating...' : 'Validate'}
              </button>
              <button
                className="modal-btn modal-btn-primary"
                disabled={!hasTarget || isBusy}
                onClick={handleCreate}
                data-create-resource-focusable="true"
              >
                {isCreating ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      </>
    );
  }
);

export default CreateResourceModal;
