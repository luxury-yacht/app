/**
 * frontend/src/shared/components/KubeconfigSelector.tsx
 *
 * UI component for KubeconfigSelector.
 * Handles rendering and interactions for the shared components.
 */

import React from 'react';
import { types } from '@wailsjs/go/models';
import { Dropdown } from '@shared/components/dropdowns/Dropdown';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useKeyboardNavigationScope } from '@ui/shortcuts';
import { KeyboardScopePriority } from '@ui/shortcuts/priorities';
import './KubeconfigSelector.css';

type KubeconfigInfo = types.KubeconfigInfo;

function KubeconfigSelector() {
  const {
    kubeconfigs,
    selectedKubeconfigs,
    kubeconfigsLoading: loading,
    setSelectedKubeconfigs,
  } = useKubeconfig();
  const getDisplayName = (config: KubeconfigInfo) => {
    // Format: "filename [context]"
    const filename = config.name;
    const context = config.context;

    return `${filename} [${context}]`;
  };

  const getConfigValue = (config: KubeconfigInfo) => {
    // Create a unique identifier for each context: "path:context"
    return `${config.path}:${config.context}`;
  };

  const handleDropdownChange = (value: string | string[]) => {
    const selections = Array.isArray(value) ? value : value ? [value] : [];
    setSelectedKubeconfigs(selections);
  };

  const configByValue = React.useMemo(() => {
    const map = new Map<string, KubeconfigInfo>();
    kubeconfigs.forEach((config) => {
      map.set(`${config.path}:${config.context}`, config);
    });
    return map;
  }, [kubeconfigs]);

  const selectedContextNames = React.useMemo(() => {
    // Track active context names to disable duplicate selections.
    const contexts = new Set<string>();
    selectedKubeconfigs.forEach((selection) => {
      const contextName = configByValue.get(selection)?.context;
      if (contextName) {
        contexts.add(contextName);
      }
    });
    return contexts;
  }, [configByValue, selectedKubeconfigs]);

  // Track which configs are first in their group
  const filenameFirstOccurrence = new Set<string>();

  // Create dropdown options
  const dropdownOptions = kubeconfigs.map((config) => {
    const isFirstForFile = !filenameFirstOccurrence.has(config.name);
    if (isFirstForFile) {
      filenameFirstOccurrence.add(config.name);
    }

    const value = getConfigValue(config);
    const isSelected = selectedKubeconfigs.includes(value);
    const isDuplicateContext = Boolean(
      config.context && selectedContextNames.has(config.context) && !isSelected
    );

    return {
      value,
      label: getDisplayName(config),
      disabled: isDuplicateContext,
      metadata: {
        isFirstForFile,
        filename: config.name,
        context: config.context,
        isCurrentContext: config.isCurrentContext,
        isDuplicateContext,
      },
    };
  });

  const renderSelectedValue = (_value: string | string[]) => {
    return 'Select Kubeconfig';
  };

  const containerRef = React.useRef<HTMLDivElement | null>(null);
  useKeyboardNavigationScope({
    ref: containerRef,
    priority: KeyboardScopePriority.KUBECONFIG_SELECTOR,
    onEnter: () => {
      const trigger = containerRef.current?.querySelector<HTMLElement>('.dropdown-trigger');
      trigger?.focus();
    },
  });

  return (
    <div className="kubeconfig-selector" ref={containerRef}>
      <Dropdown
        options={dropdownOptions}
        value={selectedKubeconfigs}
        onChange={handleDropdownChange}
        loading={loading}
        placeholder="Select Kubeconfig"
        renderValue={renderSelectedValue}
        size="compact"
        multiple
        renderOption={(option, isSelected) => (
          <div
            className={`kubeconfig-option ${!option.metadata?.isFirstForFile ? 'no-filename' : ''} ${option.metadata?.isCurrentContext ? 'current-context' : ''}`}
            title={
              option.metadata?.isDuplicateContext
                ? `${option.metadata?.context} is already active. Duplicate context names are not allowed.`
                : undefined
            }
          >
            {option.metadata?.isFirstForFile && (
              <div className="kubeconfig-filename">{option.metadata.filename}</div>
            )}
            <div className="kubeconfig-context">
              {/* Match other multi-select dropdowns by showing a checkmark for selected entries. */}
              <span className="kubeconfig-check">{isSelected ? '✓' : ''}</span>
              <span className="kubeconfig-context-label">{option.metadata?.context}</span>
            </div>
          </div>
        )}
      />
    </div>
  );
}

export default React.memo(KubeconfigSelector);
