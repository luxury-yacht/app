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

export type ClusterRuntimeOperationSummary = {
  total: number;
  shells: number;
  portForwards: number;
  drains: number;
  other: number;
};

export const readClusterRuntimeOperationSummary = async (
  clusterId: string
): Promise<ClusterRuntimeOperationSummary> => {
  const operations = (await ListRuntimeOperations()).filter(
    (operation) => operation.clusterId === clusterId
  );
  return operations.reduce<ClusterRuntimeOperationSummary>(
    (summary, operation) => {
      summary.total += 1;
      switch (operation.type) {
        case 'shell':
          summary.shells += 1;
          break;
        case 'port-forward':
          summary.portForwards += 1;
          break;
        case 'drain':
          summary.drains += 1;
          break;
        default:
          summary.other += 1;
          break;
      }
      return summary;
    },
    { total: 0, shells: 0, portForwards: 0, drains: 0, other: 0 }
  );
};
export const readAllClusterLifecycleStates = async (): Promise<Record<string, string> | null> => {
  const runtimeApp = (window as any)?.go?.backend?.App;
  if (typeof runtimeApp?.GetAllClusterLifecycleStates !== 'function') {
    return null;
  }
  return runtimeApp.GetAllClusterLifecycleStates();
};
