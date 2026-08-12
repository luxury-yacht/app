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
export const readThemes = async () => (await GetThemes()) ?? [];
export const readZoomLevel = () => GetZoomLevel();
export const readKubeconfigSearchPaths = async () => (await GetKubeconfigSearchPaths()) ?? [];
export const readAppInfo = () => GetAppInfo();
export const readAppLogs = async () => (await GetAppLogs()) ?? [];
export const readAppLogsSince = async (sequence: number) => (await GetAppLogsSince(sequence)) ?? [];
export const readPortForwardSessions = async () => (await ListPortForwards()) ?? [];
export const readRuntimeOperations = async () => (await ListRuntimeOperations()) ?? [];
export const readShellSessions = async () =>
  ((await ListShellSessions()) ?? []).map((session) => ({
    ...session,
    command: session.command ?? [],
  }));
export const readShellSessionBacklog = (sessionId: string) => GetShellSessionBacklog(sessionId);
