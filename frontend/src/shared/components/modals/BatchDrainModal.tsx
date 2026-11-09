/**
 * frontend/src/shared/components/modals/BatchDrainModal.tsx
 *
 * One set of drain options for every node selected in batch-select mode. The
 * caller starts the drains; each node then has its own job and progress, as
 * after a single-node drain.
 */

import type { types } from '@core/backend-api/models';
import { DrainIcon } from '@shared/components/icons/SharedIcons';
import type { NodeDrainOperationPermissions } from '@shared/hooks/nodeActionPermissions';
import { useRef } from 'react';
import { DrainOptionsSection } from './DrainNodeModalView';
import { buildDrainOptionsPayload, resolveDrainStartPermissionReason } from './drainNodeModalModel';
import ModalHeader from './ModalHeader';
import ModalSurface from './ModalSurface';
import { useDrainOptionsForm } from './useDrainOptionsForm';
import { useModalFocusTrap } from './useModalFocusTrap';
import './DrainNodeModal.css';

interface BatchDrainModalProps {
  nodeNames: string[];
  clusterName?: string;
  /** Selected objects left out because they cannot be drained. */
  skipped: number;
  permissions: NodeDrainOperationPermissions;
  onClose: () => void;
  onStart: (options: types.DrainNodeOptions) => void;
}

const BatchDrainModal = ({
  nodeNames,
  clusterName,
  skipped,
  permissions,
  onClose,
  onStart,
}: BatchDrainModalProps) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const form = useDrainOptionsForm();
  useModalFocusTrap({
    ref: modalRef,
    onEscape: () => {
      onClose();
      return true;
    },
  });

  const permissionReason = resolveDrainStartPermissionReason(
    permissions,
    Boolean(form.options.disableEviction)
  );
  const count = nodeNames.length;

  return (
    <ModalSurface
      modalRef={modalRef}
      labelledBy="batch-drain-title"
      onClose={onClose}
      containerClassName="drain-node-modal"
      closeOnBackdrop={false}
    >
      <ModalHeader
        title={`Drain ${count} ${count === 1 ? 'Node' : 'Nodes'}`}
        titleId="batch-drain-title"
        icon={DrainIcon}
        onClose={onClose}
      />
      <div className="drain-node-modal-body">
        {!!clusterName && (
          <div className="drain-node-modal-target">
            <span className="drain-node-modal-label">Cluster:</span>
            <span className="drain-node-modal-value">{clusterName}</span>
          </div>
        )}
        <ul className="batch-drain-nodes">
          {nodeNames.map((name) => (
            <li key={name} title={name}>
              {name}
            </li>
          ))}
        </ul>
        {count > 1 && (
          <p className="batch-drain-warning">
            These nodes drain at the same time. Make sure the rest of the cluster has room for their
            pods.
          </p>
        )}
        {skipped > 0 && (
          <div className="drain-node-modal-helper">
            {skipped} selected {skipped === 1 ? 'object is' : 'objects are'} skipped: not available
            or not permitted.
          </div>
        )}
        <DrainOptionsSection activeDrainJob={null} drainPending={false} {...form} />
        {!!permissionReason && (
          <div className="drain-node-modal-helper" data-test="drain-modal-permission-reason">
            {permissionReason}
          </div>
        )}
      </div>
      <div className="modal-footer drain-node-modal-footer">
        <button type="button" className="button cancel" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="button danger"
          disabled={Boolean(permissionReason)}
          data-test="batch-drain-start"
          onClick={() => onStart(buildDrainOptionsPayload(form.options))}
        >
          Drain {count}
        </button>
      </div>
    </ModalSurface>
  );
};

export default BatchDrainModal;
