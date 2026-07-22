import {
  GetAppInfo,
  GetAppLogs,
  GetAppLogsSince,
  GetAppSettings,
  GetAppSettingsSchema,
  GetKubeconfigSearchPaths,
  GetKubeconfigs,
  GetShellSessionBacklog,
  GetThemes,
  GetZoomLevel,
  ListPortForwards,
  ListRuntimeOperations,
  ListShellSessions,
} from '@/core/backend-api';

export const readKubeconfigs = () => GetKubeconfigs();
export const readAppSettings = () => GetAppSettings();
export const readAppSettingsSchema = () => GetAppSettingsSchema();
export const readThemes = () => GetThemes();
export const readZoomLevel = () => GetZoomLevel();
export const readKubeconfigSearchPaths = () => GetKubeconfigSearchPaths();
export const readAppInfo = () => GetAppInfo();
export const readAppLogs = () => GetAppLogs();
export const readAppLogsSince = (sequence: number) => GetAppLogsSince(sequence);
export const readPortForwardSessions = () => ListPortForwards();
export const readRuntimeOperations = () => ListRuntimeOperations();
export const readShellSessions = () => ListShellSessions();
export const readShellSessionBacklog = (sessionId: string) => GetShellSessionBacklog(sessionId);
