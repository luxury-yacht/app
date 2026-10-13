/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Shell/NodeShellControls.tsx
 *
 * Start controls for a node shell: the debug pod's image and shell.
 */

import Tooltip from '@shared/components/Tooltip';
import { DebugImageField, ShellCommandField } from './ShellControlFields';

type DropdownChange = (value: string | string[]) => void;

interface NodeShellControlsProps {
  debugImage: string;
  handleDebugImageChange: DropdownChange;
  customImage: string;
  setCustomImage: (value: string) => void;
  commandOverride: string;
  handleShellChange: DropdownChange;
  customShell: string;
  setCustomShell: (value: string) => void;
  onStart: () => void;
  resolvedDebugImage: string;
  disabledReason: string | undefined;
}

export default function NodeShellControls({
  debugImage,
  handleDebugImageChange,
  customImage,
  setCustomImage,
  commandOverride,
  handleShellChange,
  customShell,
  setCustomShell,
  onStart,
  resolvedDebugImage,
  disabledReason,
}: Readonly<NodeShellControlsProps>) {
  return (
    <div className="shell-tab__toolbar">
      <div className="shell-tab__controls">
        <div className="shell-tab__intro">
          <span>Node shell</span>
          <Tooltip
            content={
              <>
                Starts a privileged debug pod on this node in the default namespace, like kubectl
                debug node --profile=sysadmin. The pod shares the node&apos;s network, process, and
                IPC namespaces, and the node&apos;s filesystem is mounted at /host.
                <br />
                <br />
                Your RBAC permissions and the cluster&apos;s admission policies apply. The pod is
                deleted when the session ends.
              </>
            }
            placement="bottom"
          />
        </div>
        <div className="shell-tab__controls-grid">
          <DebugImageField
            debugImage={debugImage}
            onDebugImageChange={handleDebugImageChange}
            customImage={customImage}
            setCustomImage={setCustomImage}
          />
          <ShellCommandField
            commandOverride={commandOverride}
            onShellChange={handleShellChange}
            customShell={customShell}
            setCustomShell={setCustomShell}
          />
        </div>
        <button
          type="button"
          className="button generic shell-tab__debug-button"
          onClick={onStart}
          disabled={!resolvedDebugImage || !!disabledReason}
        >
          Start
        </button>
      </div>
    </div>
  );
}
