/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Shell/ShellControlFields.tsx
 *
 * Image and shell fields shared by the pod debug-container and node shell controls.
 */

import { Dropdown, type DropdownOption } from '@shared/components/dropdowns/Dropdown';

type DropdownChange = (value: string | string[]) => void;

export const CUSTOM_OPTION_VALUE = '__custom__';

const SHELL_OPTIONS: DropdownOption[] = [
  { value: '/bin/sh', label: '/bin/sh' },
  { value: '/bin/bash', label: '/bin/bash' },
  { value: CUSTOM_OPTION_VALUE, label: 'Custom...' },
];

const DEBUG_IMAGE_OPTIONS: DropdownOption[] = [
  { value: 'busybox:latest', label: 'busybox:latest' },
  { value: 'alpine:latest', label: 'alpine:latest' },
  { value: 'nicolaka/netshoot:latest', label: 'netshoot:latest' },
  { value: CUSTOM_OPTION_VALUE, label: 'Custom...' },
];

interface DebugImageFieldProps {
  debugImage: string;
  onDebugImageChange: DropdownChange;
  customImage: string;
  setCustomImage: (value: string) => void;
}

export function DebugImageField({
  debugImage,
  onDebugImageChange,
  customImage,
  setCustomImage,
}: Readonly<DebugImageFieldProps>) {
  return (
    <>
      <div className="shell-tab__control-label">Debug Image</div>
      <div className="shell-tab__control-input">
        <Dropdown
          options={DEBUG_IMAGE_OPTIONS}
          value={debugImage}
          onChange={onDebugImageChange}
          placeholder="Select image"
          ariaLabel="Debug container image"
        />
        {debugImage === CUSTOM_OPTION_VALUE && (
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
    </>
  );
}

interface ShellCommandFieldProps {
  commandOverride: string;
  onShellChange: DropdownChange;
  customShell: string;
  setCustomShell: (value: string) => void;
}

export function ShellCommandField({
  commandOverride,
  onShellChange,
  customShell,
  setCustomShell,
}: Readonly<ShellCommandFieldProps>) {
  return (
    <>
      <div className="shell-tab__control-label">Shell</div>
      <div className="shell-tab__control-input">
        <Dropdown
          options={SHELL_OPTIONS}
          value={commandOverride}
          onChange={onShellChange}
          placeholder="Select shell"
          ariaLabel="Shell command selector"
        />
        {commandOverride === CUSTOM_OPTION_VALUE && (
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
}
