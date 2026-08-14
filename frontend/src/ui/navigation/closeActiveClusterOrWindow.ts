import { closeWindow } from '@core/desktop-runtime';

interface CloseActiveClusterOrWindowOptions {
  selectedKubeconfig: string;
  selectedKubeconfigs: readonly string[];
  closeKubeconfig: (selectionOrClusterId: string) => Promise<void>;
}

export async function closeActiveClusterOrWindow({
  selectedKubeconfig,
  selectedKubeconfigs,
  closeKubeconfig,
}: CloseActiveClusterOrWindowOptions): Promise<void> {
  if (selectedKubeconfigs.length === 0) {
    await closeWindow();
    return;
  }
  if (!selectedKubeconfig || !selectedKubeconfigs.includes(selectedKubeconfig)) {
    return;
  }
  await closeKubeconfig(selectedKubeconfig);
}
