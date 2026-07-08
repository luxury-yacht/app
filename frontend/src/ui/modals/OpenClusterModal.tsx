/**
 * frontend/src/ui/modals/OpenClusterModal.tsx
 *
 * Modal for opening cluster tabs from the "+" affordance in the cluster tab bar.
 *
 * Slice 1 is the shell (header + Cancel + focus trap). A later slice fills the
 * body with the directory → file → context tree and "Add Directory" control and
 * absorbs the Settings → Kubeconfigs functionality (see docs/plans/cluster-tabs.md).
 */
import React, { useRef } from 'react';
import { useModalFocusTrap } from '@shared/components/modals/useModalFocusTrap';
import ModalSurface from '@shared/components/modals/ModalSurface';
import ModalHeader from '@shared/components/modals/ModalHeader';
import { ClusterResourcesIcon } from '@shared/components/icons/SharedIcons';
import './OpenClusterModal.css';

interface OpenClusterModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const OpenClusterModalContent: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const modalRef = useRef<HTMLDivElement>(null);

  useModalFocusTrap({
    ref: modalRef,
    onEscape: () => {
      onClose();
      return true;
    },
  });

  return (
    <ModalSurface
      modalRef={modalRef}
      labelledBy="open-cluster-modal-title"
      onClose={onClose}
      containerClassName="open-cluster-modal"
      closeOnBackdrop
    >
      <ModalHeader
        title="Open Cluster"
        titleId="open-cluster-modal-title"
        icon={ClusterResourcesIcon}
        onClose={onClose}
      />
      <div className="open-cluster-modal__body">
        {/* Placeholder — the directory → file → context picker lands in a later slice. */}
        <p className="open-cluster-modal__placeholder">Cluster picker coming soon.</p>
      </div>
      <div className="open-cluster-modal__footer">
        <button type="button" className="button cancel" onClick={onClose}>
          Cancel
        </button>
      </div>
    </ModalSurface>
  );
};

const OpenClusterModal: React.FC<OpenClusterModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) {
    return null;
  }
  return <OpenClusterModalContent onClose={onClose} />;
};

export default OpenClusterModal;
