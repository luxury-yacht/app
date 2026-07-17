import { SettingsIcon } from '@shared/components/icons/SharedIcons';
import ModalHeader from '@shared/components/modals/ModalHeader';
import ModalSurface from '@shared/components/modals/ModalSurface';
import { useModalFocusTrap } from '@shared/components/modals/useModalFocusTrap';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  AttentionFindingTypeDefinition,
  AttentionIgnoreRules,
  ResourceRef,
} from '@/core/refresh/types';
import './AttentionIgnoredModal.css';

interface AttentionIgnoredModalProps {
  isOpen: boolean;
  rules: AttentionIgnoreRules;
  findingTypes: AttentionFindingTypeDefinition[];
  onRestoreObject: (ref: ResourceRef) => Promise<AttentionIgnoreRules>;
  onRestoreType: (findingType: string) => Promise<AttentionIgnoreRules>;
  onClose: () => void;
}

const refKey = (ref: ResourceRef) =>
  [ref.clusterId, ref.group, ref.version, ref.kind, ref.namespace, ref.name, ref.uid].join('\0');

const objectLabel = (ref: ResourceRef) => {
  const name = ref.namespace ? `${ref.namespace}/${ref.name}` : ref.name;
  return `${ref.kind} ${name}`;
};

export default function AttentionIgnoredModal({
  isOpen,
  rules,
  findingTypes,
  onRestoreObject,
  onRestoreType,
  onClose,
}: AttentionIgnoredModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const [currentRules, setCurrentRules] = useState(rules);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const labels = useMemo(
    () => new Map(findingTypes.map((definition) => [definition.id, definition.label])),
    [findingTypes]
  );

  useEffect(() => setCurrentRules(rules), [rules]);
  useModalFocusTrap({
    ref: modalRef,
    disabled: !isOpen,
    onEscape: () => {
      if (busyKey) {
        return false;
      }
      onClose();
      return true;
    },
  });

  if (!isOpen) {
    return null;
  }

  const restoreObject = async (ref: ResourceRef) => {
    const key = `object:${refKey(ref)}`;
    setBusyKey(key);
    try {
      setCurrentRules(await onRestoreObject(ref));
    } finally {
      setBusyKey(null);
    }
  };
  const restoreType = async (findingType: string) => {
    const key = `type:${findingType}`;
    setBusyKey(key);
    try {
      setCurrentRules(await onRestoreType(findingType));
    } finally {
      setBusyKey(null);
    }
  };

  const ignoredTypes = currentRules.findingTypes ?? [];
  const ignoredObjects = currentRules.ignoredObjects ?? [];
  const empty = ignoredTypes.length === 0 && ignoredObjects.length === 0;

  return (
    <ModalSurface
      modalRef={modalRef}
      labelledBy="attention-ignored-title"
      onClose={onClose}
      containerClassName="attention-ignored-modal"
      closeOnBackdrop
    >
      <ModalHeader
        title="Ignored findings"
        titleId="attention-ignored-title"
        icon={SettingsIcon}
        onClose={onClose}
        closeDisabled={busyKey !== null}
      />
      <div className="attention-ignored-body">
        {!!empty && <p className="attention-ignored-empty">No findings are ignored.</p>}
        {ignoredTypes.length > 0 && (
          <section>
            <h3>Finding types</h3>
            <ul>
              {ignoredTypes.map((findingType) => (
                <li key={findingType}>
                  <span>{labels.get(findingType) ?? findingType}</span>
                  <button
                    type="button"
                    className="button"
                    disabled={busyKey !== null}
                    onClick={() => void restoreType(findingType)}
                  >
                    Restore
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {ignoredObjects.length > 0 && (
          <section>
            <h3>Objects</h3>
            <ul>
              {ignoredObjects.map((ref) => (
                <li key={refKey(ref)}>
                  <span>{objectLabel(ref)}</span>
                  <button
                    type="button"
                    className="button"
                    disabled={busyKey !== null}
                    onClick={() => void restoreObject(ref)}
                  >
                    Restore
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      <div className="attention-ignored-footer">
        <button type="button" className="button" onClick={onClose} data-modal-initial-focus>
          Close
        </button>
      </div>
    </ModalSurface>
  );
}
