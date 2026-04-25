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
import ModalSurface from '@shared/components/modals/ModalSurface';
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
import { useRefreshScopedDomain } from '@/core/refresh';
import { requestContextRefresh, requestRefreshDomain } from '@/core/data-access';
import { buildClusterScopeList } from '@/core/refresh/clusterScope';
import { buildCodeTheme } from '@/core/codemirror/theme';
import { createSearchExtensions } from '@/core/codemirror/search';
import {
  GetResourceTemplates,
  ValidateResourceCreation,
  CreateResource,
} from '@wailsjs/go/backend/App';
import { parseApiVersion } from '@shared/constants/builtinGroupVersions';
import {
  parseObjectYamlError,
  type ObjectYamlErrorPayload,
} from '@modules/object-panel/components/ObjectPanel/Yaml/yamlErrors';
import {
  applyResourceVersionToYaml,
  applyYamlOnServer,
  validateYamlOnServer,
} from '@modules/object-panel/components/ObjectPanel/Yaml/yamlTabUtils';
import {
  validateYamlDraft,
  type ObjectIdentity,
} from '@modules/object-panel/components/ObjectPanel/Yaml/yamlValidation';
import type { templates } from '@wailsjs/go/models';
import { getFormDefinition } from './create-resource/formDefinitions';
import { ResourceForm } from './create-resource/ResourceForm';
import { getRequiredFieldErrors } from './create-resource/formUtils';
import { getFieldValue } from './create-resource/yamlSync';
import type { CreateResourceModalRequest } from './create-resource/types';

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
  request?: CreateResourceModalRequest | null;
}

const CreateResourceModal: React.FC<CreateResourceModalProps> = React.memo(
  ({ isOpen, onClose, request = null }) => {
    const [isClosing, setIsClosing] = useState(false);
    const [shouldRender, setShouldRender] = useState(false);
    const modalRef = useRef<HTMLDivElement>(null);
    const { selectedClusterId, selectedClusterIds, getClusterMeta } = useKubeconfig();
    const { selectedNamespace: activeNamespace } = useNamespace();
    const { openWithObject } = useObjectPanel();
    const { addError } = useErrorContext();
    const isEditMode = request?.mode === 'edit';
    const editIdentity = request?.identity ?? null;

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

    // Namespace data — pull from the refresh store for all connected clusters,
    // then filter to the target cluster so the dropdown repopulates when the
    // cluster selection changes.
    const namespacesScope = useMemo(
      () => buildClusterScopeList(selectedClusterIds, ''),
      [selectedClusterIds]
    );
    const namespaceDomain = useRefreshScopedDomain('namespaces', namespacesScope);

    const namespaceOptions: DropdownOption[] = useMemo(() => {
      if (!namespaceDomain.data || !targetClusterId) return [];
      return namespaceDomain.data.namespaces
        .filter((ns) => ns.clusterId === targetClusterId)
        .map((ns) => ({ value: ns.name, label: ns.name }));
    }, [namespaceDomain.data, targetClusterId]);

    const defaultNamespace = isAllNamespaces(activeNamespace) ? '' : (activeNamespace ?? '');
    const [selectedNamespace, setSelectedNamespace] = useState(defaultNamespace);

    const extractNamespaceFromYaml = useCallback((content: string): string | null => {
      try {
        const doc = YAML.parseDocument(content);
        if (doc.errors.length > 0) return null;
        const namespace = doc.getIn(['metadata', 'namespace']);
        return typeof namespace === 'string' ? namespace : '';
      } catch {
        return null;
      }
    }, []);

    const applyNamespaceToYaml = useCallback((content: string, namespace: string): string => {
      try {
        const doc = YAML.parseDocument(content);
        if (doc.errors.length > 0) return content;
        doc.setIn(['metadata', 'namespace'], namespace);
        return doc.toString();
      } catch {
        return content;
      }
    }, []);

    // Reset namespace when target cluster changes — the previous namespace
    // may not exist in the new cluster.
    const prevTargetClusterRef = useRef(targetClusterId);
    useEffect(() => {
      if (prevTargetClusterRef.current !== targetClusterId) {
        prevTargetClusterRef.current = targetClusterId;
        setSelectedNamespace('');
        setYamlContent((previousYaml) => applyNamespaceToYaml(previousYaml, ''));
      }
    }, [applyNamespaceToYaml, targetClusterId]);

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

    // CodeMirror theme and extensions — same pattern as YamlTab.
    const { theme: codeMirrorTheme, highlight: highlightExtension } = useMemo(
      () => buildCodeTheme(isDarkTheme),
      [isDarkTheme]
    );

    const searchExtensions = useMemo(() => createSearchExtensions({ enableKeymap: false }), []);

    const baseEditorExtensions = useMemo(
      () => [yamlLang(), highlightExtension, ...searchExtensions],
      [highlightExtension, searchExtensions]
    );
    const wrappedEditorExtensions = useMemo(
      () => [...baseEditorExtensions, EditorView.lineWrapping],
      [baseEditorExtensions]
    );

    // Handle open/close animation and state reset.
    useEffect(() => {
      if (isOpen) {
        setShouldRender(true);
        setIsClosing(false);
        const initialNamespace = isEditMode
          ? (editIdentity?.namespace ?? '')
          : isAllNamespaces(activeNamespace)
            ? ''
            : (activeNamespace ?? '');
        // Reset state on open.
        setYamlContent(isEditMode ? (request?.initialYaml ?? BLANK_YAML) : BLANK_YAML);
        setSelectedTemplate('');
        setAvailableTemplates([]);
        setTargetClusterId(isEditMode ? (request?.clusterId ?? '') : (selectedClusterId ?? ''));
        setSelectedNamespace(initialNamespace);
        setParseError(null);
        setValidationSuccess(null);
        setValidationError(null);
        setRawError(null);
        setIsValidating(false);
        setIsCreating(false);
        setActiveView('yaml');
        setYamlPanelOpen(false);
        setYamlPanelClosing(false);
        setYamlPanelReady(false);
        setYamlPanelWidth(700);
        setYamlPanelWrap(false);
        const formKind = isEditMode ? (editIdentity?.kind ?? '') : '';
        if (isEditMode) {
          setActiveView(getFormDefinition(formKind) ? 'form' : 'yaml');
          return undefined;
        }
        // Load templates.
        GetResourceTemplates()
          .then((templates) => {
            setAvailableTemplates(templates);
            const defaultTemplate =
              templates.find((t) => t.kind === 'Deployment') ??
              templates.find((t) => t.name === 'Deployment');
            if (!defaultTemplate) return;

            setSelectedTemplate(defaultTemplate.name);
            const templateYaml = applyNamespaceToYaml(defaultTemplate.yaml, initialNamespace);
            const def = getFormDefinition(defaultTemplate.kind ?? '');
            setYamlContent(templateYaml);
            setActiveView(def ? 'form' : 'yaml');
          })
          .catch(() => setAvailableTemplates([]));
      } else if (shouldRender) {
        setIsClosing(true);
        const timer = setTimeout(() => {
          setShouldRender(false);
          setIsClosing(false);
        }, 200);
        return () => clearTimeout(timer);
      }
    }, [
      isOpen,
      shouldRender,
      activeNamespace,
      selectedClusterId,
      applyNamespaceToYaml,
      editIdentity,
      isEditMode,
      request,
    ]);

    // Keep body scroll locked while the modal is open.
    useEffect(() => {
      document.body.style.overflow = isOpen ? 'hidden' : '';
      return () => {
        document.body.style.overflow = '';
      };
    }, [isOpen]);

    // Focus trap for accessibility.
    useModalFocusTrap({
      ref: modalRef,
      focusableSelector: '[data-create-resource-focusable="true"]',
      disabled: !shouldRender,
      onEscape: () => {
        if (!isOpen) return false;
        if (yamlPanelOpen) {
          handleYamlPanelClose();
          return true;
        }
        onClose();
        return true;
      },
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

    // Active view: 'form' or 'yaml'. Defaults based on whether a form definition exists.
    const [activeView, setActiveView] = useState<'form' | 'yaml'>('yaml');

    // YAML panel visibility. Hidden by default; toggled via "Show/Hide YAML" button.
    const [yamlPanelOpen, setYamlPanelOpen] = useState(false);
    const [yamlPanelClosing, setYamlPanelClosing] = useState(false);
    // true once the open animation finishes — switches from animation to inline width.
    const [yamlPanelReady, setYamlPanelReady] = useState(false);
    // User-controlled panel width for overlay mode (300–700px).
    const [yamlPanelWidth, setYamlPanelWidth] = useState(700);
    // YAML side panel can optionally soft-wrap lines; default is off.
    const [yamlPanelWrap, setYamlPanelWrap] = useState(false);
    // Tracked width of the middle wrapper for auto-fill calculations.
    const middleRef = useRef<HTMLDivElement>(null);
    const [middleWidth, setMiddleWidth] = useState(0);

    // Track the middle wrapper's width so the panel can auto-fill available space.
    useEffect(() => {
      const el = middleRef.current;
      if (!el || !yamlPanelOpen || typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver((entries) => {
        setMiddleWidth(entries[0]?.contentRect.width ?? 0);
      });
      observer.observe(el);
      return () => observer.disconnect();
    }, [yamlPanelOpen]);

    // Available space beside the form (900px + 1rem left padding + 1rem gap).
    const availableForPanel = middleWidth - 900 - 32;
    // Only switch out of overlay mode once there is enough side space to fit
    // the panel's current width. That avoids the abrupt 700px -> ~300px snap
    // when the modal first crosses the side-by-side breakpoint.
    const panelAutoFills = yamlPanelReady && availableForPanel >= yamlPanelWidth;
    const effectivePanelWidth = panelAutoFills ? Math.min(availableForPanel, 700) : yamlPanelWidth;
    // Only resizable when the panel must overlay the form.
    const panelResizable = yamlPanelReady && !panelAutoFills;

    // Look up form definition for the current kind.
    const formDefinition = useMemo(
      () => (parsedKind ? getFormDefinition(parsedKind) : undefined),
      [parsedKind]
    );

    // Client-side required-field validation (only when a form definition exists).
    const requiredFieldErrors = useMemo(() => {
      if (!formDefinition) return [];
      return getRequiredFieldErrors(formDefinition, yamlContent, getFieldValue);
    }, [formDefinition, yamlContent]);

    // Form availability and currently selected view.
    const canShowForm = !!formDefinition;
    const showingForm = canShowForm && activeView === 'form';

    // Template selection handler.
    const handleTemplateChange = useCallback(
      (value: string | string[]) => {
        const templateName = Array.isArray(value) ? (value[0] ?? '') : value;
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

        // Keep the selected namespace when changing kinds.
        const templateYaml = applyNamespaceToYaml(template.yaml, selectedNamespace);
        const def = getFormDefinition(template?.kind ?? '');
        setYamlContent(templateYaml);

        // Switch to form view if the template has a form definition.
        setActiveView(def ? 'form' : 'yaml');
      },
      [availableTemplates, selectedNamespace, applyNamespaceToYaml]
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
        opts.push({
          value: `_header_${category}`,
          label: category,
          disabled: true,
          group: 'header',
        });
        for (const t of items) {
          opts.push({ value: t.name, label: t.name });
        }
      }
      return opts;
    }, [availableTemplates]);

    // Modal header reflects the selected Kind; Blank falls back to generic title.
    const createHeaderTitle = useMemo(() => {
      if (isEditMode && editIdentity) {
        return `Edit ${editIdentity.kind}`;
      }
      if (!selectedTemplate) return 'Create Resource';
      const selected = availableTemplates.find((t) => t.name === selectedTemplate);
      const resourceKind = selected?.kind || selectedTemplate;
      return `Create ${resourceKind}`;
    }, [availableTemplates, editIdentity, isEditMode, selectedTemplate]);

    // Clear validation state when YAML changes.
    const handleYamlChange = useCallback(
      (value: string) => {
        setYamlContent(value);
        const parsedNamespace = extractNamespaceFromYaml(value);
        if (parsedNamespace !== null) {
          setSelectedNamespace(parsedNamespace);
        }
        setValidationSuccess(null);
        setValidationError(null);
        setRawError(null);
      },
      [extractNamespaceFromYaml]
    );

    // Capture the panel's rendered width at close time so the close animation
    // starts from the correct size (which may differ from yamlPanelWidth).
    const closingWidthRef = useRef(700);

    /** Close the YAML panel with exit animation. */
    const handleYamlPanelClose = useCallback(() => {
      const panelEl = middleRef.current?.querySelector('.yaml-panel') as HTMLElement | null;
      closingWidthRef.current = panelEl?.getBoundingClientRect().width ?? 700;
      setYamlPanelClosing(true);
      setTimeout(() => {
        setYamlPanelOpen(false);
        setYamlPanelClosing(false);
        setYamlPanelReady(false);
      }, 300);
    }, []);

    /** After the open animation finishes, switch to inline-width control. */
    const handlePanelAnimationEnd = useCallback(() => {
      if (!yamlPanelClosing) {
        setYamlPanelReady(true);
      }
    }, [yamlPanelClosing]);

    /** Drag the panel's left edge to resize (300–700px). */
    const handleResizePointerDown = useCallback((e: React.PointerEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const panelEl = (e.target as HTMLElement).closest('.yaml-panel') as HTMLElement;
      const startWidth = panelEl.getBoundingClientRect().width;

      const handleMove = (moveEvent: PointerEvent) => {
        // Dragging left → wider, dragging right → narrower.
        const delta = startX - moveEvent.clientX;
        setYamlPanelWidth(Math.min(700, Math.max(300, Math.round(startWidth + delta))));
      };

      const handleUp = () => {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('pointermove', handleMove);
        document.removeEventListener('pointerup', handleUp);
      };

      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('pointermove', handleMove);
      document.addEventListener('pointerup', handleUp);
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

    const validateEditDraft = useCallback(() => {
      if (!editIdentity) {
        return { isValid: false as const, message: 'Unable to resolve object identity.' };
      }

      const validation = validateYamlDraft(
        yamlContent,
        editIdentity,
        editIdentity.resourceVersion ?? null
      );
      if (!validation.isValid) {
        return validation;
      }

      const baselineResourceVersion = editIdentity.resourceVersion ?? null;
      if (!baselineResourceVersion) {
        return {
          isValid: false as const,
          message:
            'metadata.resourceVersion is required for edits to avoid overwriting concurrent changes.',
        };
      }

      return {
        isValid: true as const,
        validation,
        baselineResourceVersion,
      };
    }, [editIdentity, yamlContent]);

    // Validate button handler (dry-run).
    const handleValidate = useCallback(async () => {
      if (!targetClusterId) return;
      setIsValidating(true);
      setValidationSuccess(null);
      setValidationError(null);
      setRawError(null);

      try {
        if (isEditMode) {
          const draftValidation = validateEditDraft();
          if (!draftValidation.isValid) {
            setRawError(draftValidation.message);
            return;
          }

          const resolvedIdentity = editIdentity as ObjectIdentity;
          await validateYamlOnServer(
            targetClusterId,
            request?.initialYaml ?? '',
            draftValidation.validation.normalizedYAML,
            resolvedIdentity,
            draftValidation.baselineResourceVersion
          );
          setValidationSuccess(
            `Validation passed: ${resolvedIdentity.kind}/${resolvedIdentity.name}` +
              (resolvedIdentity.namespace ? ` in ${resolvedIdentity.namespace}` : '')
          );
          return;
        }

        const requestNamespace = extractNamespaceFromYaml(yamlContent) ?? selectedNamespace;
        const resp = await ValidateResourceCreation(targetClusterId, {
          yaml: yamlContent,
          namespace: requestNamespace,
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
    }, [
      targetClusterId,
      yamlContent,
      selectedNamespace,
      extractNamespaceFromYaml,
      handleBackendError,
      editIdentity,
      isEditMode,
      request?.initialYaml,
      validateEditDraft,
    ]);

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
        if (isEditMode && editIdentity) {
          const draftValidation = validateEditDraft();
          if (!draftValidation.isValid) {
            setRawError(draftValidation.message);
            return;
          }

          const validationResponse = await validateYamlOnServer(
            capturedClusterId,
            request?.initialYaml ?? '',
            draftValidation.validation.normalizedYAML,
            editIdentity,
            draftValidation.baselineResourceVersion
          );

          const resourceVersionForApply =
            validationResponse?.resourceVersion ?? draftValidation.baselineResourceVersion;

          let payloadForApply = draftValidation.validation.normalizedYAML;
          if (
            validationResponse?.resourceVersion &&
            validationResponse.resourceVersion !== draftValidation.baselineResourceVersion
          ) {
            payloadForApply = applyResourceVersionToYaml(
              draftValidation.validation.normalizedYAML,
              validationResponse.resourceVersion
            );
            setYamlContent(payloadForApply);
          }

          const applyResponse = await applyYamlOnServer(
            capturedClusterId,
            request?.initialYaml ?? '',
            payloadForApply,
            editIdentity,
            resourceVersionForApply
          );
          const appliedResourceVersion = applyResponse?.resourceVersion ?? resourceVersionForApply;
          setYamlContent(applyResourceVersionToYaml(payloadForApply, appliedResourceVersion));

          onClose();

          if (request?.scope) {
            await requestRefreshDomain({
              domain: 'object-yaml',
              scope: request.scope,
              reason: 'user',
            });
          }
          await requestContextRefresh({ reason: 'user' });

          const nsLabel = editIdentity.namespace ? ` in namespace ${editIdentity.namespace}` : '';
          addError({
            message: `Saved ${editIdentity.kind}/${editIdentity.name}${nsLabel} on cluster ${capturedClusterName}`,
            category: ErrorCategory.UNKNOWN,
            severity: ErrorSeverity.INFO,
            timestamp: new Date(),
            retryable: false,
            userMessage: `Saved ${editIdentity.kind}/${editIdentity.name}${nsLabel} on cluster ${capturedClusterName}`,
          });
          return;
        }

        const requestNamespace = extractNamespaceFromYaml(yamlContent) ?? selectedNamespace;
        const resp = await CreateResource(capturedClusterId, {
          yaml: yamlContent,
          namespace: requestNamespace,
        });

        // 1. Open the new object in the Object Panel with pinned cluster context.
        openWithObject({
          ...parseApiVersion(resp.apiVersion),
          kind: resp.kind,
          name: resp.name,
          namespace: resp.namespace || undefined,
          clusterId: capturedClusterId,
          clusterName: capturedClusterName,
        });

        // 2. Close the modal.
        onClose();

        // 3. Refresh current view (no cluster override — refreshes whatever is displayed).
        void requestContextRefresh({ reason: 'user' });

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
      extractNamespaceFromYaml,
      openWithObject,
      onClose,
      addError,
      handleBackendError,
      editIdentity,
      isEditMode,
      request?.initialYaml,
      request?.scope,
      validateEditDraft,
    ]);

    if (!shouldRender) return null;

    const hasCluster = selectedClusterIds.length > 0;
    const hasTarget = !!targetClusterId;
    const isBusy = isValidating || isCreating;

    return (
      <ModalSurface
        modalRef={modalRef}
        labelledBy="create-resource-modal-title"
        onClose={onClose}
        containerClassName={`create-resource-modal${yamlPanelOpen && !yamlPanelClosing ? ' yaml-panel-visible' : ''}`}
        isClosing={isClosing}
        closeOnBackdrop={false}
      >
        <div className="modal-header">
          <h2 id="create-resource-modal-title">{createHeaderTitle}</h2>
          <button
            className="modal-close"
            onClick={onClose}
            aria-label="Close"
            data-create-resource-focusable="true"
          >
            <CloseIcon />
          </button>
        </div>

        {hasCluster ? (
          <>
            {/* Context bar: direct child of modal-container for full width */}
            <div className="create-resource-context-bar">
              <div className="create-resource-dropdown-field">
                <span className="create-resource-dropdown-label">Cluster</span>
                {isEditMode ? (
                  <span className="create-resource-context-value">
                    {targetClusterName || targetClusterId}
                  </span>
                ) : (
                  <Dropdown
                    options={clusterOptions}
                    value={targetClusterId}
                    onChange={(v) => setTargetClusterId(Array.isArray(v) ? (v[0] ?? '') : v)}
                    placeholder="Select cluster"
                    size="compact"
                    ariaLabel="Target cluster"
                  />
                )}
              </div>
              <div className="create-resource-dropdown-field">
                <span className="create-resource-dropdown-label">Kind</span>
                {isEditMode && editIdentity ? (
                  <span className="create-resource-context-value">{editIdentity.kind}</span>
                ) : (
                  <Dropdown
                    options={templateOptions}
                    value={selectedTemplate}
                    onChange={handleTemplateChange}
                    placeholder="Blank"
                    size="compact"
                    ariaLabel="Resource template"
                  />
                )}
              </div>
              <button
                type="button"
                className="button generic create-resource-view-toggle"
                onClick={() => {
                  if (yamlPanelOpen) {
                    handleYamlPanelClose();
                  } else {
                    setYamlPanelOpen(true);
                  }
                }}
                data-create-resource-focusable="true"
              >
                {yamlPanelOpen ? 'Hide YAML' : 'Show YAML'}
              </button>
            </div>

            {/* Middle area: form content + YAML panel side by side */}
            <div className="create-resource-middle" ref={middleRef}>
              <div className="modal-content create-resource-content">
                {/* Editor section — Form view or YAML CodeMirror */}
                {showingForm && formDefinition ? (
                  <div className="create-resource-editor">
                    <ResourceForm
                      definition={formDefinition}
                      yamlContent={yamlContent}
                      onYamlChange={handleYamlChange}
                      namespaceOptions={namespaceOptions}
                      onNamespaceChange={setSelectedNamespace}
                    />
                  </div>
                ) : (
                  <div className="create-resource-editor">
                    <CodeMirror
                      value={yamlContent}
                      height="100%"
                      editable={!isBusy}
                      basicSetup={{
                        highlightActiveLine: true,
                        highlightActiveLineGutter: true,
                        lineNumbers: true,
                        foldGutter: false,
                        searchKeymap: false,
                      }}
                      theme={codeMirrorTheme}
                      extensions={wrappedEditorExtensions}
                      onChange={handleYamlChange}
                    />
                  </div>
                )}

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
                {rawError && <div className="create-resource-validation-error">{rawError}</div>}
              </div>

              {/* YAML side panel — absolutely positioned inside .create-resource-middle */}
              {yamlPanelOpen && (
                <div
                  className={`yaml-panel ${yamlPanelClosing ? 'closing' : yamlPanelReady ? '' : 'opening'}`}
                  style={
                    yamlPanelClosing
                      ? { width: closingWidthRef.current }
                      : { width: effectivePanelWidth }
                  }
                  onAnimationEnd={handlePanelAnimationEnd}
                >
                  {/* Resize handle — only when panel overlays the form */}
                  {panelResizable && (
                    <div
                      className="yaml-panel-resize-handle"
                      onPointerDown={handleResizePointerDown}
                    />
                  )}
                  <div className="yaml-panel-toolbar">
                    <label className="yaml-panel-wrap-toggle">
                      <input
                        type="checkbox"
                        checked={yamlPanelWrap}
                        onChange={(event) => setYamlPanelWrap(event.target.checked)}
                      />
                      <span>Wrap</span>
                    </label>
                  </div>
                  <div className="yaml-panel-editor">
                    <CodeMirror
                      value={yamlContent}
                      height="100%"
                      editable={!isBusy}
                      basicSetup={{
                        highlightActiveLine: true,
                        highlightActiveLineGutter: true,
                        lineNumbers: true,
                        foldGutter: false,
                        searchKeymap: false,
                      }}
                      theme={codeMirrorTheme}
                      extensions={yamlPanelWrap ? wrappedEditorExtensions : baseEditorExtensions}
                      onChange={handleYamlChange}
                    />
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="modal-content create-resource-content">
            <div className="create-resource-no-cluster">
              No cluster connected. Connect to a cluster to create resources.
            </div>
          </div>
        )}

        <div className="modal-footer">
          <button
            className="button generic create-resource-footer-cancel"
            onClick={onClose}
            data-create-resource-focusable="true"
          >
            Cancel
          </button>
          {requiredFieldErrors.length > 0 && showingForm && (
            <span className="create-resource-required-errors">
              {requiredFieldErrors.join(', ')}
            </span>
          )}
          <button
            className="button generic"
            disabled={!hasTarget || isBusy || (showingForm && requiredFieldErrors.length > 0)}
            onClick={handleValidate}
            data-create-resource-focusable="true"
          >
            {isValidating ? 'Validating...' : 'Validate'}
          </button>
          <button
            className="button action"
            disabled={!hasTarget || isBusy || (showingForm && requiredFieldErrors.length > 0)}
            onClick={handleCreate}
            data-create-resource-focusable="true"
          >
            {isCreating
              ? isEditMode
                ? 'Saving...'
                : 'Creating...'
              : isEditMode
                ? 'Save'
                : 'Create'}
          </button>
        </div>
      </ModalSurface>
    );
  }
);

export default CreateResourceModal;
