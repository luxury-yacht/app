import type { backend } from '@core/backend-api/models';

export type UpdateAction = 'check' | 'download' | 'restart' | 'recovery';

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
}

const DOWNLOADS_URL = 'https://luxury-yacht.app/#downloads';

const recoveryPresentation = (
  update: backend.UpdateInfo
): { explanation?: string; action: UpdatePresentationAction } => {
  const releaseURL = update.availableVersion
    ? `https://github.com/luxury-yacht/app/releases/tag/v${encodeURIComponent(update.availableVersion)}`
    : DOWNLOADS_URL;

  switch (update.eligibilityReason) {
    case 'mac-not-installed-bundle':
      return {
        explanation: 'Move Luxury Yacht to Applications to enable automatic updates.',
        action: { kind: 'recovery', label: 'View macOS Download', url: releaseURL },
      };
    case 'mac-read-only':
    case 'mac-unwritable-parent':
      return {
        explanation: 'This copy of Luxury Yacht cannot replace itself in its current location.',
        action: { kind: 'recovery', label: 'View macOS Download', url: releaseURL },
      };
    case 'windows-machine-scope':
      return {
        explanation:
          'This copy was installed for all users. Switch to the per-user installation to enable automatic updates.',
        action: { kind: 'recovery', label: 'Switch to Per-User Installation', url: DOWNLOADS_URL },
      };
    case 'windows-unverified-install':
      return {
        explanation:
          'This Windows installation cannot be verified as a supported per-user installation.',
        action: { kind: 'recovery', label: 'View Windows Download', url: releaseURL },
      };
    case 'linux-package-managed':
      return {
        explanation:
          'This installation is managed by your system package manager. Update it with that package manager or download the latest package.',
        action: { kind: 'recovery', label: 'View Linux Packages', url: DOWNLOADS_URL },
      };
    case 'linux-portable-ineligible':
      return {
        explanation: 'This portable installation cannot replace itself in its current location.',
        action: { kind: 'recovery', label: 'View Portable Download', url: releaseURL },
      };
    default:
      return {
        explanation: 'Automatic updates are not available for this installation.',
        action: { kind: 'recovery', label: 'View Download Options', url: DOWNLOADS_URL },
      };
  }
};

export const getUpdatePresentation = (update: backend.UpdateInfo): UpdatePresentation | null => {
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
      return { message: 'Luxury Yacht is up to date.' };
    case 'available':
      return update.canInstall
        ? {
            message: `Luxury Yacht ${version} is available.`,
            primary: { kind: 'download', label: 'Download Update' },
          }
        : {
            message: `Luxury Yacht ${version} is available.`,
            explanation: recovery.explanation,
            primary: recovery.action,
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
        explanation: recovery.explanation,
        primary: recovery.action,
      };
    default:
      return null;
  }
};
