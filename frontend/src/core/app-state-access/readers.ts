import {
  GetAllClusterAuthStates,
  GetAppInfo,
  GetAppSettings,
  GetAppSettingsSchema,
  GetKubeconfigSearchPaths,
  GetKubeconfigs,
  GetAppLogs,
  GetAppLogsSince,
  GetSelectedKubeconfigs,
  GetShellSessionBacklog,
  GetThemes,
  GetZoomLevel,
  ListRuntimeOperations,
  ListPortForwards,
  ListShellSessions,
} from '@wailsjs/go/backend/App';

export const readKubeconfigs = () => GetKubeconfigs();
export const readSelectedKubeconfigs = () => GetSelectedKubeconfigs();
export const readAppSettings = () => GetAppSettings();
export const readAppSettingsSchema = () => GetAppSettingsSchema();
export const readThemes = () => GetThemes();
export const readAllClusterAuthStates = () => GetAllClusterAuthStates();
export const readZoomLevel = () => GetZoomLevel();
export const readKubeconfigSearchPaths = () => GetKubeconfigSearchPaths();
export const readAppInfo = () => GetAppInfo();
export const readAppLogs = () => GetAppLogs();
export const readAppLogsSince = (sequence: number) => GetAppLogsSince(sequence);
export const readPortForwardSessions = () => ListPortForwards();
export const readRuntimeOperations = () => ListRuntimeOperations();
export const readShellSessions = () => ListShellSessions();
export const readShellSessionBacklog = (sessionId: string) => GetShellSessionBacklog(sessionId);

export const readAllClusterLifecycleStates = async (): Promise<Record<string, string> | null> => {
  const runtimeApp = (window as any)?.go?.backend?.App;
  if (typeof runtimeApp?.GetAllClusterLifecycleStates !== 'function') {
    return null;
  }
  return runtimeApp.GetAllClusterLifecycleStates();
};
