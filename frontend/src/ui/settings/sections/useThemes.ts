import { useCallback, useEffect, useState } from 'react';
import { types } from '@wailsjs/go/models';
import { errorHandler } from '@utils/errorHandler';
import {
  applyTheme as applyThemeApi,
  deleteTheme as deleteThemeApi,
  getThemes,
  reorderThemes,
  saveTheme,
  validateThemeClusterPattern,
} from '@/core/settings/appPreferences';

export function useThemes() {
  const [themes, setThemes] = useState<types.Theme[]>([]);
  const [themesLoading, setThemesLoading] = useState(false);

  const reloadThemes = useCallback(async () => {
    try {
      const result = await getThemes();
      setThemes(result);
    } catch (error) {
      errorHandler.handle(error, { action: 'loadThemes' });
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    const loadThemes = async () => {
      setThemesLoading(true);
      try {
        const result = await getThemes();
        if (mounted) {
          setThemes(result);
        }
      } catch (error) {
        errorHandler.handle(error, { action: 'loadThemes' });
      } finally {
        if (mounted) {
          setThemesLoading(false);
        }
      }
    };
    loadThemes();
    return () => {
      mounted = false;
    };
  }, []);

  const validateThemePattern = useCallback(async (pattern: string) => {
    try {
      return await validateThemeClusterPattern(pattern);
    } catch (error) {
      errorHandler.handle(error, { action: 'validateThemeClusterPattern' });
      return new types.ThemeClusterPatternValidationResult({
        valid: false,
        message: 'Unable to validate cluster pattern.',
      });
    }
  }, []);

  const saveThemeEntry = useCallback(
    async (theme: types.Theme) => {
      await saveTheme(theme);
      await reloadThemes();
    },
    [reloadThemes]
  );

  const deleteThemeEntry = useCallback(
    async (id: string) => {
      await deleteThemeApi(id);
      await reloadThemes();
    },
    [reloadThemes]
  );

  const reorderThemeEntries = useCallback(
    async (ids: string[]) => {
      await reorderThemes(ids);
      await reloadThemes();
    },
    [reloadThemes]
  );

  const applyThemeEntry = useCallback(async (id: string) => {
    await applyThemeApi(id);
  }, []);

  return {
    themes,
    themesLoading,
    reloadThemes,
    validateThemePattern,
    saveThemeEntry,
    deleteThemeEntry,
    reorderThemeEntries,
    applyThemeEntry,
  };
}
