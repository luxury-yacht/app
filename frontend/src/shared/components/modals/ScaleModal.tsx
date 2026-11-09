/**
 * frontend/src/shared/components/modals/ScaleModal.tsx
 *
 * Shared modal component for scaling Kubernetes workloads.
 * Used by the workloads table context menu, the object panel actions menu, and
 * batch scaling.
 */

import { ErrorSurface } from '@shared/components/errors/ErrorSurface';
import { MinusIcon, PlusIcon, ScaleIcon } from '@shared/components/icons/SharedIcons';
import type React from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import ModalHeader from './ModalHeader';
import ModalSurface from './ModalSurface';
import { clampReplicas, MAX_REPLICAS } from './scaleModalModel';
import { useModalFocusTrap } from './useModalFocusTrap';
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
  onScaleToZero?: () => void;
  onValueChange: (value: number) => void;
  /** Applying the starting value is meaningful, as when scaling many workloads to one count. */
  allowUnchanged?: boolean;
}

// Tracks the replica count from when the modal first opens, so the Scale button
// can stay disabled until the value changes.
const useValueUnchangedSinceOpen = (isOpen: boolean, value: number): boolean => {
  const initialValueRef = useRef<number | null>(null);
  if (isOpen && initialValueRef.current === null) {
    initialValueRef.current = value;
  }
  if (!isOpen) {
    initialValueRef.current = null;
  }
  return value === initialValueRef.current;
};

// The field can be briefly empty while typing; anything else it shows is a count
// the app can apply.
const useReplicaText = (value: number, onValueChange: (value: number) => void) => {
  const [text, setText] = useState(String(value));

  useEffect(() => {
    setText(String(value));
  }, [value]);

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const digits = event.target.value.replace(/[^0-9]/g, '');
    if (digits === '') {
      setText('');
      return;
    }
    const count = clampReplicas(Number.parseInt(digits, 10));
    setText(String(count));
    onValueChange(count);
  };

  // An emptied field goes back to the last valid count rather than meaning 0.
  const handleBlur = () => {
    if (text === '') {
      setText(String(value));
    }
  };

  return { text, isEmpty: text === '', handleChange, handleBlur };
};

const ReplicaStepButton = ({
  label,
  disabled,
  onClick,
  children,
}: Readonly<{
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}>) => (
  <button
    type="button"
    className="scale-step-button"
    aria-label={label}
    disabled={disabled}
    onClick={onClick}
  >
    {children}
  </button>
);

const ReplicaField = ({
  inputId,
  value,
  replicaText,
  loading,
  cannotApply,
  onApply,
  onValueChange,
}: Readonly<{
  inputId: string;
  value: number;
  replicaText: ReturnType<typeof useReplicaText>;
  loading: boolean;
  cannotApply: boolean;
  onApply: () => void;
  onValueChange: (value: number) => void;
}>) => (
  <div className="scale-input-group">
    <ReplicaStepButton
      label="Decrease replicas"
      disabled={loading || value <= 0}
      onClick={() => onValueChange(clampReplicas(value - 1))}
    >
      <MinusIcon width={12} height={12} />
    </ReplicaStepButton>
    <input
      id={inputId}
      type="text"
      inputMode="numeric"
      value={replicaText.text}
      onChange={replicaText.handleChange}
      onBlur={replicaText.handleBlur}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !cannotApply) {
          onApply();
        }
      }}
      className="scale-input"
      disabled={loading}
    />
    <ReplicaStepButton
      label="Increase replicas"
      disabled={loading || value >= MAX_REPLICAS}
      onClick={() => onValueChange(clampReplicas(value + 1))}
    >
      <PlusIcon width={12} height={12} />
    </ReplicaStepButton>
  </div>
);

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
  onScaleToZero,
  onValueChange,
  allowUnchanged = false,
}: ScaleModalProps) => {
  const elementIdPrefix = useId();
  const replicaText = useReplicaText(value, onValueChange);
  const unchanged = useValueUnchangedSinceOpen(isOpen, value) && !allowUnchanged;
  const cannotApply = unchanged || replicaText.isEmpty;

  const modalRef = useRef<HTMLDivElement>(null);

  useModalFocusTrap({
    ref: modalRef,
    disabled: !isOpen,
    onEscape: () => {
      onCancel();
      return true;
    },
  });

  if (!isOpen) {
    return null;
  }

  return (
    <ModalSurface
      modalRef={modalRef}
      labelledBy="scale-modal-title"
      onClose={onCancel}
      containerClassName="scale-modal"
      closeOnBackdrop={false}
    >
      <ModalHeader
        title={`Scale ${kind}`}
        titleId="scale-modal-title"
        icon={ScaleIcon}
        onClose={onCancel}
        closeDisabled={loading}
      />
      <div className="scale-modal-body">
        <div className="scale-modal-fields">
          {!!namespace && (
            <>
              <span className="scale-modal-label">Namespace:</span>
              <span className="scale-modal-value">{namespace}</span>
            </>
          )}
          {!!name && (
            <>
              <span className="scale-modal-label">{kind || 'Workload'}:</span>
              <span className="scale-modal-value">{name}</span>
            </>
          )}
          <label className="scale-modal-label" htmlFor={`${elementIdPrefix}-scale-replicas`}>
            Replicas:
          </label>
          <ReplicaField
            inputId={`${elementIdPrefix}-scale-replicas`}
            value={value}
            replicaText={replicaText}
            loading={loading}
            cannotApply={cannotApply}
            onApply={onApply}
            onValueChange={onValueChange}
          />
        </div>
      </div>
      {!!error && (
        <div className="scale-modal-error">
          <ErrorSurface kind="reported" message={error} />
        </div>
      )}
      <div className="scale-modal-footer">
        <button type="button" className="button cancel" onClick={onCancel} disabled={loading}>
          Cancel
        </button>
        {!!onScaleToZero && (
          <button
            type="button"
            className="button generic"
            onClick={onScaleToZero}
            disabled={loading || value === 0}
          >
            Scale to 0
          </button>
        )}
        <button
          type="button"
          className="button warning"
          onClick={onApply}
          disabled={loading || cannotApply}
        >
          {loading ? 'Scaling…' : 'Scale'}
        </button>
      </div>
    </ModalSurface>
  );
};

export default ScaleModal;
