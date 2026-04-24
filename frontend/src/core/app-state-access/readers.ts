import {
  GetAllClusterAuthStates,
  GetAppInfo,
  GetAppSettings,
  GetKubeconfigSearchPaths,
  GetKubeconfigs,
  GetAppLogs,
  GetSelectedKubeconfigs,
  GetShellSessionBacklog,
  GetThemeInfo,
  GetThemes,
  GetZoomLevel,
  GetClusterPortForwardCount,
  ListPortForwards,
  ListShellSessions,
} from '@wailsjs/go/backend/App';

export const readKubeconfigs = () => GetKubeconfigs();
export const readSelectedKubeconfigs = () => GetSelectedKubeconfigs();
export const readAppSettings = () => GetAppSettings();
export const readThemes = () => GetThemes();
export const readAllClusterAuthStates = () => GetAllClusterAuthStates();
export const readZoomLevel = () => GetZoomLevel();
export const readThemeInfo = () => GetThemeInfo();
export const readKubeconfigSearchPaths = () => GetKubeconfigSearchPaths();
export const readAppInfo = () => GetAppInfo();
export const readAppLogs = () => GetAppLogs();
export const readPortForwardSessions = () => ListPortForwards();
export const readShellSessions = () => ListShellSessions();
export const readShellSessionBacklog = (sessionId: string) => GetShellSessionBacklog(sessionId);
export const readClusterPortForwardCount = (selection: string) =>
  GetClusterPortForwardCount(selection);
export const readAllClusterLifecycleStates = async (): Promise<Record<string, string> | null> => {
  const runtimeApp = (window as any)?.go?.backend?.App;
  if (typeof runtimeApp?.GetAllClusterLifecycleStates !== 'function') {
    return null;
  }
  return runtimeApp.GetAllClusterLifecycleStates();
};
