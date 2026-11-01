/**
 * frontend/src/modules/kubernetes/config/KubeconfigContextLabel.tsx
 *
 * One kubeconfig context as a single row: the context name, a favorite-cluster
 * marker, an invalid marker, and the source file (muted) when it differs from
 * the context name. Shared by the Command Palette and the Save Favorite
 * cluster picker.
 */

import type { types } from '@core/backend-api/models';
import { FavoriteFilledIcon } from '@shared/components/icons/FavoriteIcons';
import './KubeconfigContextLabel.css';

type KubeconfigContextLabelProps = {
  config: Pick<types.KubeconfigInfo, 'name' | 'context' | 'invalid' | 'invalidReason'>;
  favorite?: boolean;
};

export const KubeconfigContextLabel = ({
  config,
  favorite = false,
}: Readonly<KubeconfigContextLabelProps>) => (
  <span className="kubeconfig-label">
    <span className="kubeconfig-label__context">{config.context}</span>
    {favorite ? (
      <span className="kubeconfig-label__favorite" role="img" aria-label="Favorite">
        <FavoriteFilledIcon width={12} height={12} />
      </span>
    ) : null}
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
