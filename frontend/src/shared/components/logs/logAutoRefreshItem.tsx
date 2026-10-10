/**
 * frontend/src/shared/components/logs/logAutoRefreshItem.tsx
 *
 * The log views' auto-refresh button, first in their icon bars, toggled by R.
 */

import './logAutoRefreshItem.css';
import type { IconBarItem } from '@shared/components/IconBar/IconBar';
import { PlayOutlineIcon, StopOutlineIcon } from '@shared/components/icons/SharedIcons';

export const buildLogAutoRefreshItem = (
  autoRefresh: boolean,
  onToggle: () => void
): IconBarItem => ({
  // Like the other choice buttons it is never highlighted: the icon and name say what a click does.
  type: 'action',
  id: 'autoRefresh',
  // The icon shows what a click does: stop while refreshing, play while stopped.
  icon: autoRefresh ? (
    <StopOutlineIcon width={18} height={18} className="log-auto-refresh-stop-icon" />
  ) : (
    <PlayOutlineIcon width={18} height={18} className="log-auto-refresh-play-icon" />
  ),
  onClick: onToggle,
  title: `${autoRefresh ? 'Stop' : 'Start'} auto-refresh (R)`,
  ariaLabel: `${autoRefresh ? 'Stop' : 'Start'} auto-refresh`,
});
