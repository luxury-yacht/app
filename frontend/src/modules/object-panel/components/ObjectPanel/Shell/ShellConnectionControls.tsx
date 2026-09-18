import { Dropdown, type DropdownOption } from '@shared/components/dropdowns/Dropdown';
import Tooltip from '@shared/components/Tooltip';
import { useId, useMemo } from 'react';

type DropdownChange = (value: string | string[]) => void;
interface ShellConnectionControlsProps {
  startDebugContainer: boolean;
  setStartDebugContainer: (enabled: boolean) => void;
  debugImage: string;
  handleDebugImageChange: DropdownChange;
  customImage: string;
  setCustomImage: (value: string) => void;
  containerOptions: DropdownOption[];
  debugTarget: string | null;
  handleDebugTargetChange: DropdownChange;
  commandOverride: string;
  handleShellChange: DropdownChange;
  customShell: string;
  setCustomShell: (value: string) => void;
  activeContainer: string;
  handleContainerChange: DropdownChange;
  handleDebug: () => void;
  handleReconnect: () => void;
  debugCreating: boolean;
  resolvedDebugImage: string;
  debugDisabledReason: string | undefined;
  disabledReason: string | undefined;
}

export default function ShellConnectionControls({
  startDebugContainer,
  setStartDebugContainer,
  debugImage,
  handleDebugImageChange,
  customImage,
  setCustomImage,
  containerOptions,
  debugTarget,
  handleDebugTargetChange,
  commandOverride,
  handleShellChange,
  customShell,
  setCustomShell,
  activeContainer,
  handleContainerChange,
  handleDebug,
  handleReconnect,
  debugCreating,
  resolvedDebugImage,
  debugDisabledReason,
  disabledReason,
}: Readonly<ShellConnectionControlsProps>) {
  const elementIdPrefix = useId();
  const shellDropdownMenuClassName = 'shell-tab__dropdown-menu';
  const shellOptions = useMemo<DropdownOption[]>(
    () => [
      { value: '/bin/sh', label: '/bin/sh' },
      { value: '/bin/bash', label: '/bin/bash' },
      { value: '__custom__', label: 'Custom...' },
    ],
    []
  );
  const debugImageOptions = useMemo<DropdownOption[]>(
    () => [
      { value: 'busybox:latest', label: 'busybox:latest' },
      { value: 'alpine:latest', label: 'alpine:latest' },
      { value: 'nicolaka/netshoot:latest', label: 'netshoot:latest' },
      { value: '__custom__', label: 'Custom...' },
    ],
    []
  );

  const shellCommandFields = (
    <>
      <div className="shell-tab__control-label">Shell</div>
      <div className="shell-tab__control-input">
        <Dropdown
          options={shellOptions}
          value={commandOverride}
          onChange={handleShellChange}
          size="compact"
          dropdownClassName={shellDropdownMenuClassName}
          placeholder="Select shell"
          ariaLabel="Shell command selector"
        />
        {commandOverride === '__custom__' && (
          <input
            className="shell-tab__custom-image-input"
            type="text"
            value={customShell}
            onChange={(event) => setCustomShell(event.target.value)}
            placeholder="/path/to/shell"
            aria-label="Custom shell path"
          />
        )}
      </div>
    </>
  );
  let connectionButtonLabel = 'Connect';
  if (startDebugContainer) {
    connectionButtonLabel = debugCreating ? 'Creating...' : 'Start';
  }

  return (
    <div className="shell-tab__toolbar">
      <div className="shell-tab__controls">
        <label
          className="shell-tab__debug-toggle"
          htmlFor={`${elementIdPrefix}-shell-tab-debug-toggle`}
        >
          <input
            id={`${elementIdPrefix}-shell-tab-debug-toggle`}
            type="checkbox"
            checked={startDebugContainer}
            onChange={(event) => setStartDebugContainer(event.target.checked)}
          />
          <span>Start a debug container</span>
          <Tooltip
            content={
              <>
                Use a debug (ephemeral) container to troubleshoot a running pod when the existing
                containers have no shell.
                <br />
                <br />
                Debug containers persist for the lifetime of the pod and cannot be removed except by
                deleting the pod.
              </>
            }
            placement="bottom"
          />
        </label>
        <div className="shell-tab__controls-grid">
          {startDebugContainer ? (
            <>
              <div className="shell-tab__control-label">Debug Image</div>
              <div className="shell-tab__control-input">
                <Dropdown
                  options={debugImageOptions}
                  value={debugImage}
                  onChange={handleDebugImageChange}
                  size="compact"
                  dropdownClassName={shellDropdownMenuClassName}
                  placeholder="Select image"
                  ariaLabel="Debug container image"
                />
                {debugImage === '__custom__' && (
                  <input
                    className="shell-tab__custom-image-input"
                    type="text"
                    value={customImage}
                    onChange={(event) => setCustomImage(event.target.value)}
                    placeholder="image:tag"
                    aria-label="Custom debug image"
                  />
                )}
              </div>
              <div className="shell-tab__control-label">Target Container</div>
              <div className="shell-tab__control-input">
                <Dropdown
                  options={containerOptions}
                  value={debugTarget || containerOptions[0]?.value || ''}
                  onChange={handleDebugTargetChange}
                  size="compact"
                  dropdownClassName={shellDropdownMenuClassName}
                  placeholder="Target container"
                  ariaLabel="Target container for process sharing"
                />
              </div>
              {shellCommandFields}
            </>
          ) : (
            <>
              <div className="shell-tab__control-label">Container</div>
              <div className="shell-tab__control-input">
                <Dropdown
                  options={containerOptions}
                  value={activeContainer || containerOptions[0]?.value || ''}
                  onChange={handleContainerChange}
                  size="compact"
                  dropdownClassName={shellDropdownMenuClassName}
                  placeholder="Containers unavailable"
                  ariaLabel="Shell container selector"
                />
              </div>
              {shellCommandFields}
            </>
          )}
        </div>
        <button
          type="button"
          className={`button generic ${
            startDebugContainer ? 'shell-tab__debug-button' : 'shell-tab__button'
          }`}
          onClick={startDebugContainer ? handleDebug : handleReconnect}
          disabled={
            startDebugContainer
              ? debugCreating || !resolvedDebugImage || !!debugDisabledReason || !!disabledReason
              : false
          }
        >
          {connectionButtonLabel}
        </button>
      </div>
    </div>
  );
}
