/**
 * frontend/src/shared/components/modals/useDrainOptionsForm.ts
 *
 * The drain options a user picks, shared by the single-node and batch drain
 * dialogs.
 */

import { useCallback, useState } from 'react';
import {
  DEFAULT_NODE_DRAIN_TIMEOUT_SECONDS,
  type DrainOptionsState,
  hasPositiveDrainOption,
} from './drainNodeModalModel';

export const useDrainOptionsForm = (onChange?: () => void) => {
  const [options, setOptions] = useState<DrainOptionsState>({
    ignoreDaemonSets: true,
    deleteEmptyDirData: true,
    force: false,
    disableEviction: false,
    skipWaitForPodsToTerminate: false,
  });
  const [customGraceSeconds, setCustomGraceSeconds] = useState(30);
  const [customTimeoutSeconds, setCustomTimeoutSeconds] = useState(
    DEFAULT_NODE_DRAIN_TIMEOUT_SECONDS
  );

  const updateDrainOption = useCallback(
    <K extends keyof DrainOptionsState>(field: K, value: DrainOptionsState[K]) => {
      setOptions((previous) => ({ ...previous, [field]: value }));
      onChange?.();
    },
    [onChange]
  );

  return {
    options,
    customGraceSeconds,
    customTimeoutSeconds,
    setCustomGraceSeconds,
    setCustomTimeoutSeconds,
    updateDrainOption,
    hasCustomGrace: hasPositiveDrainOption(options.gracePeriodSeconds),
    hasCustomTimeout: hasPositiveDrainOption(options.timeoutSeconds),
  };
};
