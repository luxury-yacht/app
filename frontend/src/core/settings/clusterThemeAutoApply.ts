/**
 * frontend/src/core/settings/clusterThemeAutoApply.ts
 *
 * Applies the saved theme that matches the currently selected cluster name.
 */

interface MatchingTheme {
  id: string;
}

interface AutoApplyClusterThemeOptions {
  selectedClusterName: string;
  isCurrent: () => boolean;
  matchThemeForCluster: (contextName: string) => Promise<MatchingTheme | null>;
  applyTheme: (id: string) => Promise<void>;
  hydrateAppPreferences: (options: { force: true }) => Promise<unknown>;
  applyAppearanceOverrides: () => void;
  onError?: (error: unknown) => void;
}

export const autoApplyClusterTheme = async ({
  selectedClusterName,
  isCurrent,
  matchThemeForCluster,
  applyTheme,
  hydrateAppPreferences,
  applyAppearanceOverrides,
  onError,
}: AutoApplyClusterThemeOptions): Promise<void> => {
  try {
    const matched = await matchThemeForCluster(selectedClusterName);
    if (!isCurrent() || !matched) {
      return;
    }

    await applyTheme(matched.id);
    if (!isCurrent()) {
      return;
    }

    await hydrateAppPreferences({ force: true });
    if (!isCurrent()) {
      return;
    }

    applyAppearanceOverrides();
  } catch (error) {
    if (isCurrent()) {
      onError?.(error);
    }
  }
};
