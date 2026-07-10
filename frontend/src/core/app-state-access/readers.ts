import {
  GetAllClusterAuthStates,
  GetAppInfo,
  GetAppLogs,
  GetAppLogsSince,
  GetAppSettings,
  GetAppSettingsSchema,
  GetKubeconfigSearchPaths,
  GetKubeconfigs,
  GetSelectedKubeconfigs,
  GetShellSessionBacklog,
  GetThemes,
  GetZoomLevel,
  ListPortForwards,
  ListRuntimeOperations,
  ListShellSessions,
} from '@/core/backend-api';

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
  const runtimeApp = window.go?.backend?.App;
  if (typeof runtimeApp?.GetAllClusterLifecycleStates !== 'function') {
    return null;
  }
  return runtimeApp.GetAllClusterLifecycleStates();
};
