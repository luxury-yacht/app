import { Dropdown, type DropdownOption } from '@shared/components/dropdowns/Dropdown';
import Tooltip from '@shared/components/Tooltip';
import { useId } from 'react';
import { DebugImageField, ShellCommandField } from './ShellControlFields';

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
  const shellCommandFields = (
    <ShellCommandField
      commandOverride={commandOverride}
      onShellChange={handleShellChange}
      customShell={customShell}
      setCustomShell={setCustomShell}
    />
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
              <DebugImageField
                debugImage={debugImage}
                onDebugImageChange={handleDebugImageChange}
                customImage={customImage}
                setCustomImage={setCustomImage}
              />
              <div className="shell-tab__control-label">Target Container</div>
              <div className="shell-tab__control-input">
                <Dropdown
                  options={containerOptions}
                  value={debugTarget || containerOptions[0]?.value || ''}
                  onChange={handleDebugTargetChange}
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
