import { SettingsIcon } from '@shared/components/icons/SharedIcons';
import ModalHeader from '@shared/components/modals/ModalHeader';
import ModalSurface from '@shared/components/modals/ModalSurface';
import { useModalFocusTrap } from '@shared/components/modals/useModalFocusTrap';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  AttentionFindingTypeDefinition,
  AttentionIgnoreRules,
  AttentionObjectFindingIgnore,
  ResourceRef,
} from '@/core/refresh/types';
import './AttentionIgnoredModal.css';

interface AttentionIgnoredModalProps {
  isOpen: boolean;
  rules: AttentionIgnoreRules;
  findingTypes: AttentionFindingTypeDefinition[];
  onRestoreObjectFinding: (ignore: AttentionObjectFindingIgnore) => Promise<AttentionIgnoreRules>;
  onRestoreClusterType: (findingType: string) => Promise<AttentionIgnoreRules>;
  onRestoreGlobalType: (findingType: string) => Promise<AttentionIgnoreRules>;
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
  onRestoreObjectFinding,
  onRestoreClusterType,
  onRestoreGlobalType,
  onClose,
}: Readonly<AttentionIgnoredModalProps>) {
  const modalRef = useRef<HTMLDivElement>(null);
  const [currentRules, setCurrentRules] = useState(rules);
  const [restoring, setRestoring] = useState(false);
  const labels = useMemo(
    () => new Map(findingTypes.map((definition) => [definition.id, definition.label])),
    [findingTypes]
  );

  useEffect(() => setCurrentRules(rules), [rules]);
  useModalFocusTrap({
    ref: modalRef,
    disabled: !isOpen,
    onEscape: () => {
      if (restoring) {
        return false;
      }
      onClose();
      return true;
    },
  });

  if (!isOpen) {
    return null;
  }

  const restore = async (action: () => Promise<AttentionIgnoreRules>) => {
    setRestoring(true);
    try {
      setCurrentRules(await action());
    } finally {
      setRestoring(false);
    }
  };

  const clusterTypes = currentRules.clusterFindingTypes ?? [];
  const globalTypes = currentRules.globalFindingTypes ?? [];
  const objectFindings = currentRules.objectFindings ?? [];
  const empty =
    clusterTypes.length === 0 && globalTypes.length === 0 && objectFindings.length === 0;

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
        closeDisabled={restoring}
      />
      <div className="attention-ignored-body">
        {!!empty && <p className="attention-ignored-empty">No findings are ignored.</p>}
        {objectFindings.length > 0 && (
          <section className="attention-ignored-section">
            <h3 className="attention-ignored-section-title">Object-Specific</h3>
            <ul>
              {objectFindings.map((ignore) => (
                <li key={`${refKey(ignore.ref)}:${ignore.findingType}`}>
                  <span>
                    {labels.get(ignore.findingType) ?? ignore.findingType} —{' '}
                    {objectLabel(ignore.ref)}
                  </span>
                  <button
                    type="button"
                    className="button cancel"
                    disabled={restoring}
                    onClick={() => void restore(() => onRestoreObjectFinding(ignore))}
                  >
                    Restore
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {[
          { title: 'This Cluster', types: clusterTypes, onRestore: onRestoreClusterType },
          { title: 'All Clusters', types: globalTypes, onRestore: onRestoreGlobalType },
        ].map(({ title, types, onRestore }) =>
          types.length > 0 ? (
            <section key={title} className="attention-ignored-section">
              <h3 className="attention-ignored-section-title">{title}</h3>
              <ul>
                {types.map((findingType) => (
                  <li key={findingType}>
                    <span>{labels.get(findingType) ?? findingType}</span>
                    <button
                      type="button"
                      className="button cancel"
                      disabled={restoring}
                      onClick={() => void restore(() => onRestore(findingType))}
                    >
                      Restore
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null
        )}
      </div>
      <div className="attention-ignored-footer">
        <button type="button" className="button generic" onClick={onClose} data-modal-initial-focus>
          Close
        </button>
      </div>
    </ModalSurface>
  );
}
