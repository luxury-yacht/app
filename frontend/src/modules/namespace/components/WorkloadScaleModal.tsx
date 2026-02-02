/**
 * frontend/src/modules/namespace/components/WorkloadScaleModal.tsx
 *
 * UI component for WorkloadScaleModal.
 * Handles rendering and interactions for the namespace feature.
 */

import type { WorkloadData } from '@modules/namespace/components/NsViewWorkloads.helpers';

interface WorkloadScaleModalProps {
  scaleState: {
    show: boolean;
    workload: WorkloadData | null;
    value: number;
  };
  scaleLoading: boolean;
  scaleError: string | null;
  onCancel: () => void;
  onApply: () => void;
  onInputChange: (value: number) => void;
  onIncrement: (delta: number) => void;
}

const WorkloadScaleModal = ({
  scaleState,
  scaleLoading,
  scaleError,
  onCancel,
  onApply,
  onInputChange,
  onIncrement,
}: WorkloadScaleModalProps) => {
  if (!scaleState.show || !scaleState.workload) {
    return null;
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-container scale-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>
            Scale {scaleState.workload.kind} {scaleState.workload.name}
          </h2>
        </div>
        <div className="scale-modal-body">
          <label htmlFor="namespace-scale-replicas">Replicas</label>
          <div className="scale-input-group">
            <button
              className="scale-spinner-btn"
              type="button"
              onClick={() => onIncrement(-1)}
              disabled={scaleState.value === 0 || scaleLoading}
            >
              −
            </button>
            <input
              id="namespace-scale-replicas"
              type="number"
              min={0}
              max={9999}
              value={scaleState.value}
              onChange={(event) => {
                const parsed = parseInt(event.target.value, 10);
                onInputChange(Number.isNaN(parsed) ? 0 : parsed);
              }}
              className="scale-input"
              autoFocus
              disabled={scaleLoading}
            />
            <button
              className="scale-spinner-btn"
              type="button"
              onClick={() => onIncrement(1)}
              disabled={scaleState.value >= 9999 || scaleLoading}
            >
              +
            </button>
          </div>
        </div>
        {scaleError && <div className="scale-modal-error">{scaleError}</div>}
        <div className="scale-modal-footer">
          <button className="button cancel" onClick={onCancel} disabled={scaleLoading}>
            Cancel
          </button>
          <button className="button warning" onClick={onApply} disabled={scaleLoading}>
            {scaleLoading ? 'Scaling…' : 'Scale'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default WorkloadScaleModal;
