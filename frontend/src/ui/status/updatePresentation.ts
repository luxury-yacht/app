import type { backend } from '@core/backend-api/models';
import { toPlainReleaseNotes } from './releaseNotesText';

export type UpdateAction = 'check' | 'download' | 'restart' | 'skip' | 'remove-skip' | 'recovery';

export interface UpdatePresentationAction {
  kind: UpdateAction;
  label: string;
  url?: string;
}

export interface UpdatePresentation {
  message: string;
  explanation?: string;
  primary?: UpdatePresentationAction;
  secondary?: UpdatePresentationAction;
  /**
   * Short label for the header chip and the About card's status pill. Present
   * only for the states that need the user's attention — the quiet states
   * (disabled, checking, up to date, skipped) still have a `message` for About
   * but must not surface a chip in the header.
   */
  badge?: string;
  /**
   * Quiet line shown under the app version instead of a card. Used for the
   * up-to-date state and for a skipped release's compact remove-skip action.
   */
  versionNote?: string;
  /** Release identity, present only once a release has actually been discovered. */
  releaseTitle?: string;
  published?: string;
  notes?: string;
  releaseNotesURL?: string;
}

const DOWNLOADS_URL = 'https://luxury-yacht.app/#downloads';

const windowsMigrationURL = (update: backend.UpdateInfo): string =>
  update.availableVersion
    ? `https://luxury-yacht.app/windows/migrate?version=${encodeURIComponent(update.availableVersion)}`
    : DOWNLOADS_URL;

// Release tags carry the conventional `v` prefix; the backend normalizes it off
// the version it reports (internal/updateidentity ParseReleaseVersion), so it is
// re-added here rather than assumed present.
const releaseURL = (update: backend.UpdateInfo): string =>
  update.availableVersion
    ? `https://github.com/luxury-yacht/app/releases/tag/v${encodeURIComponent(update.availableVersion)}`
    : DOWNLOADS_URL;

const badgeForStatus = (status: backend.UpdateInfo['status']): { badge: string } | null => {
  switch (status) {
    case 'available':
      return { badge: 'Update available' };
    case 'downloading':
      return { badge: 'Downloading update…' };
    case 'verifying':
      return { badge: 'Verifying update…' };
    case 'preparing':
      return { badge: 'Preparing update…' };
    case 'ready':
      return { badge: 'Restart to update' };
    case 'check-error':
    case 'prepare-error':
    case 'restart-error':
    case 'apply-error':
      return { badge: 'Update needs attention' };
    default:
      return null;
  }
};

// Render the ISO publish date as YYYY-MM-DD from its UTC components (matches
// GitHub's UTC published_at and is timezone-stable); undefined when absent or
// unparseable so the surface simply omits the date.
const formatPublished = (iso?: string): string | undefined => {
  if (!iso) {
    return undefined;
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Release identity only exists once a release has been discovered; without a
// version there is no tag page to link and no release to title.
const releaseDetails = (update: backend.UpdateInfo): Partial<UpdatePresentation> => {
  if (!update.availableVersion) {
    return {};
  }
  const notes = toPlainReleaseNotes(update.releaseNotes ?? '');
  return {
    releaseTitle: update.releaseName || `Luxury Yacht ${update.availableVersion}`,
    published: formatPublished(update.publishedAt),
    notes: notes || undefined,
    releaseNotesURL: releaseURL(update),
  };
};

const recoveryActionForTarget = (
  update: backend.UpdateInfo
): UpdatePresentationAction | undefined => {
  switch (update.recoveryTarget) {
    case 'mac-download':
      return { kind: 'recovery', label: 'View macOS Download', url: releaseURL(update) };
    case 'windows-download':
      return { kind: 'recovery', label: 'View Windows Download', url: releaseURL(update) };
    case 'windows-per-user-migration':
      return {
        kind: 'recovery',
        label: 'Switch to Per-User Installation',
        url: windowsMigrationURL(update),
      };
    case 'linux-packages':
      return { kind: 'recovery', label: 'View Linux Packages', url: DOWNLOADS_URL };
    case 'linux-portable-download':
      return { kind: 'recovery', label: 'View Portable Download', url: releaseURL(update) };
    case 'download-options':
      return { kind: 'recovery', label: 'View Download Options', url: DOWNLOADS_URL };
    default:
      return undefined;
  }
};

const recoveryPresentation = (
  update: backend.UpdateInfo
): { explanation?: string; action: UpdatePresentationAction } => {
  const targetAction = recoveryActionForTarget(update);

  const action = (fallback: UpdatePresentationAction): UpdatePresentationAction =>
    targetAction ?? fallback;

  switch (update.eligibilityReason) {
    case 'mac-not-installed-bundle':
      return {
        explanation: 'Move Luxury Yacht to Applications to enable automatic updates.',
        action: action({ kind: 'recovery', label: 'View macOS Download', url: releaseURL(update) }),
      };
    case 'mac-read-only':
    case 'mac-unwritable-parent':
      return {
        explanation: 'This copy of Luxury Yacht cannot replace itself in its current location.',
        action: action({ kind: 'recovery', label: 'View macOS Download', url: releaseURL(update) }),
      };
    case 'windows-machine-scope':
      return {
        explanation:
          'This copy was installed for all users. Switch to the per-user installation to enable automatic updates.',
        action: action({
          kind: 'recovery',
          label: 'Switch to Per-User Installation',
          url: windowsMigrationURL(update),
        }),
      };
    case 'windows-unverified-install':
      return {
        explanation:
          'This Windows installation cannot be verified as a supported per-user installation.',
        action: action({
          kind: 'recovery',
          label: 'View Windows Download',
          url: releaseURL(update),
        }),
      };
    case 'linux-package-managed':
      return {
        explanation:
          'This installation is managed by your system package manager. Update it with that package manager or download the latest package.',
        action: action({ kind: 'recovery', label: 'View Linux Packages', url: DOWNLOADS_URL }),
      };
    case 'linux-portable-ineligible':
      return {
        explanation: 'This portable installation cannot replace itself in its current location.',
        action: action({
          kind: 'recovery',
          label: 'View Portable Download',
          url: releaseURL(update),
        }),
      };
    default:
      return {
        explanation: 'Automatic updates are not available for this installation.',
        action: action({ kind: 'recovery', label: 'View Download Options', url: DOWNLOADS_URL }),
      };
  }
};

export const getUpdatePresentation = (update: backend.UpdateInfo): UpdatePresentation | null => {
  const core = getUpdateCopy(update);
  if (!core) {
    return null;
  }
  return { ...core, ...badgeForStatus(update.status), ...releaseDetails(update) };
};

const getUpdateCopy = (update: backend.UpdateInfo): UpdatePresentation | null => {
  const version = update.availableVersion || 'the latest version';
  const recovery = recoveryPresentation(update);

  switch (update.status) {
    case 'disabled':
      return { message: 'Automatic updates are unavailable in this build.' };
    case 'idle':
      return null;
    case 'checking':
      return { message: 'Checking for updates…' };
    case 'current':
      return {
        message: 'Luxury Yacht is up to date.',
        versionNote: 'no newer version is available',
      };
    case 'skipped':
      return {
        message: `${version} is available, but has been skipped`,
        versionNote: `${version} is available, but has been skipped`,
        primary: { kind: 'remove-skip', label: 'Undo Skip' },
      };
    case 'available':
      return update.canInstall
        ? {
            message: `Luxury Yacht ${version} is available.`,
            primary: { kind: 'download', label: 'Download Update' },
            secondary: { kind: 'skip', label: 'Skip This Version' },
          }
        : {
            message: `Luxury Yacht ${version} is available.`,
            explanation: recovery.explanation,
            primary: recovery.action,
            secondary: { kind: 'skip', label: 'Skip This Version' },
          };
    case 'downloading':
      return { message: 'Downloading update…' };
    case 'verifying':
      return { message: 'Verifying update…' };
    case 'preparing':
      return { message: 'Preparing update…' };
    case 'ready':
      return {
        message: `Luxury Yacht ${version} is ready to install.`,
        primary: { kind: 'restart', label: 'Restart & Apply' },
      };
    case 'check-error':
      return {
        message: 'Couldn’t check for updates.',
        primary: { kind: 'check', label: 'Check Again' },
      };
    case 'prepare-error':
      return {
        message: 'Couldn’t prepare the update.',
        primary: { kind: 'download', label: 'Retry Download' },
        secondary: recovery.action,
      };
    case 'restart-error':
      return {
        message: 'Couldn’t restart to apply the update.',
        primary: { kind: 'restart', label: 'Restart & Apply' },
      };
    case 'apply-error':
      return {
        message: `The update couldn’t be applied. Luxury Yacht is still on ${update.currentVersion}.`,
        primary: recoveryActionForTarget(update) ?? recovery.action,
      };
    default:
      return null;
  }
};
