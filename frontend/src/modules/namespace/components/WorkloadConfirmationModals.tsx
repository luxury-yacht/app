import ConfirmationModal from '@components/modals/ConfirmationModal';

import type { WorkloadData } from '@modules/namespace/components/NsViewWorkloads.helpers';

export interface SimplePod {
  kind: string;
  name: string;
  namespace: string;
  ownerKind?: string;
  ownerName?: string;
  [key: string]: unknown;
}

interface WorkloadConfirmationModalsProps {
  podDeleteConfirm: { show: boolean; pod: SimplePod | null };
  podRestartConfirm: { show: boolean; pod: SimplePod | null };
  restartConfirm: { show: boolean; workload: WorkloadData | null };
  deleteConfirm: { show: boolean; workload: WorkloadData | null };
  onPodDeleteConfirm: () => void | Promise<void>;
  onPodRestartConfirm: () => void | Promise<void>;
  onRestartConfirm: () => void | Promise<void>;
  onDeleteConfirm: () => void | Promise<void>;
  dismissPodDelete: () => void;
  dismissPodRestart: () => void;
  dismissRestart: () => void;
  dismissDelete: () => void;
}

const WorkloadConfirmationModals = ({
  podDeleteConfirm,
  podRestartConfirm,
  restartConfirm,
  deleteConfirm,
  onPodDeleteConfirm,
  onPodRestartConfirm,
  onRestartConfirm,
  onDeleteConfirm,
  dismissPodDelete,
  dismissPodRestart,
  dismissRestart,
  dismissDelete,
}: WorkloadConfirmationModalsProps) => (
  <>
    <ConfirmationModal
      isOpen={podDeleteConfirm.show}
      title="Delete Pod"
      message={`Are you sure you want to delete pod "${podDeleteConfirm.pod?.name}"?\n\nThis action cannot be undone.`}
      confirmText="Delete"
      cancelText="Cancel"
      confirmButtonClass="danger"
      onConfirm={onPodDeleteConfirm}
      onCancel={dismissPodDelete}
    />

    <ConfirmationModal
      isOpen={podRestartConfirm.show}
      title={`Restart ${podRestartConfirm.pod?.ownerKind || 'Workload'}`}
      message={`Are you sure you want to restart ${podRestartConfirm.pod?.ownerKind?.toLowerCase() ?? 'workload'} "${podRestartConfirm.pod?.ownerName}"?\n\nThis will perform a rolling restart of all pods.`}
      confirmText="Restart"
      cancelText="Cancel"
      confirmButtonClass="primary"
      onConfirm={onPodRestartConfirm}
      onCancel={dismissPodRestart}
    />

    <ConfirmationModal
      isOpen={restartConfirm.show}
      title={`Restart ${restartConfirm.workload?.kind || 'Workload'}`}
      message={`Are you sure you want to restart ${restartConfirm.workload?.kind.toLowerCase()} "${restartConfirm.workload?.name}"?\n\nThis will cause all pods to be recreated.`}
      confirmText="Restart"
      cancelText="Cancel"
      confirmButtonClass="warning"
      onConfirm={onRestartConfirm}
      onCancel={dismissRestart}
    />

    <ConfirmationModal
      isOpen={deleteConfirm.show}
      title={`Delete ${deleteConfirm.workload?.kind || 'Workload'}`}
      message={`Are you sure you want to delete ${deleteConfirm.workload?.kind.toLowerCase()} "${deleteConfirm.workload?.name}"?\n\nThis action cannot be undone.`}
      confirmText="Delete"
      cancelText="Cancel"
      confirmButtonClass="danger"
      onConfirm={onDeleteConfirm}
      onCancel={dismissDelete}
    />
  </>
);

export default WorkloadConfirmationModals;
