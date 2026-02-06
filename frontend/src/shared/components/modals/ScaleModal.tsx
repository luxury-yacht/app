/**
 * frontend/src/shared/components/modals/ScaleModal.tsx
 *
 * Shared modal component for scaling Kubernetes workloads.
 * Used by both the workloads table context menu and the object panel actions menu.
 */

import './ScaleModal.css';

interface ScaleModalProps {
  isOpen: boolean;
  kind: string;
  name?: string;
  namespace?: string;
  value: number;
  loading?: boolean;
  error?: string | null;
  onCancel: () => void;
  onApply: () => void;
  onValueChange: (value: number) => void;
}

const ScaleModal = ({
  isOpen,
  kind,
  name,
  namespace,
  value,
  loading = false,
  error,
  onCancel,
  onApply,
  onValueChange,
}: ScaleModalProps) => {
  if (!isOpen) {
    return null;
  }

  const handleIncrement = (delta: number) => {
    const newValue = Math.max(0, Math.min(9999, value + delta));
    onValueChange(newValue);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const parsed = parseInt(e.target.value, 10);
    onValueChange(Number.isNaN(parsed) ? 0 : parsed);
  };

  return (
    <div className="modal-overlay">
      <div className="modal-container scale-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Scale {kind}</h2>
        </div>
        <div className="scale-modal-body">
          <div className="scale-modal-fields">
            {namespace && (
              <>
                <label className="scale-modal-label">Namespace:</label>
                <span className="scale-modal-value">{namespace}</span>
              </>
            )}
            {name && (
              <>
                <label className="scale-modal-label">{kind || 'Workload'}:</label>
                <span className="scale-modal-value">{name}</span>
              </>
            )}
            <label className="scale-modal-label" htmlFor="scale-replicas">
              Replicas:
            </label>
            <div className="scale-input-group">
              <button
                className="scale-spinner-btn"
                type="button"
                onClick={() => handleIncrement(-1)}
                disabled={value === 0 || loading}
              >
                −
              </button>
              <input
                id="scale-replicas"
                type="number"
                min={0}
                max={9999}
                value={value}
                onChange={handleInputChange}
                className="scale-input"
                disabled={loading}
              />
              <button
                className="scale-spinner-btn"
                type="button"
                onClick={() => handleIncrement(1)}
                disabled={value >= 9999 || loading}
              >
                +
              </button>
            </div>
          </div>
        </div>
        {error && <div className="scale-modal-error">{error}</div>}
        <div className="scale-modal-footer">
          <button className="button cancel" onClick={onCancel} disabled={loading}>
            Cancel
          </button>
          <button className="button warning" onClick={onApply} disabled={loading}>
            {loading ? 'Scaling…' : 'Scale'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ScaleModal;
