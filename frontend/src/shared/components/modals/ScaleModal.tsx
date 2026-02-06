/**
 * frontend/src/shared/components/modals/ScaleModal.tsx
 *
 * Shared modal component for scaling Kubernetes workloads.
 * Used by both the workloads table context menu and the object panel actions menu.
 */

import { useState, useEffect, useRef } from 'react';
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
  // Local string state so the user can clear the field while typing.
  const [inputText, setInputText] = useState(String(value));

  // Sync from parent when the external value changes (e.g. spinner buttons).
  useEffect(() => {
    setInputText(String(value));
  }, [value]);

  // Track the replica count when the modal first opens so we can disable
  // the Scale button when the value hasn't changed.
  const initialValueRef = useRef<number | null>(null);
  if (isOpen && initialValueRef.current === null) {
    initialValueRef.current = value;
  }
  if (!isOpen) {
    initialValueRef.current = null;
  }
  const unchanged = value === initialValueRef.current;

  // Trap focus inside the modal so Tab cycles through: input → Cancel → Scale.
  const modalRef = useRef<HTMLDivElement>(null);

  // Capture-phase document listener to intercept Tab before the browser moves focus.
  useEffect(() => {
    if (!isOpen) return;
    const container = modalRef.current;
    if (!container) return;

    // Auto-focus the input when the modal opens.
    const input = container.querySelector<HTMLElement>('input:not([disabled])');
    input?.focus();

    const handler = (e: KeyboardEvent) => {
      // Only handle events for elements inside this modal.
      if (!container.contains(e.target as Node)) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key !== 'Tab') return;

      e.preventDefault();
      e.stopPropagation();

      const focusable = Array.from(
        container.querySelectorAll<HTMLElement>(
          'input:not([disabled]), button:not([disabled]):not([tabindex="-1"])'
        )
      );
      if (focusable.length === 0) return;

      const idx = focusable.indexOf(document.activeElement as HTMLElement);
      let next: number;
      if (e.shiftKey) {
        next = idx <= 0 ? focusable.length - 1 : idx - 1;
      } else {
        next = idx >= focusable.length - 1 ? 0 : idx + 1;
      }
      focusable[next].focus();
    };

    // Use capture phase so we intercept Tab before anything else.
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [isOpen, onCancel]);

  if (!isOpen) {
    return null;
  }

  const handleIncrement = (delta: number) => {
    const newValue = Math.max(0, Math.min(9999, value + delta));
    onValueChange(newValue);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Strip non-digit characters so letters are silently ignored.
    const raw = e.target.value.replace(/[^0-9]/g, '');
    setInputText(raw);
    const parsed = parseInt(raw, 10);
    if (!Number.isNaN(parsed)) {
      onValueChange(parsed);
    }
  };

  // Commit a valid number on blur; if empty, reset to 0.
  const handleBlur = () => {
    const parsed = parseInt(inputText, 10);
    if (Number.isNaN(parsed) || inputText.trim() === '') {
      onValueChange(0);
      setInputText('0');
    }
  };

  return (
    <div className="modal-overlay">
      <div
        ref={modalRef}
        className="modal-container scale-modal"
        onClick={(e) => e.stopPropagation()}
      >
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
                tabIndex={-1}
                onClick={() => handleIncrement(-1)}
                disabled={value === 0 || loading}
              >
                −
              </button>
              <input
                id="scale-replicas"
                type="text"
                inputMode="numeric"
                value={inputText}
                onChange={handleInputChange}
                onBlur={handleBlur}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !unchanged) onApply();
                }}
                className="scale-input"
                disabled={loading}
              />
              <button
                className="scale-spinner-btn"
                type="button"
                tabIndex={-1}
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
          <button className="button warning" onClick={onApply} disabled={loading || unchanged}>
            {loading ? 'Scaling…' : 'Scale'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ScaleModal;
