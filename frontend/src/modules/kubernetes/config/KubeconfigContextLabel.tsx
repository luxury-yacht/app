/**
 * frontend/src/modules/kubernetes/config/KubeconfigContextLabel.tsx
 *
 * One kubeconfig context as a single row: the context name, an invalid marker,
 * and the source file (muted) when it differs from the context name. Shared by
 * the Command Palette and the Save Favorite cluster picker.
 */

import type { types } from '@core/backend-api/models';
import './KubeconfigContextLabel.css';

type KubeconfigContextLabelProps = {
  config: Pick<types.KubeconfigInfo, 'name' | 'context' | 'invalid' | 'invalidReason'>;
};

export const KubeconfigContextLabel = ({ config }: Readonly<KubeconfigContextLabelProps>) => (
  <span className="kubeconfig-label">
    <span className="kubeconfig-label__context">{config.context}</span>
    {config.invalid ? (
      <span className="kubeconfig-label__invalid" title={config.invalidReason}>
        ⚠ invalid
      </span>
    ) : null}
    {config.name !== config.context ? (
      <span className="kubeconfig-label__file">{config.name}</span>
    ) : null}
  </span>
);
