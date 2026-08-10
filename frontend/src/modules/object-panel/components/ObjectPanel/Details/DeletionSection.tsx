import type { CapabilityState } from '@modules/object-panel/components/ObjectPanel/types';
import type { ObjectPanelRef } from '@modules/object-panel/objectPanelRef';
import type { FinalizerPath } from '@shared/actions/objectActionClient';
import { LiveAgeText } from '@shared/components/LiveAgeText';
import { useObjectActionController } from '@shared/hooks/useObjectActionController';
import type { ObjectDeletionMetadata } from '@/core/refresh/types.generated';
import { finalizerGuidance } from './finalizerCatalog';
import type { NamespaceFinalizationDetails } from './objectDetailModel';
import './DeletionSection.css';

interface DeletionSectionProps {
  deletion: ObjectDeletionMetadata | null;
  namespaceFinalization: NamespaceFinalizationDetails | null;
  objectData: ObjectPanelRef;
  removalCapabilities: {
    metadata: CapabilityState;
    namespaceSpec: CapabilityState;
  };
  onAfterAction: () => void;
}

const normalizedFinalizers = (values?: string[]): string[] =>
  Array.from(new Set((values ?? []).map((value) => value.trim()).filter(Boolean))).sort();

const disabledReason = (capability: CapabilityState): string | undefined => {
  if (capability.pending) {
    return 'Checking permission…';
  }
  if (!capability.allowed) {
    return capability.reason ?? 'You do not have permission to remove this finalizer.';
  }
  return undefined;
};

interface FinalizerGroupProps {
  source: FinalizerPath;
  values?: string[];
  capability: CapabilityState;
  onRemove: (finalizer: string, source: FinalizerPath) => void;
}

function FinalizerGroup({ source, values, capability, onRemove }: Readonly<FinalizerGroupProps>) {
  const finalizers = normalizedFinalizers(values);
  if (finalizers.length === 0) {
    return null;
  }

  return (
    <div className="deletion-finalizer-group">
      <div className="deletion-subtitle">{source}</div>
      <div className="deletion-card-list">
        {finalizers.map((finalizer) => {
          const guidance = finalizerGuidance(finalizer);
          return (
            <div className="deletion-card" key={`${source}:${finalizer}`}>
              <code className="deletion-finalizer-name">{finalizer}</code>
              <div className="deletion-guidance-title">{guidance.title}</div>
              <div>{guidance.explanation}</div>
              <div className="deletion-next-step">{guidance.nextStep}</div>
              {!!guidance.consequence && (
                <div className="deletion-consequence">{guidance.consequence}</div>
              )}
              <p className="deletion-finalizer-removal-warning">
                You may force the removal of this Finalizer. This may leave objects in an unknown or
                bad state.
              </p>
              <div className="deletion-finalizer-actions">
                <button
                  type="button"
                  className="button danger"
                  aria-label={`Remove finalizer ${finalizer}`}
                  disabled={!capability.allowed || capability.pending}
                  title={disabledReason(capability)}
                  onClick={() => onRemove(finalizer, source)}
                >
                  Remove
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function DeletionSection({
  deletion,
  namespaceFinalization,
  objectData,
  removalCapabilities,
  onAfterAction,
}: Readonly<DeletionSectionProps>) {
  const actionController = useObjectActionController({
    context: 'object-panel',
    useDefaultHandlers: false,
    onAfterAction: () => onAfterAction(),
  });

  if (!deletion) {
    return null;
  }

  const metadataFinalizers = normalizedFinalizers(deletion.finalizers);
  const namespaceFinalizers = normalizedFinalizers(namespaceFinalization?.finalizers);
  const hasFinalizers = metadataFinalizers.length > 0 || namespaceFinalizers.length > 0;
  const conditions = namespaceFinalization?.conditions ?? [];

  return (
    <div className="object-panel-section deletion-section">
      <div className="object-panel-section-title">Deletion</div>
      <div className="deletion-summary">
        Terminating for{' '}
        <LiveAgeText timestamp={deletion.deletionTimestamp} fullDateTitle fallback="unknown" />
      </div>
      <p className="deletion-explanation">
        Finalizers keep an object present until its controller finishes protected cleanup.
      </p>

      <FinalizerGroup
        source="metadata.finalizers"
        values={metadataFinalizers}
        capability={removalCapabilities.metadata}
        onRemove={actionController.requestFinalizerRemoval.bind(null, objectData)}
      />
      <FinalizerGroup
        source="spec.finalizers"
        values={namespaceFinalizers}
        capability={removalCapabilities.namespaceSpec}
        onRemove={actionController.requestFinalizerRemoval.bind(null, objectData)}
      />

      {!hasFinalizers && (
        <div className="deletion-empty">
          No finalizers remain on this object. Kubernetes may still be completing deletion.
        </div>
      )}

      {conditions.length > 0 && (
        <div className="deletion-conditions">
          <div className="deletion-subtitle">Namespace deletion conditions</div>
          <div className="deletion-card-list">
            {conditions.map((condition) => (
              <div
                className="deletion-card"
                key={`${condition.type ?? 'condition'}:${condition.reason ?? ''}`}
              >
                <div className="deletion-condition-header">
                  <code>{condition.type || 'Condition'}</code>
                  <span className="deletion-condition-status">{condition.status}</span>
                </div>
                {!!condition.reason && (
                  <div className="deletion-guidance-title">{condition.reason}</div>
                )}
                {!!condition.message && <div>{condition.message}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
      {actionController.modals}
    </div>
  );
}
